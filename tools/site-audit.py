#!/usr/bin/env python3
"""
Liara Engine — audit of the generated documentation site.

Walks a deployed `site/` tree and reports the three numbers that constrain
the hosting layer:

  * how many files it contains,
  * how many of those files are byte-identical duplicates of one another,
  * how much of that duplication a content-addressed store could remove.

The script is deliberately dependency-free and runnable outside CI: point
it at a local checkout of the output repository and it prints the same
report a workflow would gate on.

Usage:
    site-audit.py <site-dir> [--json] [--max-files N] [--top N]
                             [--exclude GLOB ...]

Exit status is 1 when --max-files is given and exceeded, so the same
invocation serves as a CI gate.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

CF_LIMIT_FREE = 20_000
CF_LIMIT_PAID = 100_000

DEDUPABLE_SUFFIXES = frozenset({
    ".js", ".mjs", ".cjs", ".css", ".map",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico",
    ".wasm", ".md5",
})

READ_CHUNK = 1 << 20


@dataclass
class FileRecord:
    path: Path # relative to the site root
    size: int
    digest: str
    dedupable: bool


@dataclass
class GroupStats:
    """Aggregate counters for an arbitrary bucket (module, version, ext)."""
    files: int = 0
    bytes: int = 0
    digests: set[str] = field(default_factory=set)

    def add(self, record: FileRecord) -> None:
        self.files += 1
        self.bytes += record.size
        self.digests.add(record.digest)


def hash_file(path: Path) -> tuple[str, int]:
    """Return (sha256 hex digest, size in bytes) for a single file."""
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(READ_CHUNK):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def is_excluded(relative: Path, patterns: list[str]) -> bool:
    text = relative.as_posix()
    return any(fnmatch.fnmatch(text, pattern) for pattern in patterns)


def scan(root: Path, excludes: list[str]) -> list[FileRecord]:
    records: list[FileRecord] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root)
        if is_excluded(relative, excludes):
            continue
        digest, size = hash_file(path)
        records.append(FileRecord(
            path=relative,
            size=size,
            digest=digest,
            dedupable=path.suffix.lower() in DEDUPABLE_SUFFIXES,
        ))
    return records


def bucket_of(relative: Path) -> tuple[str, str]:
    parts = relative.parts
    if len(parts) <= 1:
        return "<root>", "<root>"
    if len(parts) == 2:
        return parts[0], "<none>"
    return parts[0], parts[1]


def analyse(records: list[FileRecord]) -> dict:
    total_files = len(records)
    total_bytes = sum(r.size for r in records)

    unique_size: dict[str, int] = {}
    occurrences: dict[str, int] = defaultdict(int)
    example: dict[str, str] = {}
    for record in records:
        unique_size[record.digest] = record.size
        occurrences[record.digest] += 1
        example.setdefault(record.digest, record.path.as_posix())

    unique_files = len(unique_size)
    unique_bytes = sum(unique_size.values())

    dedupable = [r for r in records if r.dedupable]
    dedupable_unique: dict[str, int] = {r.digest: r.size for r in dedupable}
    cas_files_saved = len(dedupable) - len(dedupable_unique)
    cas_bytes_saved = sum(r.size for r in dedupable) - sum(dedupable_unique.values())

    by_module: dict[str, GroupStats] = defaultdict(GroupStats)
    by_version: dict[str, GroupStats] = defaultdict(GroupStats)
    by_ext: dict[str, GroupStats] = defaultdict(GroupStats)
    for record in records:
        module, version = bucket_of(record.path)
        by_module[module].add(record)
        by_version[f"{module}/{version}"].add(record)
        by_ext[record.path.suffix.lower() or "<none>"].add(record)

    duplicates = sorted(
        (
            {
                "digest": digest[:16],
                "occurrences": count,
                "size": unique_size[digest],
                "wasted": unique_size[digest] * (count - 1),
                "example": example[digest],
            }
            for digest, count in occurrences.items()
            if count > 1
        ),
        key=lambda entry: entry["wasted"],
        reverse=True,
    )

    projected_files = total_files - cas_files_saved

    return {
        "total": {"files": total_files, "bytes": total_bytes},
        "unique_content": {"files": unique_files, "bytes": unique_bytes},
        "cas_projection": {
            "files_saved": cas_files_saved,
            "bytes_saved": cas_bytes_saved,
            "files_after": projected_files,
        },
        "cloudflare": {
            "limit_free": CF_LIMIT_FREE,
            "limit_paid": CF_LIMIT_PAID,
            "usage_free_pct": round(100 * total_files / CF_LIMIT_FREE, 2),
            "usage_free_pct_after_cas": round(100 * projected_files / CF_LIMIT_FREE, 2),
        },
        "by_module": {
            name: {"files": s.files, "bytes": s.bytes, "distinct": len(s.digests)}
            for name, s in sorted(by_module.items())
        },
        "by_version": {
            name: {"files": s.files, "bytes": s.bytes, "distinct": len(s.digests)}
            for name, s in sorted(by_version.items())
        },
        "by_extension": {
            name: {"files": s.files, "bytes": s.bytes, "distinct": len(s.digests)}
            for name, s in sorted(by_ext.items(),
                                 key=lambda kv: kv[1].files, reverse=True)
        },
        "top_duplicates": duplicates,
    }


def human(size: int) -> str:
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024 or unit == "GiB":
            return f"{value:,.1f} {unit}" if unit != "B" else f"{int(value):,} B"
        value /= 1024
    return f"{value:.1f} GiB"


def render(report: dict, top: int) -> str:
    lines: list[str] = []
    add = lines.append

    total = report["total"]
    unique = report["unique_content"]
    cas = report["cas_projection"]
    cloud = report["cloudflare"]

    add("=" * 68)
    add("  Liara documentation site — audit")
    add("=" * 68)
    add("")
    add(f"  Files                     {total['files']:>10,}")
    add(f"  Size                      {human(total['bytes']):>10}")
    add(f"  Distinct contents         {unique['files']:>10,}  "
        f"({human(unique['bytes'])})")
    add("")
    add("  Content-addressed store projection")
    add(f"    Files removable         {cas['files_saved']:>10,}")
    add(f"    Bytes removable         {human(cas['bytes_saved']):>10}")
    add(f"    Files after             {cas['files_after']:>10,}")
    add("")
    add("  Cloudflare Workers Static Assets budget")
    add(f"    Free plan   ({cloud['limit_free']:,} files)   "
        f"{cloud['usage_free_pct']:>6.2f}% used  ->  "
        f"{cloud['usage_free_pct_after_cas']:.2f}% after CAS")
    add("")

    add("  Per module")
    add(f"    {'module':<28}{'files':>9}{'size':>14}{'distinct':>11}")
    for name, stats in report["by_module"].items():
        add(f"    {name:<28}{stats['files']:>9,}"
            f"{human(stats['bytes']):>14}{stats['distinct']:>11,}")
    add("")

    add("  Per extension (top 10 by file count)")
    add(f"    {'ext':<28}{'files':>9}{'size':>14}{'distinct':>11}")
    for name, stats in list(report["by_extension"].items())[:10]:
        add(f"    {name:<28}{stats['files']:>9,}"
            f"{human(stats['bytes']):>14}{stats['distinct']:>11,}")
    add("")

    duplicates = report["top_duplicates"][:top]
    if duplicates:
        add(f"  Most duplicated contents (top {len(duplicates)})")
        add(f"    {'copies':>7}{'each':>12}{'wasted':>13}  example")
        for entry in duplicates:
            add(f"    {entry['occurrences']:>7,}{human(entry['size']):>12}"
                f"{human(entry['wasted']):>13}  {entry['example']}")
    else:
        add("  No duplicated contents found.")
    add("")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audit a generated Liara documentation site.")
    parser.add_argument("site", type=Path,
                        help="path to the deployed site/ directory")
    parser.add_argument("--json", action="store_true",
                        help="emit the raw report as JSON instead of a table")
    parser.add_argument("--top", type=int, default=15,
                        help="how many duplicated contents to list")
    parser.add_argument("--max-files", type=int, default=None,
                        help="exit 1 when the file count exceeds this value")
    parser.add_argument("--exclude", action="append", default=[],
                        metavar="GLOB",
                        help="skip paths matching this glob (repeatable)")
    args = parser.parse_args(argv)

    if not args.site.is_dir():
        print(f"error: not a directory: {args.site}", file=sys.stderr)
        return 2

    records = scan(args.site, args.exclude)
    if not records:
        print(f"error: no files found under {args.site}", file=sys.stderr)
        return 2

    report = analyse(records)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(render(report, args.top))

    if args.max_files is not None and report["total"]["files"] > args.max_files:
        print(f"error: {report['total']['files']:,} files exceeds the "
              f"--max-files budget of {args.max_files:,}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
