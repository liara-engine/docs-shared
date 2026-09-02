#!/usr/bin/env python3
"""
Liara Engine — build the aggregated navigation index.

The shared navbar needs, for every module, its identity and its list of
published versions. That information is split across the modules registry
and one manifest per module, so a browser assembling it for itself makes
`1 + N` requests before the navigation can be drawn — on every page view,
of every page, of every module.

The output repository holds all of those files at deploy time, so the join
belongs there: this script walks `site/*/manifest.json`, merges each one
into its registry entry, and writes a single `site/registry-index.json`.
The navbar then needs one request, and it is a request it can serve stale
from cache without the navigation ever being wrong for long.

Run it as the last step of a deploy, after the new manifest has landed.

Usage:
    build-registry-index.py <site-dir> [--registry PATH] [--check]

`--check` writes nothing and exits 1 if the on-disk index is out of date,
so the same script can gate a workflow.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

INDEX_NAME = "registry-index.json"
REGISTRY_NAME = "modules-registry.json"

# Preview builds live beside real versions but must never appear in a
# version selector: they are reachable by direct URL only.
PREVIEW_PREFIX = "pr-"

# Written beside a retired version's tombstone page by tools/make-tombstone.py.
REMOVED_MARKER = "removed.json"


def load_json(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as error:
        print(f"warning: {path} is not valid JSON: {error}", file=sys.stderr)
        return None


def normalise_versions(manifest: dict) -> dict[str, dict]:
    """Flatten a v1 or v2 manifest's versions into one shape.

    v1 entries look like  {"abi_compatibility": ["dev"]}
    v2 entries look like  "dev" | ["dev", "1.0.0"] | {"abi": ..., "note": ...}
    v2 contract/infrastructure entries carry no `abi` at all.

    The navbar should not have to know which it is reading, so the
    distinction is resolved here, once, at deploy time.
    """
    raw = manifest.get("versions") or {}
    result: dict[str, dict] = {}

    for label, entry in raw.items():
        if label.startswith(PREVIEW_PREFIX):
            continue

        abi: list[str] | None = None
        note: str | None = None

        if entry is None:
            pass
        elif isinstance(entry, str):
            abi = [entry]
        elif isinstance(entry, list):
            abi = list(entry)
        elif isinstance(entry, dict):
            note = entry.get("note")
            if "abi" in entry:
                value = entry["abi"]
                abi = [value] if isinstance(value, str) else list(value)
            elif "abi_compatibility" in entry:  # v1
                value = entry["abi_compatibility"]
                abi = [value] if isinstance(value, str) else list(value)

        result[label] = {"abi": abi, "note": note}

    return result


def annotate_deployment(module_dir: Path, versions: dict[str, dict]) -> None:
    """Records, per version, what the site actually holds for it.

    A manifest declares versions; it does not know which of them made it onto
    the site. Three states have to be told apart, because they want three
    different links:

      * deployed        — an ordinary version directory,
      * retired         — a tombstone page and a `removed.json` beside it
                          (tools/make-tombstone.py), which is still worth
                          linking to: it explains itself and names a
                          replacement,
      * not deployed    — declared but never built, or built before the site
                          was rebuilt from scratch. A link there is a 404,
                          so a selector should not offer it as if it were a
                          page.

    All three stay in the index. Dropping the retired ones would recreate
    exactly the silence the tombstone exists to avoid.
    """
    for label, entry in versions.items():
        directory = module_dir / label
        entry["deployed"] = directory.is_dir()

        marker = load_json(directory / REMOVED_MARKER)
        if marker:
            entry["removed"] = True
            entry["removed_at"] = marker.get("removed_at")
            entry["successor"] = marker.get("successor")
            if marker.get("reason"):
                entry["reason"] = marker["reason"]


def sort_versions(labels: list[str]) -> list[str]:
    """`dev` first, then newest release first."""
    def key(label: str):
        if label == "dev":
            return (0,)
        try:
            return (1, tuple(-int(part) for part in label.split(".")))
        except ValueError:
            return (2, label)
    return sorted(labels, key=key)


def build(site: Path, registry_path: Path) -> dict:
    registry = load_json(registry_path)
    if registry is None:
        raise SystemExit(f"error: cannot read the registry at {registry_path}")
    if not isinstance(registry.get("modules"), list):
        raise SystemExit(f"error: {registry_path} has no `modules` array")

    modules = []
    for entry in registry["modules"]:
        repo = entry.get("repo")
        if not repo:
            print(f"warning: registry entry without `repo`: {entry}", file=sys.stderr)
            continue

        manifest = load_json(site / repo / "manifest.json")
        merged = dict(entry)

        if manifest is None:
            merged.update({"deployed": False, "latest": None, "versions": {}})
        else:
            metadata = manifest.get("metadata") or {}
            versions = normalise_versions(manifest)
            annotate_deployment(site / repo, versions)
            merged.update({
                "deployed": True,
                "name": metadata.get("name") or entry.get("name") or repo,
                "description": metadata.get("description"),
                "kind": manifest.get("kind"),
                "latest": metadata.get("latest"),
                "versions": versions,
                "order": sort_versions(list(versions)),
            })

        modules.append(merged)

    return {"generated_from": REGISTRY_NAME, "modules": modules}


def abi_reference_versions(modules: list[dict]) -> list[str]:
    """Published versions of the ABI module, which anchors are judged against."""
    for module in modules:
        if module.get("is_abi") and module.get("deployed"):
            return [label for label in module.get("order", []) if label != "dev"]
    return []


def annotate_compatibility(modules: list[dict], oracle: Path) -> None:
    """Fill in each version's ABI verdicts by running the real rule.

    The verdicts are not recomputed in the browser. `liara_version_provides`
    is the single definition of compatibility, it lives in a C header, and
    ADR 0005 records that its behaviour has already changed once without the
    ABI pipeline noticing. A JavaScript copy would be a second thing to keep
    in step. Instead the compiled oracle is invoked here, over the small and
    fully known set of pairs the navbar can ever need, and the browser is
    left with a lookup.

    Argument order is load-bearing, and ADR 0005 says so explicitly: the
    anchor a module was built against is `provided`, the ABI version being
    browsed is `required`.
    """
    references = abi_reference_versions(modules)
    if not references:
        print("warning: no deployed ABI module found; skipping compatibility",
              file=sys.stderr)
        return

    pairs: set[tuple[str, str]] = set()
    for module in modules:
        for entry in (module.get("versions") or {}).values():
            for anchor in entry.get("abi") or []:
                if anchor == "dev":
                    continue
                pairs.update((anchor, reference) for reference in references)

    if not pairs:
        return

    ordered = sorted(pairs)
    stdin = "".join(f"{provided} {required}\n" for provided, required in ordered)

    try:
        completed = subprocess.run(
            [str(oracle)], input=stdin, capture_output=True, text=True, check=False)
    except OSError as error:
        raise SystemExit(f"error: cannot run the ABI oracle {oracle}: {error}")

    verdicts: dict[tuple[str, str], str] = {}
    for line in completed.stdout.splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[2] != "ERROR":
            verdicts[(parts[0], parts[1])] = parts[2]

    missing = [pair for pair in ordered if pair not in verdicts]
    if missing:
        raise SystemExit(
            f"error: the ABI oracle returned no verdict for {len(missing)} pair(s), "
            f"first is {missing[0][0]} against {missing[0][1]}. "
            f"A missing verdict must fail the build rather than be guessed at.")

    for module in modules:
        for entry in (module.get("versions") or {}).values():
            anchors = entry.get("abi") or []
            if not anchors:
                continue
            entry["compat"] = {
                reference: [verdicts[(anchor, reference)]
                            for anchor in anchors if anchor != "dev"]
                for reference in references
            }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate the modules registry and every module manifest.")
    parser.add_argument("site", type=Path, help="path to the deployed site/ directory")
    parser.add_argument("--registry", type=Path, default=None,
                        help=f"path to {REGISTRY_NAME} (default: <site>/{REGISTRY_NAME})")
    parser.add_argument("--abi-oracle", type=Path, default=None,
                        help="path to the compiled abi-oracle binary; when given, "
                             "each version gains its ABI compatibility verdicts")
    parser.add_argument("--check", action="store_true",
                        help="verify the on-disk index is current; write nothing")
    args = parser.parse_args(argv)

    if not args.site.is_dir():
        print(f"error: not a directory: {args.site}", file=sys.stderr)
        return 2

    registry_path = args.registry or (args.site / REGISTRY_NAME)
    index = build(args.site, registry_path)

    if args.abi_oracle:
        annotate_compatibility(index["modules"], args.abi_oracle)
    serialised = json.dumps(index, indent=2, ensure_ascii=False) + "\n"
    target = args.site / INDEX_NAME

    if args.check:
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if current == serialised:
            print(f"{INDEX_NAME} is up to date ({len(index['modules'])} modules)")
            return 0
        print(f"error: {INDEX_NAME} is out of date; re-run without --check",
              file=sys.stderr)
        return 1

    target.write_text(serialised, encoding="utf-8")
    deployed = sum(1 for m in index["modules"] if m.get("deployed"))
    print(f"wrote {target} — {len(index['modules'])} modules, {deployed} deployed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
