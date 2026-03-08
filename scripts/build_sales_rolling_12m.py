#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

MONTH_RE = re.compile(r"export_mensual_mat_(\d{6})\.zip$")


@dataclass(frozen=True)
class CarRule:
    car_id: str
    brand: str
    model_predicate: str


CAR_RULES: tuple[CarRule, ...] = (
    CarRule("dacia-sandero", "DACIA", "startswith:SANDERO"),
    CarRule("renault-clio", "RENAULT", "startswith:CLIO"),
    CarRule("mg-zs", "MG", "or:startswith:MG ZS|eq:ZS|startswith:ZS "),
    CarRule("seat-ibiza", "SEAT", "startswith:IBIZA"),
    CarRule("hyundai-tucson", "HYUNDAI", "startswith:TUCSON"),
    CarRule("toyota-corolla", "TOYOTA", "or:startswith:TOYOTA COROLLA|startswith:COROLLA"),
    CarRule("seat-arona", "SEAT", "startswith:ARONA"),
    CarRule("peugeot-2008", "PEUGEOT", "or:startswith:2008|startswith:E 2008"),
    CarRule("peugeot-208", "PEUGEOT", "startswith:208"),
    CarRule("nissan-qashqai", "NISSAN", "contains:QASHQAI"),
    CarRule("toyota-c-hr", "TOYOTA", "contains:C HR"),
    CarRule("toyota-yaris-cross", "TOYOTA", "contains:YARIS CROSS"),
    CarRule("renault-captur", "RENAULT", "startswith:CAPTUR"),
)

ACCENT_REPLACEMENTS = {
    "Á": "A",
    "É": "E",
    "Í": "I",
    "Ó": "O",
    "Ú": "U",
    "Ü": "U",
    "Ñ": "N",
}

MONTH_LABELS_ES = {
    "01": "Ene",
    "02": "Feb",
    "03": "Mar",
    "04": "Abr",
    "05": "May",
    "06": "Jun",
    "07": "Jul",
    "08": "Ago",
    "09": "Sep",
    "10": "Oct",
    "11": "Nov",
    "12": "Dic",
}


def normalize(value: str) -> str:
    text = value.upper()
    for source, target in ACCENT_REPLACEMENTS.items():
        text = text.replace(source, target)
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def month_from_filename(filename: str) -> str:
    match = MONTH_RE.search(filename)
    if not match:
        return ""
    raw = match.group(1)
    return f"{raw[:4]}-{raw[4:]}"


def load_monthly_files(monthly_dir: Path) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    for path in monthly_dir.glob("export_mensual_mat_*.zip"):
        month = month_from_filename(path.name)
        if month:
            out.append((month, path))
    out.sort(key=lambda item: item[0])
    return out


def eval_predicate(predicate: str, model: str) -> bool:
    if predicate.startswith("startswith:"):
        return model.startswith(predicate.split(":", 1)[1])
    if predicate.startswith("contains:"):
        return predicate.split(":", 1)[1] in model
    if predicate.startswith("eq:"):
        return model == predicate.split(":", 1)[1]
    if predicate.startswith("or:"):
        return any(eval_predicate(item, model) for item in predicate.split(":", 1)[1].split("|"))
    raise ValueError(f"Unsupported predicate: {predicate}")


def label_month_es(month: str) -> str:
    year, month_num = month.split("-")
    return f"{MONTH_LABELS_ES[month_num]} {year}"


def make_model_id(brand: str, model: str, used_ids: set[str]) -> str:
    raw = f"{brand}-{model}".lower()
    candidate = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    if not candidate:
        candidate = "model"
    base = candidate
    suffix = 2
    while candidate in used_ids:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used_ids.add(candidate)
    return candidate


def select_top_models(
    official_counts: Counter[tuple[str, str]],
    top_n: int,
    min_units: int,
) -> list[tuple[str, str, int]]:
    selected = [
        (brand, model, units)
        for (brand, model), units in official_counts.items()
        if units >= min_units
    ]
    selected.sort(key=lambda item: (-item[2], item[0], item[1]))
    return selected[:top_n]


def ts_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def compute_sales(
    monthly_files: list[tuple[str, Path]],
    window_months: int,
) -> tuple[str, str, Counter[str], Counter[tuple[str, str]]]:
    if len(monthly_files) < window_months:
        raise RuntimeError(
            f"Need at least {window_months} monthly files in {monthly_files[0][1].parent} "
            f"but found {len(monthly_files)}."
        )

    selected = monthly_files[-window_months:]
    start_month = selected[0][0]
    end_month = selected[-1][0]

    curated_counts: Counter[str] = Counter()
    official_counts: Counter[tuple[str, str]] = Counter()
    for _, path in selected:
        with zipfile.ZipFile(path) as archive:
            txt_name = archive.namelist()[0]
            lines = archive.read(txt_name).decode("cp1252", errors="replace").splitlines()

        for index, line in enumerate(lines):
            if index == 0 or len(line) < 430:
                continue

            # Category starts at fixed position in DGT record layout.
            if line[426:428] != "M1":
                continue

            brand = normalize(line[17:47])
            model = normalize(line[47:69])
            if not brand or not model:
                continue

            official_counts[(brand, model)] += 1

            for rule in CAR_RULES:
                if brand == rule.brand and eval_predicate(rule.model_predicate, model):
                    curated_counts[rule.car_id] += 1
                    break

    return start_month, end_month, curated_counts, official_counts


def write_output(
    output_path: Path,
    start_month: str,
    end_month: str,
    window_months: int,
    curated_counts: Counter[str],
    top_models: list[tuple[str, str, int]],
    top_n: int,
    min_units: int,
) -> None:
    ranking = sorted(
        [(rule.car_id, curated_counts.get(rule.car_id, 0)) for rule in CAR_RULES],
        key=lambda item: item[1],
        reverse=True,
    )
    ranks = {car_id: index for index, (car_id, _) in enumerate(ranking, start=1)}

    lines: list[str] = []
    lines.append("// Auto-generated by scripts/build_sales_rolling_12m.py")
    lines.append("// Source: DGT monthly microdata files in data/dgt/monthly")
    lines.append("")
    lines.append(f'export const rollingSalesWindowMonths = {window_months} as const')
    lines.append(f'export const rollingSalesStartMonth = "{start_month}" as const')
    lines.append(f'export const rollingSalesEndMonth = "{end_month}" as const')
    lines.append(f'export const rollingSalesLabel = "{label_month_es(start_month)} - {label_month_es(end_month)}" as const')
    lines.append(f"export const rollingSalesTopNRequested = {top_n} as const")
    lines.append(f"export const rollingSalesMinUnits = {min_units} as const")
    lines.append("")
    lines.append("export const rollingSalesUnitsByCarId = {")
    for car_id, _ in ranking:
        lines.append(f'  "{car_id}": {curated_counts.get(car_id, 0)},')
    lines.append("} as const")
    lines.append("")
    lines.append("export const rollingSalesRankByCarId = {")
    for car_id, _ in ranking:
        lines.append(f'  "{car_id}": {ranks[car_id]},')
    lines.append("} as const")
    lines.append("")
    lines.append("export const rollingSalesTopModels = [")
    used_ids: set[str] = set()
    for index, (brand, model, units) in enumerate(top_models, start=1):
        model_id = make_model_id(brand, model, used_ids)
        lines.append("  {")
        lines.append(f'    id: "{model_id}",')
        lines.append(f'    brand: "{ts_string(brand)}",')
        lines.append(f'    model: "{ts_string(model)}",')
        lines.append(f"    salesRank12m: {index},")
        lines.append(f"    salesUnits12m: {units},")
        lines.append("  },")
    lines.append("] as const")
    lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build rolling 12-month per-model sales map from DGT monthly files."
    )
    parser.add_argument(
        "--monthly-dir",
        type=Path,
        default=Path("data/dgt/monthly"),
        help="Directory containing export_mensual_mat_YYYYMM.zip files.",
    )
    parser.add_argument(
        "--window-months",
        type=int,
        default=12,
        help="Rolling window size in months.",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=100,
        help="Number of official models to keep in rollingSalesTopModels.",
    )
    parser.add_argument(
        "--min-units",
        type=int,
        default=1000,
        help="Minimum 12-month registrations to include in rollingSalesTopModels.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/data/sales-rolling-12m.ts"),
        help="Generated TypeScript output path.",
    )
    args = parser.parse_args()

    monthly_files = load_monthly_files(args.monthly_dir)
    if not monthly_files:
        raise RuntimeError(f"No monthly ZIP files found in {args.monthly_dir}")

    start_month, end_month, curated_counts, official_counts = compute_sales(
        monthly_files, args.window_months
    )
    top_models = select_top_models(
        official_counts,
        top_n=args.top_n,
        min_units=args.min_units,
    )
    write_output(
        args.output,
        start_month,
        end_month,
        args.window_months,
        curated_counts,
        top_models,
        args.top_n,
        args.min_units,
    )

    print("Generated rolling sales data")
    print(f"- Months: {start_month} to {end_month} ({args.window_months} months)")
    print(
        f"- Official top models kept: {len(top_models)} "
        f"(top_n={args.top_n}, min_units={args.min_units})"
    )
    for index, (car_id, units) in enumerate(curated_counts.most_common(), start=1):
        print(f"  {index:2d}. {car_id:20s} {units}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
