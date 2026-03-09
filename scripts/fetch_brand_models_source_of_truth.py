#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

BASE_URL = "https://www.automobiledimension.com/"
DEFAULT_TIMEOUT_SECONDS = 30
USER_AGENT = "CarComparisonBrandModelCrawler/1.0"

# Homepage logos link directly to pages like /audi-car-dimensions.html
BRAND_LINK_RE = re.compile(
    r'<a[^>]+href="(?P<href>/[a-z0-9\-]+-car-dimensions\.html)"[^>]*>\s*(?:<img[^>]*>)?\s*(?P<label>[^<]*)',
    re.I,
)

# Each brand page has repeated cards in <div class="unit"> with model title + link.
UNIT_BLOCK_RE = re.compile(
    r'<div class="unit">(?P<block>.*?)</div>\s*(?=(?:<div class="unit">|</section>))',
    re.S,
)
MODEL_LINK_RE = re.compile(r'<a href="(?P<href>/model/[^\"]+)"', re.I)
TITLE_RE = re.compile(r"<h2>(?P<title>.*?)</h2>", re.I | re.S)
IMAGE_RE = re.compile(r'<img class="fotos"[^>]*src="(?P<src>[^\"]+)"', re.I)
DIMENSIONS_RE = re.compile(r"L x W x H:\s*(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\s*mm", re.I)


def normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def html_to_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text)
    return normalize_spaces(text)


def fetch_text(url: str, timeout_seconds: int, retries: int) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for _ in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                return response.read().decode("utf-8", errors="ignore")
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
    if last_error is None:
        raise RuntimeError(f"Failed to fetch {url}")
    raise last_error


@dataclass(frozen=True)
class BrandPage:
    brand: str
    href: str


@dataclass(frozen=True)
class ModelEntry:
    name: str
    model_url: str
    image_url: str | None
    length_mm: int | None
    width_mm: int | None
    height_mm: int | None


def parse_brand_pages(home_html: str) -> list[BrandPage]:
    seen: set[str] = set()
    pages: list[BrandPage] = []

    for match in BRAND_LINK_RE.finditer(home_html):
        href = match.group("href")
        if href in seen:
            continue

        label = normalize_spaces(html.unescape(match.group("label") or ""))
        if not label:
            slug = href.rsplit("/", 1)[-1].replace("-car-dimensions.html", "")
            label = slug.replace("-", " ").upper()

        pages.append(BrandPage(brand=label, href=urljoin(BASE_URL, href)))
        seen.add(href)

    pages.sort(key=lambda item: item.brand)
    return pages


def parse_models_from_brand_page(brand_html: str) -> list[ModelEntry]:
    entries: list[ModelEntry] = []
    seen_urls: set[str] = set()

    for match in UNIT_BLOCK_RE.finditer(brand_html):
        block = match.group("block")

        title_match = TITLE_RE.search(block)
        link_match = MODEL_LINK_RE.search(block)
        if not title_match or not link_match:
            continue

        model_url = urljoin(BASE_URL, link_match.group("href"))
        if model_url in seen_urls:
            continue

        image_match = IMAGE_RE.search(block)
        image_url = urljoin(BASE_URL, image_match.group("src")) if image_match else None

        dimensions_match = DIMENSIONS_RE.search(html_to_text(block))
        length_mm = int(dimensions_match.group(1)) if dimensions_match else None
        width_mm = int(dimensions_match.group(2)) if dimensions_match else None
        height_mm = int(dimensions_match.group(3)) if dimensions_match else None

        entries.append(
            ModelEntry(
                name=html_to_text(title_match.group("title")),
                model_url=model_url,
                image_url=image_url,
                length_mm=length_mm,
                width_mm=width_mm,
                height_mm=height_mm,
            )
        )
        seen_urls.add(model_url)

    entries.sort(key=lambda item: item.name)
    return entries


def parse_trunk_liters(block_html: str) -> int | None:
    plain = html_to_text(block_html)

    boot_match = re.search(r"Boot space:\s*([^\.\n]+)", plain, re.I)
    if boot_match:
        numbers = [int(item) for item in re.findall(r"\d{2,4}", boot_match.group(1))]
        if numbers:
            return max(numbers)

    seats_match = re.search(r"With 5 seater:\s*([^\.\n]+)", plain, re.I)
    if seats_match:
        numbers = [int(item) for item in re.findall(r"\d{2,4}", seats_match.group(1))]
        if numbers:
            return max(numbers)

    return None


def parse_models_with_trunk_from_brand_page(brand_html: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    for match in UNIT_BLOCK_RE.finditer(brand_html):
        block = match.group("block")

        title_match = TITLE_RE.search(block)
        link_match = MODEL_LINK_RE.search(block)
        if not title_match or not link_match:
            continue

        model_url = urljoin(BASE_URL, link_match.group("href"))
        if model_url in seen_urls:
            continue

        image_match = IMAGE_RE.search(block)
        image_url = urljoin(BASE_URL, image_match.group("src")) if image_match else None

        dimensions_match = DIMENSIONS_RE.search(html_to_text(block))
        length_mm = int(dimensions_match.group(1)) if dimensions_match else None
        width_mm = int(dimensions_match.group(2)) if dimensions_match else None
        height_mm = int(dimensions_match.group(3)) if dimensions_match else None
        trunk_liters = parse_trunk_liters(block)

        entry: dict[str, Any] = {
            "name": html_to_text(title_match.group("title")),
            "modelUrl": model_url,
        }
        if image_url:
            entry["imageUrl"] = image_url
        if length_mm is not None:
            entry["lengthMm"] = length_mm
        if width_mm is not None:
            entry["widthMm"] = width_mm
        if height_mm is not None:
            entry["heightMm"] = height_mm
        if trunk_liters is not None:
            entry["trunkLiters"] = trunk_liters

        entries.append(entry)
        seen_urls.add(model_url)

    entries.sort(key=lambda item: item["name"])
    return entries


def load_previous_model_urls(path: Path) -> set[str]:
    if not path.exists():
        return set()

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()

    model_urls: set[str] = set()
    brands = data.get("brands") if isinstance(data, dict) else None
    if not isinstance(brands, list):
        return set()

    for brand in brands:
        if not isinstance(brand, dict):
            continue
        models = brand.get("models")
        if not isinstance(models, list):
            continue
        for model in models:
            if not isinstance(model, dict):
                continue
            model_url = model.get("modelUrl")
            if isinstance(model_url, str):
                model_urls.add(model_url)

    return model_urls


def detect_changes(
    previous_urls: set[str], current_urls: set[str]
) -> tuple[list[str], list[str]]:
    added = sorted(current_urls - previous_urls)
    removed = sorted(previous_urls - current_urls)
    return added, removed


def fetch_brand_models(
    brand_page: BrandPage, timeout_seconds: int, retries: int
) -> tuple[str, str, list[dict[str, Any]], str | None]:
    try:
        html_text = fetch_text(
            brand_page.href, timeout_seconds=timeout_seconds, retries=retries
        )
        models = parse_models_with_trunk_from_brand_page(html_text)
        return brand_page.brand, brand_page.href, models, None
    except Exception as exc:  # noqa: BLE001
        return brand_page.brand, brand_page.href, [], str(exc)


def build_output_document(brands: list[dict[str, Any]]) -> dict[str, Any]:
    total_models = sum(len(brand.get("models", [])) for brand in brands)
    model_urls = [
        model["modelUrl"]
        for brand in brands
        for model in brand.get("models", [])
        if isinstance(model, dict) and isinstance(model.get("modelUrl"), str)
    ]

    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": BASE_URL,
        "stats": {
            "brandCount": len(brands),
            "modelCount": total_models,
        },
        "brands": brands,
        "modelUrls": sorted(set(model_urls)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a source-of-truth brand/model list from automobiledimension.com"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/automobiledimension-brand-models.json"),
        help="Output JSON file path",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=12,
        help="Number of concurrent brand-page requests",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="HTTP timeout in seconds",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Retries per HTTP request",
    )
    parser.add_argument(
        "--limit-brands",
        type=int,
        default=0,
        help="Optional limit for development/testing",
    )
    args = parser.parse_args()

    previous_urls = load_previous_model_urls(args.output)

    home_html = fetch_text(BASE_URL, timeout_seconds=args.timeout, retries=args.retries)
    brand_pages = parse_brand_pages(home_html)
    if args.limit_brands > 0:
        brand_pages = brand_pages[: args.limit_brands]

    if not brand_pages:
        raise RuntimeError("No brand pages found on homepage")

    brands_out: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    max_workers = max(1, min(args.workers, len(brand_pages)))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [
            pool.submit(
                fetch_brand_models,
                brand_page,
                args.timeout,
                args.retries,
            )
            for brand_page in brand_pages
        ]

        for future in as_completed(futures):
            brand, href, models, error = future.result()
            if error:
                errors.append({"brand": brand, "url": href, "error": error})
                continue
            brands_out.append(
                {
                    "brand": brand,
                    "brandUrl": href,
                    "models": models,
                }
            )

    brands_out.sort(key=lambda item: item["brand"])
    output_doc = build_output_document(brands_out)

    current_urls = set(output_doc["modelUrls"])
    added, removed = detect_changes(previous_urls, current_urls)

    output_doc["changesFromPreviousRun"] = {
        "addedCount": len(added),
        "removedCount": len(removed),
        "addedModelUrls": added,
        "removedModelUrls": removed,
    }

    if errors:
        output_doc["errors"] = sorted(errors, key=lambda item: item["brand"])

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(output_doc, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print("Brand/model source-of-truth refresh")
    print(f"- output: {args.output}")
    print(f"- brands crawled: {output_doc['stats']['brandCount']}")
    print(f"- models discovered: {output_doc['stats']['modelCount']}")
    print(f"- new model URLs vs previous run: {len(added)}")
    print(f"- removed model URLs vs previous run: {len(removed)}")
    if errors:
        print(f"- brand-page errors: {len(errors)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
