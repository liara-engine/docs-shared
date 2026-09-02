#!/usr/bin/env python3
"""
Liara Engine — garbage collection of the content-addressed asset store.

Entries under `_cas/` are shared: one deploy adds a stylesheet, three other
versions end up pointing at it. Nothing may therefore delete an entry just
because the deploy that introduced it is gone — a pull request preview is
torn down constantly, and its assets are usually the same bytes production
is still serving.

The only safe rule is reachability. This script reads every page of the
site, collects the store paths they reference, and removes what nothing
points to. It is the counterpart of tools/fingerprint.py, which only ever
adds, and it belongs at the end of the preview cleanup workflow.

Two safety properties matter more here than anywhere else in the pipeline,
because the failure mode is silent: a wrongly deleted entry does not break
the build, it breaks a page that nobody is looking at yet.

  * The scan refuses to delete anything when it finds no references at all.
    An empty result is far more likely to mean the site was not checked out
    than to mean the site genuinely uses no assets.
  * `--dry-run` and `--check` report without touching the tree, so the same
    invocation can gate a workflow before it is trusted to run for real.

Usage:
    cas-gc.py <site-dir> [--cas-prefix /_cas] [--dry-run] [--check]
                         [--min-references N]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# File types that may hold a reference. Binary assets never reference the
# store — an entry that referenced another entry would have been rewritten
# before it was hashed, by construction of the fingerprint pass.
SCANNED_SUFFIXES = frozenset({
    '.html', '.css', '.js', '.mjs', '.json', '.xml', '.txt', '.map', '_headers',
})

# Below this many references, the scan is assumed to have gone wrong rather
# than the site to have gone empty.
DEFAULT_MIN_REFERENCES = 1


def reference_pattern(cas_prefix: str) -> re.Pattern[str]:
    escaped = re.escape(cas_prefix.strip('/'))
    # Matches `/_cas/ab/<hash>.css` and `/_cas/_astro/name.hash.js` alike.
    return re.compile(rf'/{escaped}/((?:_astro/)?[A-Za-z0-9._@/-]+)')


# A bundler emits sibling imports relatively — `from"./ui-core.BD2oB50A.js"`,
# and for a lazy import, `await import(`./ui-core.dXFU_8LM.js`)` in backticks.
# Those references survive relocation untouched, because the files move
# together, but they are invisible to the absolute-URL pattern above.
RELATIVE_REFERENCE = re.compile(
    r"""["'`(](\.{1,2}/[A-Za-z0-9._@/-]+\.[A-Za-z0-9]+)["'`)]""")


def resolve_relative(origin: str, target: str) -> str | None:
    """Resolves a relative reference against an entry's own location."""
    parts = origin.split('/')[:-1]
    for segment in target.split('/'):
        if segment in ('', '.'):
            continue
        if segment == '..':
            if not parts:
                return None
            parts.pop()
        else:
            parts.append(segment)
    return '/'.join(parts) if parts else None


def references_in(text: str, origin: str, pattern: re.Pattern[str]) -> set[str]:
    found = set(pattern.findall(text))
    for target in RELATIVE_REFERENCE.findall(text):
        resolved = resolve_relative(origin, target)
        if resolved:
            found.add(resolved)
    return found


def scan_roots(site: Path, cas_prefix: str) -> tuple[set[str], int]:
    """References made from outside the store: the roots of the traversal."""
    pattern = reference_pattern(cas_prefix)
    cas_dir = cas_prefix.strip('/')
    roots: set[str] = set()
    scanned = 0

    for path in site.rglob('*'):
        if not path.is_file():
            continue
        relative = path.relative_to(site)
        if relative.parts and relative.parts[0] == cas_dir:
            continue
        if path.suffix.lower() not in SCANNED_SUFFIXES and path.name not in SCANNED_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        roots.update(pattern.findall(text))

    return roots, scanned


def reachable_from(roots: set[str], entries: dict[str, Path], cas_prefix: str) -> set[str]:
    pattern = reference_pattern(cas_prefix)
    reachable: set[str] = set()
    frontier = [path for path in roots if path in entries]

    while frontier:
        current = frontier.pop()
        if current in reachable:
            continue
        reachable.add(current)

        path = entries[current]
        if path.suffix.lower() not in SCANNED_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        for found in references_in(text, current, pattern):
            if found in entries and found not in reachable:
                frontier.append(found)

    return reachable


def store_entries(site: Path, cas_prefix: str) -> dict[str, Path]:
    root = site / cas_prefix.strip('/')
    if not root.is_dir():
        return {}
    return {
        path.relative_to(root).as_posix(): path
        for path in root.rglob('*') if path.is_file()
    }


def prune_empty_directories(root: Path) -> int:
    removed = 0
    for path in sorted(root.rglob('*'), key=lambda p: -len(p.parts)):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
            removed += 1
    return removed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Remove unreferenced entries from the content-addressed store.')
    parser.add_argument('site', type=Path, help='path to the deployed site/ directory')
    parser.add_argument('--cas-prefix', default='/_cas')
    parser.add_argument('--dry-run', action='store_true',
                        help='report what would be removed, remove nothing')
    parser.add_argument('--check', action='store_true',
                        help='exit 1 if anything is unreferenced; remove nothing')
    parser.add_argument('--min-references', type=int, default=DEFAULT_MIN_REFERENCES,
                        help='refuse to delete when fewer references than this are found')
    args = parser.parse_args(argv)

    if not args.site.is_dir():
        print(f'error: not a directory: {args.site}', file=sys.stderr)
        return 2

    entries = store_entries(args.site, args.cas_prefix)
    if not entries:
        print(f'no store at {args.site / args.cas_prefix.strip("/")}; nothing to do')
        return 0

    roots, scanned = scan_roots(args.site, args.cas_prefix)
    referenced = reachable_from(roots, entries, args.cas_prefix)

    print(f'  scanned    {scanned:>6} files')
    print(f'  store      {len(entries):>6} entries')
    print(f'  roots      {len(roots & entries.keys()):>6} entries named by pages')
    print(f'  reachable  {len(referenced):>6} entries')

    dangling = sorted(roots - entries.keys())
    if dangling:
        print(f'\nerror: {len(dangling)} reference(s) point at entries that do not exist:',
              file=sys.stderr)
        for path in dangling[:10]:
            print(f'  /{args.cas_prefix.strip("/")}/{path}', file=sys.stderr)
        return 1

    if len(roots) < args.min_references:
        print(f'\nerror: only {len(roots)} reference(s) found across {scanned} files. '
              'Refusing to delete: an empty result is far more likely to mean the site '
              'was not fully checked out than to mean nothing uses the store.',
              file=sys.stderr)
        return 1

    unreferenced = sorted(set(entries) - referenced)
    reclaimed = sum(entries[path].stat().st_size for path in unreferenced)

    if not unreferenced:
        print('\nnothing to collect')
        return 0

    print(f'\n  unreferenced {len(unreferenced)} entries, {reclaimed / 1024:.1f} KiB')
    for path in unreferenced[:10]:
        print(f'    {path}')
    if len(unreferenced) > 10:
        print(f'    … and {len(unreferenced) - 10} more')

    if args.check:
        print('\nerror: the store holds unreferenced entries; run without --check to collect',
              file=sys.stderr)
        return 1

    if args.dry_run:
        print('\ndry run: nothing removed')
        return 0

    for path in unreferenced:
        entries[path].unlink()
    pruned = prune_empty_directories(args.site / args.cas_prefix.strip('/'))
    print(f'\nremoved {len(unreferenced)} entries and {pruned} empty directories')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
