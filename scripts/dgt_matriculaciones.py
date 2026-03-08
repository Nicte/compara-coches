#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

MONTHLY_LIST_URL = (
    "https://www.dgt.es/menusecundario/dgt-en-cifras/matraba-listados/"
    "matriculaciones-automoviles-mensual.html"
)
DAILY_LIST_URL = (
    "https://www.dgt.es/menusecundario/dgt-en-cifras/matraba-listados/"
    "matriculaciones-automoviles-diario.html"
)

LINK_RE = re.compile(
    r"""href=["'](?P<url>(?:https?://www\.dgt\.es)?/microdatos/salida/[^"']+\.zip)["']""",
    re.IGNORECASE,
)
MONTHLY_RE = re.compile(r"export_mensual_mat_(\d{6})\.zip$")
DAILY_RE = re.compile(r"export_mat_(\d{8})\.zip$")


@dataclass
class DatasetEntry:
    dataset: str
    url: str
    filename: str
    file_date: str
    size_bytes: int | None = None
    last_modified: str | None = None
    status: str = "ok"
    error: str = ""


def fetch_text(url: str, timeout: int = 30) -> str:
    req = Request(url, headers={"User-Agent": "CodexDGTDownloader/1.0"})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def parse_links(list_url: str) -> list[str]:
    html = fetch_text(list_url)
    urls: set[str] = set()
    for match in LINK_RE.finditer(html):
        url = match.group("url")
        if url.startswith("http://") or url.startswith("https://"):
            urls.add(url)
        else:
            urls.add(urljoin("https://www.dgt.es", url))
    return sorted(urls)


def infer_file_date(filename: str) -> str:
    monthly = MONTHLY_RE.search(filename)
    if monthly:
        dt = datetime.strptime(monthly.group(1), "%Y%m")
        return dt.strftime("%Y-%m")
    daily = DAILY_RE.search(filename)
    if daily:
        dt = datetime.strptime(daily.group(1), "%Y%m%d")
        return dt.strftime("%Y-%m-%d")
    return ""


def build_entries(dataset: str) -> list[DatasetEntry]:
    entries: list[DatasetEntry] = []

    if dataset in ("monthly", "all"):
        for url in parse_links(MONTHLY_LIST_URL):
            filename = url.rsplit("/", 1)[-1]
            entries.append(
                DatasetEntry(
                    dataset="monthly",
                    url=url,
                    filename=filename,
                    file_date=infer_file_date(filename),
                )
            )

    if dataset in ("daily", "all"):
        for url in parse_links(DAILY_LIST_URL):
            filename = url.rsplit("/", 1)[-1]
            entries.append(
                DatasetEntry(
                    dataset="daily",
                    url=url,
                    filename=filename,
                    file_date=infer_file_date(filename),
                )
            )

    return entries


def filter_entries_by_date(
    entries: list[DatasetEntry],
    start_month: str | None = None,
    end_month: str | None = None,
    start_day: str | None = None,
    end_day: str | None = None,
) -> list[DatasetEntry]:
    out: list[DatasetEntry] = []
    for entry in entries:
        if entry.dataset == "monthly":
            if start_month and entry.file_date < start_month:
                continue
            if end_month and entry.file_date > end_month:
                continue
        elif entry.dataset == "daily":
            if start_day and entry.file_date < start_day:
                continue
            if end_day and entry.file_date > end_day:
                continue
        out.append(entry)
    return out


def keep_latest_monthly_entries(entries: list[DatasetEntry], latest_months: int) -> list[DatasetEntry]:
    if latest_months <= 0:
        return entries

    monthly = [entry for entry in entries if entry.dataset == "monthly" and entry.file_date]
    monthly.sort(key=lambda entry: entry.file_date)
    keep_monthly_filenames = {entry.filename for entry in monthly[-latest_months:]}

    out: list[DatasetEntry] = []
    for entry in entries:
        if entry.dataset == "monthly":
            if entry.filename in keep_monthly_filenames:
                out.append(entry)
        else:
            out.append(entry)
    return out


def parse_content_length(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def head_metadata(url: str, timeout: int = 30) -> tuple[int | None, str | None]:
    req = Request(url, method="HEAD", headers={"User-Agent": "CodexDGTDownloader/1.0"})
    with urlopen(req, timeout=timeout) as resp:
        size = parse_content_length(resp.headers.get("Content-Length"))
        last_modified = resp.headers.get("Last-Modified")
        return size, last_modified


def range_metadata(url: str, timeout: int = 30) -> tuple[int | None, str | None]:
    # Some servers reject HEAD; 1-byte range often returns total size in Content-Range.
    req = Request(
        url,
        headers={"Range": "bytes=0-0", "User-Agent": "CodexDGTDownloader/1.0"},
    )
    with urlopen(req, timeout=timeout) as resp:
        last_modified = resp.headers.get("Last-Modified")
        content_range = resp.headers.get("Content-Range", "")
        if "/" in content_range:
            total = content_range.rsplit("/", 1)[-1].strip()
            if total.isdigit():
                return int(total), last_modified
        size = parse_content_length(resp.headers.get("Content-Length"))
        return size, last_modified


def fill_metadata(entry: DatasetEntry, timeout: int = 30) -> DatasetEntry:
    try:
        size, last_modified = head_metadata(entry.url, timeout=timeout)
        entry.size_bytes = size
        entry.last_modified = last_modified
        return entry
    except (HTTPError, URLError):
        try:
            size, last_modified = range_metadata(entry.url, timeout=timeout)
            entry.size_bytes = size
            entry.last_modified = last_modified
            return entry
        except Exception as exc:  # noqa: BLE001
            entry.status = "error"
            entry.error = str(exc)
            return entry
    except Exception as exc:  # noqa: BLE001
        entry.status = "error"
        entry.error = str(exc)
        return entry


def enrich_metadata(entries: Iterable[DatasetEntry], workers: int = 12) -> list[DatasetEntry]:
    items = list(entries)
    if not items:
        return items

    out: list[DatasetEntry] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fill_metadata, item) for item in items]
        for future in as_completed(futures):
            out.append(future.result())

    out.sort(key=lambda x: (x.dataset, x.file_date, x.filename))
    return out


def human_size(size: int | None) -> str:
    if size is None:
        return "n/a"
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    return f"{value:.2f} {units[idx]}"


def write_manifest(entries: list[DatasetEntry], manifest_path: Path) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["dataset", "file_date", "filename", "size_bytes", "size_human", "last_modified", "url", "status", "error"]
        )
        for row in entries:
            writer.writerow(
                [
                    row.dataset,
                    row.file_date,
                    row.filename,
                    row.size_bytes if row.size_bytes is not None else "",
                    human_size(row.size_bytes),
                    row.last_modified or "",
                    row.url,
                    row.status,
                    row.error,
                ]
            )


def download_file(url: str, dest: Path, timeout: int = 60) -> None:
    req = Request(url, headers={"User-Agent": "CodexDGTDownloader/1.0"})
    with urlopen(req, timeout=timeout) as resp, dest.open("wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)


def destination_path(entry: DatasetEntry, out_dir: Path) -> Path:
    return out_dir / entry.dataset / entry.filename


def filter_missing_entries(entries: list[DatasetEntry], out_dir: Path) -> list[DatasetEntry]:
    return [entry for entry in entries if not destination_path(entry, out_dir).exists()]


def prune_local_files(entries: list[DatasetEntry], out_dir: Path, datasets: set[str]) -> int:
    removed = 0
    selected_by_dataset: dict[str, set[str]] = {}
    for dataset in datasets:
        selected_by_dataset[dataset] = {
            destination_path(entry, out_dir).name for entry in entries if entry.dataset == dataset
        }

    for dataset in datasets:
        dataset_dir = out_dir / dataset
        if not dataset_dir.exists():
            continue
        for path in dataset_dir.glob("*.zip"):
            if path.name not in selected_by_dataset[dataset]:
                path.unlink()
                removed += 1
    return removed


def download_entries(entries: list[DatasetEntry], out_dir: Path, overwrite: bool = False) -> None:
    for entry in entries:
        if entry.status != "ok":
            continue
        target = destination_path(entry, out_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not overwrite:
            continue
        download_file(entry.url, target)


def print_summary(entries: list[DatasetEntry]) -> None:
    by_dataset: dict[str, list[DatasetEntry]] = {"monthly": [], "daily": []}
    for item in entries:
        by_dataset.setdefault(item.dataset, []).append(item)

    print("DGT matriculaciones datasets")
    if not entries:
        print("- no files selected")
        return

    for dataset in ("monthly", "daily"):
        items = by_dataset.get(dataset, [])
        if not items:
            continue
        ok_items = [x for x in items if x.status == "ok"]
        known_sizes = [x.size_bytes for x in ok_items if x.size_bytes is not None]
        total = sum(known_sizes)
        earliest = min((x.file_date for x in items if x.file_date), default="")
        latest = max((x.file_date for x in items if x.file_date), default="")
        print(
            f"- {dataset}: files={len(items)}, earliest={earliest}, latest={latest}, "
            f"known_sizes={len(known_sizes)}, total={human_size(total)} ({total} bytes)"
        )

    largest = sorted([x for x in entries if x.size_bytes is not None], key=lambda x: x.size_bytes, reverse=True)[:10]
    if largest:
        print("\nTop 10 largest files:")
        for item in largest:
            print(f"  {item.dataset:7s} {item.file_date:10s} {human_size(item.size_bytes):>10s}  {item.filename}")

    errors = [x for x in entries if x.status != "ok"]
    if errors:
        print(f"\nErrors: {len(errors)}")
        for item in errors[:10]:
            print(f"  {item.dataset} {item.filename} -> {item.error}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download and size-report DGT microdatos de matriculaciones (monthly/daily)."
    )
    parser.add_argument("--dataset", choices=["monthly", "daily", "all"], default="all")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0, help="Limit number of files (for quick tests).")
    parser.add_argument("--start-month", help="Filter monthly files from YYYY-MM (inclusive).")
    parser.add_argument("--end-month", help="Filter monthly files to YYYY-MM (inclusive).")
    parser.add_argument("--start-day", help="Filter daily files from YYYY-MM-DD (inclusive).")
    parser.add_argument("--end-day", help="Filter daily files to YYYY-MM-DD (inclusive).")
    parser.add_argument(
        "--latest-months",
        type=int,
        default=0,
        help="Keep only latest N monthly files from source list after other filters.",
    )
    parser.add_argument("--manifest", type=Path, default=Path("data/dgt/manifest.csv"))
    parser.add_argument("--download", action="store_true", help="Download ZIP files after metadata collection.")
    parser.add_argument(
        "--download-missing-only",
        action="store_true",
        help="When used with --download, only download files not present in out-dir.",
    )
    parser.add_argument(
        "--no-metadata",
        action="store_true",
        help="Skip HTTP metadata (HEAD/Range) and manifest generation.",
    )
    parser.add_argument(
        "--prune-out-dir",
        action="store_true",
        help="Delete local ZIP files not selected by current filters (for selected dataset(s)).",
    )
    parser.add_argument("--out-dir", type=Path, default=Path("data/dgt"))
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    entries = build_entries(args.dataset)
    entries = filter_entries_by_date(
        entries,
        start_month=args.start_month,
        end_month=args.end_month,
        start_day=args.start_day,
        end_day=args.end_day,
    )
    entries = keep_latest_monthly_entries(entries, args.latest_months)
    if args.limit > 0:
        entries = entries[: args.limit]

    if args.prune_out_dir:
        datasets_to_prune = {entry.dataset for entry in entries}
        pruned = prune_local_files(entries, args.out_dir, datasets_to_prune)
        print(f"Pruned local files: {pruned}")

    download_entries_list = entries
    if args.download and args.download_missing_only and not args.overwrite:
        download_entries_list = filter_missing_entries(entries, args.out_dir)
        print(
            f"Missing files to download: {len(download_entries_list)} "
            f"(out of {len(entries)} selected from source list)"
        )

    if args.no_metadata:
        summary_entries = download_entries_list if args.download and args.download_missing_only else entries
        print_summary(summary_entries)
    else:
        metadata_entries = download_entries_list if args.download and args.download_missing_only else entries
        metadata_entries = enrich_metadata(metadata_entries, workers=args.workers)
        write_manifest(metadata_entries, args.manifest)
        print_summary(metadata_entries)

    if args.download:
        download_entries(download_entries_list, args.out_dir, overwrite=args.overwrite)
        print(f"\nDownloaded files to: {args.out_dir}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
