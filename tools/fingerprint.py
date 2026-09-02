#!/usr/bin/env python3
"""
Liara Engine — content-addressed relocation of build assets.

Every version of every module is deployed to its own directory and never
rewritten afterwards, which is deliberate: a published URL keeps working.
The cost is that each directory carries a full copy of the assets, and the
audit of the live site put the duplication at 90% of its files.

This pass moves assets out of the version directory and into a store keyed
by content hash at the site root, rewriting every reference to match. Two
versions producing identical bytes then occupy one path instead of two, and
a browser that has already fetched one version's stylesheet does not fetch
it again for the next.

Astro does most of this already: it hashes its own output and, given
`build.assetsPrefix`, writes root-absolute URLs for it. But it still emits
the files under `_astro/` in the build directory, so the relocation is left
to whoever deploys. This script performs that relocation and extends the
same treatment to assets Astro copies verbatim from `public/`.

Usage:
    fingerprint.py --dist DIR --base /repo/version [--cas-prefix /_cas]
                   [--dry-run] [--json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

HASH_LENGTH = 16

# Assets whose bytes are their identity, so relocating them is safe and
# their references can be rewritten. HTML is excluded: a page's URL is part
# of its meaning, and two identical pages under two versions must both keep
# their own address.
LEAF_SUFFIXES = frozenset({
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
    '.wasm', '.mp4', '.webm',
})

REFERENCING_SUFFIXES = frozenset({'.css', '.js', '.mjs'})
TEXT_SUFFIXES = frozenset({'.html', '.css', '.js', '.mjs', '.json', '.xml', '.txt'})

# Directories left alone. Pagefind resolves its runtime, its wasm and its
# index against a single base path computed at load time, so the runtime
# cannot be moved without the index following it — and the index is
# per-version by nature. Splitting the bundle would mean patching Pagefind's
# own path resolution.
SKIP_DIRECTORIES = frozenset({'pagefind'})


@dataclass
class Relocation:
    source: Path # relative to dist
    old_url: str
    new_url: str
    digest: str
    size: int


@dataclass
class Report:
    moved: list[Relocation] = field(default_factory=list)
    rewritten: int = 0
    skipped: dict[str, int] = field(default_factory=dict)
    bytes_relocated: int = 0

    def as_dict(self) -> dict:
        return {
            'moved': len(self.moved),
            'bytes_relocated': self.bytes_relocated,
            'files_rewritten': self.rewritten,
            'skipped': self.skipped,
            'entries': [
                {'from': r.old_url, 'to': r.new_url, 'size': r.size}
                for r in sorted(self.moved, key=lambda r: -r.size)
            ],
        }


def digest_of(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open('rb') as handle:
        while chunk := handle.read(1 << 20):
            sha.update(chunk)
    return sha.hexdigest()[:HASH_LENGTH]


def normalise(prefix: str) -> str:
    """`/_cas/` and `_cas` and `/_cas` all mean the same thing."""
    return '/' + prefix.strip('/')


def is_skipped(relative: Path) -> bool:
    return bool(relative.parts) and relative.parts[0] in SKIP_DIRECTORIES


def collect(dist: Path, cas_dir: str, suffixes: frozenset[str]) -> list[Path]:
    found = []
    for path in sorted(dist.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(dist)
        if relative.parts and relative.parts[0] == cas_dir:
            continue
        if is_skipped(relative):
            continue
        if path.suffix.lower() in suffixes:
            found.append(path)
    return found


def replace_all(text: str, mapping: dict[str, str]) -> tuple[str, int]:
    """Replaces whole URLs, longest first.

    Longest-first matters: `/x/style.css` is a prefix of nothing, but
    `/x/a.png` and `/x/a.png.map` coexist, and replacing the shorter one
    first would corrupt the longer. Sorting by descending length removes
    the ordering hazard entirely rather than relying on it not arising.
    """
    count = 0
    for old in sorted(mapping, key=len, reverse=True):
        if old in text:
            count += text.count(old)
            text = text.replace(old, mapping[old])
    return text, count


def rewrite_files(paths: list[Path], mapping: dict[str, str], dry_run: bool) -> int:
    touched = 0
    for path in paths:
        try:
            original = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        updated, hits = replace_all(original, mapping)
        if hits and updated != original:
            touched += 1
            if not dry_run:
                path.write_text(updated, encoding='utf-8')
    return touched


def relocate(path: Path, dist: Path, cas_root: Path, cas_prefix: str,
             base: str, dry_run: bool) -> Relocation:
    relative = path.relative_to(dist)
    digest = digest_of(path)
    suffix = path.suffix.lower()

    target = cas_root / digest[:2] / f'{digest}{suffix}'
    new_url = f'{cas_prefix}/{digest[:2]}/{digest}{suffix}'
    old_url = f'{base.rstrip("/")}/{relative.as_posix()}'
    size = path.stat().st_size

    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.move(str(path), str(target))
        else:
            path.unlink()

    return Relocation(source=relative, old_url=old_url, new_url=new_url,
                      digest=digest, size=size)


def relocate_astro(dist: Path, cas_root: Path, dry_run: bool) -> int:
    """Moves Astro's own hashed output into the store.

    `build.assetsPrefix` makes Astro emit root-absolute URLs under the store
    prefix, but the files are still written to `_astro/` in the build
    directory. Nothing needs rewriting here — the URLs already point at the
    destination — only the files need to arrive where the URLs say they are.
    """
    source = dist / '_astro'
    if not source.is_dir():
        return 0

    moved = 0
    for path in sorted(source.rglob('*')):
        if not path.is_file():
            continue
        target = cas_root / '_astro' / path.relative_to(source)
        moved += 1
        if dry_run:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            path.unlink()
        else:
            shutil.move(str(path), str(target))

    if not dry_run:
        shutil.rmtree(source, ignore_errors=True)
    return moved


def fingerprint(dist: Path, base: str, cas_prefix: str, dry_run: bool) -> Report:
    cas_prefix = normalise(cas_prefix)
    cas_dir = cas_prefix.strip('/')
    cas_root = dist / cas_dir
    base = '/' + base.strip('/')
    report = Report()

    astro_moved = relocate_astro(dist, cas_root, dry_run)

    mapping: dict[str, str] = {}
    for path in collect(dist, cas_dir, LEAF_SUFFIXES):
        moved = relocate(path, dist, cas_root, cas_prefix, base, dry_run)
        mapping[moved.old_url] = moved.new_url
        report.moved.append(moved)
        report.bytes_relocated += moved.size

    if mapping:
        referencing = collect(dist, cas_dir, REFERENCING_SUFFIXES)
        report.rewritten += rewrite_files(referencing, mapping, dry_run)

    second: dict[str, str] = {}
    for path in collect(dist, cas_dir, REFERENCING_SUFFIXES):
        moved = relocate(path, dist, cas_root, cas_prefix, base, dry_run)
        second[moved.old_url] = moved.new_url
        report.moved.append(moved)
        report.bytes_relocated += moved.size

    mapping.update(second)

    if mapping:
        text_files = collect(dist, cas_dir, TEXT_SUFFIXES)
        report.rewritten += rewrite_files(text_files, mapping, dry_run)

    report.skipped = skip_census(dist, cas_dir)
    report.skipped['_astro (already hashed by Astro)'] = astro_moved
    return report


def skip_census(dist: Path, cas_dir: str) -> dict[str, int]:
    census: dict[str, int] = {}
    for directory in sorted(SKIP_DIRECTORIES):
        root = dist / directory
        if root.is_dir():
            census[directory] = sum(1 for p in root.rglob('*') if p.is_file())
    return census


def render(report: Report, dist: Path) -> str:
    remaining = sum(1 for p in dist.rglob('*') if p.is_file())
    lines = [
        '  Fingerprint',
        f'    Relocated            {len(report.moved):>6} files, '
        f'{report.bytes_relocated / 1024:.1f} KiB',
        f'    Rewritten            {report.rewritten:>6} files',
        f'    Left in the version  {remaining - sum(1 for p in (dist / "_cas").rglob("*") if p.is_file()) if (dist / "_cas").exists() else remaining:>6} files',
    ]
    if report.skipped:
        lines.append('    Not relocated:')
        for name, count in report.skipped.items():
            lines.append(f'      {name:<38} {count:>5} files')
    if report.moved:
        lines.append('    Largest entries:')
        for entry in sorted(report.moved, key=lambda r: -r.size)[:6]:
            lines.append(f'      {entry.size / 1024:>8.1f} KiB  {entry.source}')
    return '\n'.join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Relocate build assets into a content-addressed store.')
    parser.add_argument('--dist', type=Path, required=True,
                        help='the built site directory')
    parser.add_argument('--base', required=True,
                        help='deployment path of this build, e.g. /liara-core/1.2.0')
    parser.add_argument('--cas-prefix', default='/_cas',
                        help='root path of the content-addressed store')
    parser.add_argument('--dry-run', action='store_true',
                        help='report what would move without moving anything')
    parser.add_argument('--json', action='store_true',
                        help='emit the report as JSON')
    args = parser.parse_args(argv)

    if not args.dist.is_dir():
        print(f'error: not a directory: {args.dist}', file=sys.stderr)
        return 2

    report = fingerprint(args.dist, args.base, args.cas_prefix, args.dry_run)

    if args.json:
        print(json.dumps(report.as_dict(), indent=2))
    else:
        print(render(report, args.dist))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
