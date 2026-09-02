#!/usr/bin/env python3
"""
Liara Engine — retire one published version of one module.

Deleting a version's directory is the obvious way to reclaim the space, and
it is the wrong one. Every link into that version — a bookmark, a Stack
Overflow answer, a comment in someone's build script — becomes a generic 404
that says nothing about what happened. The reader cannot tell whether they
mistyped, whether the module was renamed, or whether the page they remember
ever existed.

So a retired version keeps its address and gets a page instead: this module,
this version, taken offline on this date, and here is the version to read
instead. `removed.json` beside it is the machine-readable half of the same
statement — the edge router serves the page with a 410 for every deep link
into the version, and tools/build-registry-index.py flags the version in the
navigation index so the selector can say `1.2.3 (retired)` rather than
quietly dropping an entry readers may be looking for.

The successor is chosen by the same compatibility rule the rest of the
pipeline uses: the newest version still online in the same ABI line — same
major, or same minor while the major is 0 — falling back to the module's
`latest`.

Usage:
    make-tombstone.py --site <site-dir> --repo NAME --version X.Y.Z
                      [--reason TEXT] [--successor X.Y.Z]
                      [--org liara-engine] [--dry-run]
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

MARKER_NAME = "removed.json"
PREVIEW_PREFIX = "pr-"
RELEASE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


# --------------------------------------------------------------- the site

def load_json(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def parse(label: str) -> tuple[int, int, int] | None:
    match = RELEASE.match(label)
    return tuple(int(part) for part in match.groups()) if match else None


def available_versions(module_dir: Path, exclude: str) -> list[str]:
    """Version labels that are deployed, readable, and not previews."""
    found = []
    for path in sorted(module_dir.iterdir()):
        if not path.is_dir() or path.name == exclude:
            continue
        if path.name.startswith(PREVIEW_PREFIX):
            continue
        if (path / MARKER_NAME).exists():  # already retired
            continue
        found.append(path.name)
    return found


def sort_versions(labels: list[str]) -> list[str]:
    """`dev` first, then newest release first — the pipeline's usual order."""
    def key(label: str):
        parsed = parse(label)
        if label == "dev":
            return (0,)
        if parsed:
            return (1, tuple(-part for part in parsed))
        return (2, label)
    return sorted(labels, key=key)


def compatible_line(target: tuple[int, int, int], candidate: tuple[int, int, int]) -> bool:
    """Same ABI line: same major, or same minor while the major is 0.

    Mirrors `liara_version_provides()` at the precision a documentation link
    needs. A 0.x release makes no promise across minors, so 0.2.1 is not a
    replacement for someone who was reading 0.1.4 — it is a different API.
    """
    if target[0] != candidate[0]:
        return False
    return target[0] != 0 or target[1] == candidate[1]


def choose_successor(target: str, available: list[str], latest: str | None) -> str | None:
    ordered = sort_versions(available)
    releases = [label for label in ordered if parse(label)]
    parsed = parse(target)

    if parsed:
        for label in releases:
            candidate = parse(label)
            if candidate and compatible_line(parsed, candidate):
                return label

    if latest and latest in available:
        return latest
    if releases:
        return releases[0]
    return "dev" if "dev" in available else None


# --------------------------------------------------------------- the page

STYLE = """
:root {
    color-scheme: light;
    --bg: #FFFAFC; --surface: #FFFFFF; --border: #F0DCE7;
    --text: #2D1B2E; --muted: #6B5670; --faint: #9B8AA0;
    --link: #B7388A; --link-hover: #8E2A6B;
    --warn-bg: #FDF2E3; --warn-fg: #8A5A18; --warn-border: #E8C89C;
    --shadow: 0 4px 12px rgba(45, 27, 46, .08);
}
:root[data-theme='dark'] {
    color-scheme: dark;
    --bg: #1E1A1F; --surface: #322B36; --border: #4A3F4E;
    --text: #F5E6EE; --muted: #BFA8B5; --faint: #877683;
    --link: #F4A6C0; --link-hover: #F8C4D5;
    --warn-bg: #3F2D1E; --warn-fg: #E8B98C; --warn-border: #6B4A2D;
    --shadow: 0 4px 12px rgba(0, 0, 0, .35);
}
@media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
        color-scheme: dark;
        --bg: #1E1A1F; --surface: #322B36; --border: #4A3F4E;
        --text: #F5E6EE; --muted: #BFA8B5; --faint: #877683;
        --link: #F4A6C0; --link-hover: #F8C4D5;
        --warn-bg: #3F2D1E; --warn-fg: #E8B98C; --warn-border: #6B4A2D;
        --shadow: 0 4px 12px rgba(0, 0, 0, .35);
    }
}

* { box-sizing: border-box; }
body {
    margin: 0; padding: 3rem 1.25rem 4rem;
    background: var(--bg); color: var(--text);
    font: 400 16px/1.6 'Open Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    display: flex; justify-content: center;
}
main { width: 100%; max-width: 44rem; }

.eyebrow {
    display: inline-flex; align-items: center; gap: .5rem;
    margin: 0 0 1rem; padding: .3rem .75rem;
    background: var(--warn-bg); color: var(--warn-fg);
    border: 1px solid var(--warn-border); border-radius: 999px;
    font-size: .8125rem; font-weight: 600; letter-spacing: .01em;
}
h1 { margin: 0 0 .75rem; font-size: 1.875rem; line-height: 1.25; font-weight: 700; }
h1 code {
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .9em;
}
.lede { margin: 0 0 1.5rem; color: var(--muted); font-size: 1.0625rem; }
.reason {
    margin: 0 0 1.5rem; padding: .875rem 1rem;
    background: var(--surface); border: 1px solid var(--border);
    border-left: 3px solid var(--warn-border); border-radius: .5rem;
    color: var(--muted);
}

.card {
    margin: 0 0 1.5rem; padding: 1.25rem;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: .75rem; box-shadow: var(--shadow);
}
.card h2 { margin: 0 0 .5rem; font-size: .8125rem; font-weight: 700;
           text-transform: uppercase; letter-spacing: .06em; color: var(--faint); }
.card p { margin: 0 0 1rem; color: var(--muted); font-size: .9375rem; }

.cta {
    display: inline-flex; align-items: center; gap: .5rem;
    padding: .625rem 1.125rem; border-radius: .5rem;
    background: var(--link); color: var(--bg);
    font-weight: 600; text-decoration: none;
}
.cta:hover { background: var(--link-hover); }

ul.versions { list-style: none; margin: 0; padding: 0;
              display: flex; flex-wrap: wrap; gap: .5rem; }
ul.versions a {
    display: inline-block; padding: .375rem .75rem;
    border: 1px solid var(--border); border-radius: 999px;
    background: var(--bg); color: var(--link);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .875rem; text-decoration: none;
}
ul.versions a:hover { border-color: var(--link); color: var(--link-hover); }

.elsewhere { margin: 0; padding: 0; list-style: none; color: var(--muted); font-size: .9375rem; }
.elsewhere li { margin: .375rem 0; }
a { color: var(--link); }
a:hover { color: var(--link-hover); }
footer { margin-top: 2.5rem; color: var(--faint); font-size: .8125rem; }
"""

THEME_SCRIPT = """
(function () {
    try {
        var stored = localStorage.getItem('starlight-theme');
        if (stored === 'light' || stored === 'dark') {
            document.documentElement.dataset.theme = stored;
        }
    } catch { /* the media query already covers it */ }
})();
"""


def render_page(*, name: str, repo: str, version: str, reason: str,
                successor: str | None, others: list[str], latest: str | None,
                removed_at: str, org: str) -> str:
    e = html.escape
    title = f"{e(name)} {e(version)} — retired"

    if successor:
        same_line = "the closest version still online" if successor != latest \
            else "the current release"
        cta = f"""
    <div class="card">
        <h2>Read this instead</h2>
        <p>{e(successor)} is {same_line}.</p>
        <a class="cta" href="/{e(repo)}/{e(successor)}/">Go to {e(repo)} {e(successor)} &rarr;</a>
    </div>"""
    else:
        cta = """
    <div class="card">
        <h2>Read this instead</h2>
        <p>Nothing else of this module is online right now.</p>
        <a class="cta" href="/">Back to the documentation hub &rarr;</a>
    </div>"""

    versions_block = ""
    if others:
        items = "\n".join(
            f'            <li><a href="/{e(repo)}/{e(label)}/">{e(label)}</a></li>'
            for label in others)
        versions_block = f"""
    <div class="card">
        <h2>Other versions</h2>
        <ul class="versions">
{items}
        </ul>
    </div>"""

    reason_block = f'    <p class="reason">{e(reason)}</p>\n' if reason else ""
    tag_url = f"https://github.com/{e(org)}/{e(repo)}/tree/v{e(version)}"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{title}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>{STYLE}</style>
<script>{THEME_SCRIPT}</script>
</head>
<body>
<main>
    <p class="eyebrow">Documentation retired</p>

    <h1>{e(name)} <code>{e(version)}</code> is no longer published</h1>

    <p class="lede">
        This version's documentation was taken offline on {e(removed_at[:10])}.
        The version itself was not withdrawn — only its generated pages are gone.
    </p>

{reason_block}{cta}{versions_block}

    <div class="card">
        <h2>Elsewhere</h2>
        <ul class="elsewhere">
            <li><a href="/{e(repo)}/latest/">The current documentation for {e(repo)}</a></li>
            <li><a href="{tag_url}">The sources at tag <code>v{e(version)}</code> on GitHub</a></li>
            <li><a href="/">The Liara Engine documentation hub</a></li>
        </ul>
    </div>

    <footer>
        You reached this page because a link pointed inside
        <code>/{e(repo)}/{e(version)}/</code>. Every path under it now answers with
        this notice rather than a plain 404.
    </footer>
</main>
</body>
</html>
"""


# --------------------------------------------------------------------- main

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Replace a published version with an explicit tombstone.")
    parser.add_argument("--site", type=Path, required=True,
                        help="path to the deployed site/ directory")
    parser.add_argument("--repo", required=True, help="module repository name")
    parser.add_argument("--version", required=True, help="version to retire")
    parser.add_argument("--reason", default="", help="shown on the page")
    parser.add_argument("--successor", default="",
                        help="version to point readers at; empty picks the "
                             "newest compatible one still online")
    parser.add_argument("--org", default="liara-engine",
                        help="GitHub organisation, for the link to the sources")
    parser.add_argument("--dry-run", action="store_true",
                        help="report what would be written, write nothing")
    args = parser.parse_args(argv)

    module_dir = args.site / args.repo
    target = module_dir / args.version

    if not module_dir.is_dir():
        print(f"error: {args.repo} is not deployed at {module_dir}", file=sys.stderr)
        return 1
    if not target.is_dir():
        print(f"error: {args.repo} {args.version} is not deployed at {target}",
              file=sys.stderr)
        return 1

    manifest = load_json(module_dir / "manifest.json") or {}
    metadata = manifest.get("metadata") or {}
    name = metadata.get("name") or args.repo
    latest = metadata.get("latest")

    available = available_versions(module_dir, exclude=args.version)

    if args.successor and args.successor not in available:
        print(f"error: {args.successor} is not an available version of {args.repo}; "
              f"available: {', '.join(sort_versions(available)) or 'none'}",
              file=sys.stderr)
        return 1

    successor = args.successor or choose_successor(args.version, available, latest)

    removed_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    others = [label for label in sort_versions(available) if label != successor]

    page = render_page(name=name, repo=args.repo, version=args.version,
                       reason=args.reason, successor=successor, others=others,
                       latest=latest, removed_at=removed_at, org=args.org)

    marker = {
        "repo": args.repo,
        "version": args.version,
        "removed": True,
        "removed_at": removed_at,
        "reason": args.reason or None,
        "successor": successor,
        "alternatives": sort_versions(available),
    }

    files = sum(1 for path in target.rglob("*") if path.is_file())
    print(f"retiring {args.repo} {args.version}: {files} files")
    print(f"  successor:    {successor or '(none available)'}")
    print(f"  alternatives: {', '.join(marker['alternatives']) or 'none'}")

    if args.dry_run:
        print("dry run: nothing written")
        return 0

    shutil.rmtree(target)
    target.mkdir(parents=True)
    (target / "index.html").write_text(page, encoding="utf-8")
    (target / MARKER_NAME).write_text(
        json.dumps(marker, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"  wrote {target / 'index.html'} and {target / MARKER_NAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
