#!/usr/bin/env python3
"""
Liara Engine — the site-wide search index.

Search used to be built per site, and every version of every module is its
own site. A version directory therefore carried a complete Pagefind bundle:
fourteen files of it byte-identical in all thirty deployed versions, plus
one fragment per page. Nothing could be shared, because Pagefind resolves
its runtime, its wasm, its index chunks and its fragments against a single
base path, so relocating any part of a bundle means relocating all of it —
and tools/fingerprint.py, which shares everything else the site serves,
had to skip the directory entirely.

The hosting layer's hard limit is a file count, so a per-version index is
the wrong shape twice over: it duplicates what is identical, and it grows
with the number of versions published rather than with the amount of
documentation written.

This script builds one index instead, at the site root, over the versions
readers actually search: `dev` and `latest` of every module. A published
version directory then ships no search files at all — the preset points
Pagefind at `/pagefind/` and lets it prefix nothing onto the URLs stored
there, which already carry `/<repo>/<version>/` because the index was
built over the deployed site rather than over one build directory.

Two things are deliberately left out:

  * **Older releases.** They stay readable and linkable; they are no longer
    searched. A reader on one is already being told by the version banner
    that it is not the version to trust, and searching from it now answers
    with the current documentation — which is the answer they want far more
    often than a hit inside a release they landed on by accident.
  * **Pull request previews.** Their pages exist nowhere else, so this index
    cannot see them, and searching a preview is most of the point of having
    one. They keep a local bundle of their own instead; it is transient, and
    the preview teardown removes it with the rest of the preview.

Run it at the end of a deploy, after tools/build-registry-index.py: the
selection below reads the index that script writes.

Usage:
    search-index.py <site-dir> [--index PATH] [--output NAME]
                    [--pagefind-bin PATH] [--dry-run] [--json]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

INDEX_NAME = "registry-index.json"
OUTPUT_NAME = "pagefind"

# Must track the Pagefind that @astrojs/starlight resolves in
# astro/package-lock.json: this script writes the runtime that the search UI
# bundled into every page then loads, and the two talk to each other.
PAGEFIND_VERSION = "1.5.2"

# Pagefind writes its own search UIs beside the index. Starlight never fetches
# any of them: it bundles `@pagefind/default-ui` into its own JavaScript at
# build time, and the runtime it does fetch — `pagefind.js` — asks only for
# `pagefind-entry.json`, `pagefind.<hash>.pf_meta`, `wasm.<lang>.pagefind`,
# `pagefind-worker.js`, `index/*.pf_index` and `fragment/*.pf_fragment`.
# `pagefind-highlight.js` is loaded only when a `highlightParam` option is
# set, which Starlight's search config cannot express.
UNFETCHED = (
    "pagefind-ui.js",
    "pagefind-ui.css",
    "pagefind-modular-ui.js",
    "pagefind-modular-ui.css",
    "pagefind-component-ui.js",
    "pagefind-component-ui.css",
    "pagefind-highlight.js",
)

# An empty selection means the index would answer nothing at all, and that is
# far more likely to mean the site was not checked out, or that this ran
# before build-registry-index.py, than to mean the site genuinely publishes
# no documentation.
MINIMUM_TARGETS = 1


@dataclass
class Target:
    repo: str
    version: str
    reason: str  # `dev` or `latest`

    @property
    def path(self) -> str:
        return f"{self.repo}/{self.version}"


@dataclass
class Report:
    targets: list[Target] = field(default_factory=list)
    glob: str = ""
    pages: int = 0
    files: int = 0
    pruned: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "targets": [
                {"repo": t.repo, "version": t.version, "reason": t.reason}
                for t in self.targets
            ],
            "glob": self.glob,
            "pages": self.pages,
            "files": self.files,
            "pruned": self.pruned,
            "skipped": self.skipped,
        }


def load_json(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as error:
        print(f"warning: {path} is not valid JSON: {error}", file=sys.stderr)
        return None


# ------------------------------------------------------------- the selection

def select(site: Path, index: dict, report: Report) -> list[Target]:
    """Picks the version directories worth indexing.

    `dev` and `latest` per module, and only where the site actually holds a
    directory for them: the navigation index records versions a manifest
    declares, which is not the same set as the versions that were built.
    A retired version is excluded too — its directory holds a tombstone page
    explaining that the version is gone, and a search hit leading there would
    undo the explanation.
    """
    targets: list[Target] = []

    for module in index.get("modules") or []:
        repo = module.get("repo")
        if not repo or not module.get("deployed"):
            continue

        versions = module.get("versions") or {}
        seen: set[str] = set()

        # A module whose `latest` is `dev` — a module that has not cut a
        # release yet — names one directory twice, not two.
        for label, reason in (("dev", "dev"), (module.get("latest"), "latest")):
            if not label or label in seen:
                continue
            seen.add(label)

            entry = versions.get(label) or {}
            target = Target(repo=repo, version=label, reason=reason)

            if entry.get("removed"):
                report.skipped.append(f"{target.path} (retired)")
            elif not entry.get("deployed") or not (site / repo / label).is_dir():
                report.skipped.append(f"{target.path} (not deployed)")
            else:
                targets.append(target)

    return targets


def build_glob(targets: list[Target]) -> str:
    """A single Pagefind `--glob` covering exactly the selected directories.

    Pagefind's glob syntax supports brace alternation — its own default is
    `**/*.{html}` — so one pattern is enough, and one pattern means one walk
    of the tree. A single target still has to skip the braces: an alternation
    of one is not universally accepted, and there is nothing to alternate.
    """
    paths = sorted(target.path for target in targets)
    prefix = paths[0] if len(paths) == 1 else "{" + ",".join(paths) + "}"
    return f"{prefix}/**/*.html"


# ------------------------------------------------------------------ the run

def pagefind_command(bin_path: str | None) -> list[str]:
    if bin_path:
        return [bin_path]
    return ["npx", "--yes", f"pagefind@{PAGEFIND_VERSION}"]


def run_pagefind(site: Path, output: Path, glob: str, bin_path: str | None) -> None:
    # The whole bundle is derived from the site, so it is rebuilt rather than
    # updated: leaving the previous run's files in place would keep fragments
    # for pages that no longer exist, and Pagefind has no notion of pruning
    # an output directory it did not write in this run.
    shutil.rmtree(output, ignore_errors=True)

    command = [
        *pagefind_command(bin_path),
        "--site", str(site),
        "--output-path", str(output),
        "--glob", glob,
    ]
    try:
        subprocess.run(command, check=True)
    except FileNotFoundError:
        raise SystemExit(f"error: cannot run {command[0]}; is Node installed?")
    except subprocess.CalledProcessError as error:
        raise SystemExit(f"error: Pagefind failed with status {error.returncode}")

    if not (output / "pagefind-entry.json").is_file():
        raise SystemExit(f"error: Pagefind wrote no index to {output}")


def prune(output: Path) -> list[str]:
    removed = []
    for name in UNFETCHED:
        path = output / name
        if path.is_file():
            path.unlink()
            removed.append(name)
    return removed


def count_pages(output: Path) -> int:
    entry = load_json(output / "pagefind-entry.json") or {}
    return sum(
        language.get("page_count", 0)
        for language in (entry.get("languages") or {}).values()
    )


def build(site: Path, index_path: Path, output_name: str,
          bin_path: str | None, dry_run: bool) -> Report:
    index = load_json(index_path)
    if index is None:
        raise SystemExit(
            f"error: cannot read {index_path}; run tools/build-registry-index.py first")

    report = Report()
    report.targets = select(site, index, report)

    if len(report.targets) < MINIMUM_TARGETS:
        raise SystemExit(
            f"error: {index_path} selects no deployed version to index; "
            "refusing to publish an index that answers nothing")

    report.glob = build_glob(report.targets)
    output = site / output_name

    if dry_run:
        return report

    run_pagefind(site, output, report.glob, bin_path)
    report.pruned = prune(output)
    report.pages = count_pages(output)
    report.files = sum(1 for path in output.rglob("*") if path.is_file())
    return report


def render(report: Report, output_name: str, dry_run: bool) -> str:
    lines = ["  Search index"]
    if dry_run:
        lines.append(f"    Would index          {len(report.targets):>6} version(s) "
                     f"into /{output_name}/ (nothing written)")
        lines.append(f"    Glob                 {report.glob}")
    else:
        lines.append(f"    Indexed              {len(report.targets):>6} version(s), "
                     f"{report.pages} page(s)")
        lines.append(f"    Wrote                {report.files:>6} files into /{output_name}/")
        if report.pruned:
            lines.append(f"    Pruned               {len(report.pruned):>6} unfetched UI files")
    lines.append("    Covered:")
    for target in report.targets:
        lines.append(f"      {target.path:<40} ({target.reason})")
    if report.skipped:
        lines.append("    Not covered:")
        for note in report.skipped:
            lines.append(f"      {note}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build the site-wide Pagefind index over `dev` and `latest`.")
    parser.add_argument("site", type=Path, help="the deployed site directory")
    parser.add_argument("--index", type=Path, default=None,
                        help=f"the navigation index (default: <site>/{INDEX_NAME})")
    parser.add_argument("--output", default=OUTPUT_NAME,
                        help="directory to write the bundle to, under the site root")
    parser.add_argument("--pagefind-bin", default=None,
                        help="an installed Pagefind binary "
                             f"(default: npx --yes pagefind@{PAGEFIND_VERSION})")
    parser.add_argument("--dry-run", action="store_true",
                        help="report what would be indexed without running Pagefind")
    parser.add_argument("--json", action="store_true",
                        help="emit the report as JSON")
    args = parser.parse_args(argv)

    if not args.site.is_dir():
        print(f"error: not a directory: {args.site}", file=sys.stderr)
        return 2

    index_path = args.index or (args.site / INDEX_NAME)
    report = build(args.site, index_path, args.output, args.pagefind_bin, args.dry_run)

    if args.json:
        print(json.dumps(report.as_dict(), indent=2))
    else:
        print(render(report, args.output, args.dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
