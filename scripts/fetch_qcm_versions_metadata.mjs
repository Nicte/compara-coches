#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const MAPPING_JSON = path.join(ROOT, "data/spanish-to-canonical-mapping.json")
const MANUAL_METADATA_TS = path.join(ROOT, "src/data/car-metadata.ts")
const OUTPUT_JSON = path.join(ROOT, "data/qcm-versions-metadata.json")
const OUTPUT_TS = path.join(ROOT, "src/data/car-metadata-versions-auto.ts")

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

const SOURCE_PRIORITY = ["coches", "km77", "qcm"]

// Keep explicit seeds for known hard-to-discover KM77 routes.
const KM77_SEED_URLS_BY_ID = {
  "byd-byd-dolphin-surf": [
    "https://www.km77.com/coches/byd/dolphin-surf/2025/estandar/estandar/dolphin-surf-comfort/datos",
  ],
  "byd-byd-seal-u-dm-i": [
    "https://www.km77.com/coches/byd/seal-u/2024/estandar/phev/seal-u-dm-i-comfort/datos",
  ],
  "mercedes-benz-gla-250-e": [
    "https://www.km77.com/coches/mercedes/gla/2020/estandar/e/gla-250-e/datos",
  ],
  "mercedes-benz-glc-220-d-4matic": [
    "https://www.km77.com/coches/mercedes/clase-glc/2023/estandar/estandar/glc-220-d-4matic/datos",
  ],
  "mercedes-benz-glc-300-de-4matic": [
    "https://www.km77.com/coches/mercedes/clase-glc/2023/estandar/e/glc-300-de-4matic2/datos",
  ],
  "tesla-model-y": [
    "https://www.km77.com/coches/tesla/model-y/2025/estandar/estandar/model-y-standard/datos",
  ],
  "toyota-toyota-aygo-x": [
    "https://www.km77.com/coches/toyota/aygo-x/2026/5-puertas/estandar/aygo-x/datos",
  ],
}

function parseCliForcedIds(argv) {
  const forced = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--ids") {
      const next = argv[i + 1] ?? ""
      forced.push(
        ...next
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      )
      i += 1
      continue
    }
    if (arg.startsWith("--ids=")) {
      forced.push(
        ...arg
          .slice("--ids=".length)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      )
    }
  }
  return [...new Set(forced)]
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function compactModelSlug(value) {
  return value
    .replace(/-([0-9]+)/g, "$1")
    .replace(/([a-z])-([0-9])/g, "$1$2")
    .replace(/([a-z])\-([a-z])/g, "$1$2")
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parseManualMissingVersionIds(tsSource) {
  const entryRe = /^\s*"([^"]+)":\s*\{([\s\S]*?)^\s*\},\s*$/gm
  const ids = []
  for (const match of tsSource.matchAll(entryRe)) {
    const id = match[1]
    const body = match[2]
    if (!/\bversions\s*:\s*\[/m.test(body)) {
      ids.push(id)
    }
  }
  return ids
}

function buildCandidateSlugs(modelId, mapping) {
  const brand = slugify(mapping.canonicalBrand ?? "")
  const canonicalModel = (mapping.canonicalModel ?? "")
    .replace(/\b\d{4}\b/g, "")
    .trim()
  const canonicalName = (mapping.canonicalName ?? "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/^new\s+/i, "")
    .replace(/^nuevo\s+/i, "")
    .trim()
  const modelTail = modelId.replace(new RegExp(`^${escapeRegExp(brand)}-?`), "")

  const modelCandidates = [
    slugify(canonicalModel),
    slugify(
      canonicalName.replace(
        new RegExp(`^${escapeRegExp(mapping.canonicalBrand ?? "")}`, "i"),
        ""
      )
    ),
    slugify(modelTail),
  ].filter(Boolean)

  const candidates = new Set()
  for (const model of modelCandidates) {
    candidates.add(`${brand}-${model}`)
    candidates.add(`${brand}-${compactModelSlug(model)}`)
    candidates.add(`${brand}-${model.replace(/-/g, "")}`)
  }

  // Handful of known naming differences on source site.
  if (modelId === "toyota-toyota-aygo-x") {
    candidates.add("toyota-aygo-x-cross")
    candidates.add("toyota-aygo-x")
  }
  if (modelId.includes("glc")) {
    candidates.add("mercedes-benz-glc-coupe")
    candidates.add("mercedes-benz-clase-glc")
    candidates.add("mercedes-clase-glc")
    candidates.add("mercedes-glc")
  }
  if (modelId === "byd-byd-seal-u-dm-i") {
    candidates.add("byd-seal-u")
  }

  return [...candidates]
}

function buildKm77ModelCandidates(modelSlug) {
  const candidates = new Set([modelSlug])

  if (modelSlug.startsWith("clase-")) {
    candidates.add(modelSlug.replace(/^clase-/, ""))
  } else {
    candidates.add(`clase-${modelSlug}`)
  }

  const parts = modelSlug.split("-").filter(Boolean)
  if (parts.length >= 2) {
    candidates.add(parts[0])
  }
  for (let i = parts.length - 1; i >= 2 && i >= parts.length - 2; i -= 1) {
    candidates.add(parts.slice(0, i).join("-"))
  }

  return [...candidates].filter(Boolean)
}

function buildKm77StartUrls(brand, model) {
  const base = `https://www.km77.com/coches/${brand}/${model}`
  return [
    base,
    `${base}/datos`,
    `${base}/listado-completo`,
    `${base}/generaciones`,
  ]
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
    })
    if (!response.ok) {
      return null
    }
    return await response.text()
  } catch {
    return null
  }
}

function mapLabel(raw) {
  const value = raw.toUpperCase()
  if (/^0$/.test(value) || /(^|\s)0(\s|$)/.test(value)) {
    return "CERO"
  }
  if (value.includes("ZERO") || value.includes("CERO")) {
    return "CERO"
  }
  if (value.includes("ECO")) {
    return "ECO"
  }
  if (/\bB\b/.test(value)) {
    return "B"
  }
  if (/\bC\b/.test(value)) {
    return "C"
  }
  return null
}

function mapTransmission(versionName, fuelText) {
  const text = `${versionName} ${fuelText}`.toLowerCase()
  if (/(\bmanual\b|\bmt\b|\bmt6\b|\bmt5\b|\b6mt\b|\b5mt\b)/.test(text)) {
    return "manual"
  }
  if (
    /(\bcvt\b|\be-cvt\b|\bedc\b|\bdsg\b|\bdct\b|\bat\b|\bauto\b|\bautom)/.test(
      text
    )
  ) {
    return "automatic"
  }
  if (/(\belectric\b|\belectrico\b|\bev\b|\bhev\b|\bphev\b)/.test(text)) {
    return "automatic"
  }
  return null
}

function mapTransmissionFromLabel(text) {
  const value = (text ?? "").toLowerCase()
  if (!value) {
    return null
  }
  if (/manual/.test(value)) {
    return "manual"
  }
  if (/autom|auto|cvt|dsg|dct|edc/.test(value)) {
    return "automatic"
  }
  return null
}

function mapPowertrain(fuelText, versionName) {
  const text = `${fuelText} ${versionName}`.toLowerCase()
  if (/(\blpg\b|\bglp\b)/.test(text)) {
    return "lpg"
  }
  if (/(\bphev\b|enchufable)/.test(text)) {
    return "phev"
  }
  if (/\bmhev\b/.test(text)) {
    return "mhev"
  }
  if (/(\bhev\b|hibrid|h[ií]brido)/.test(text)) {
    return "hybrid"
  }
  if (/(\belectric\b|\belectrico\b|\bev\b|100% electr)/.test(text)) {
    return "electric"
  }
  if (/(diesel|gasoleo|gasóleo)/.test(text)) {
    return "diesel"
  }
  if (/gasolina/.test(text)) {
    return "gasoline"
  }
  return null
}

function parseRows(html) {
  const rowRe = /<tr[^>]*data-url="[^"]+"[^>]*>([\s\S]*?)<\/tr>/gi
  const rows = []
  for (const rowMatch of html.matchAll(rowRe)) {
    const row = rowMatch[1]
    const name =
      row.match(/<td[^>]*text-left[^>]*>\s*([^<]+?)\s*<\/td>/i)?.[1]?.trim() ??
      ""
    const labelRaw =
      row.match(/alt='Etiqueta medioambiental\s+([^']+)'/i)?.[1]?.trim() ?? ""
    const motor =
      row
        .match(
          /<td>\s*([^<]*?(?:Gasolina|Diesel|Di[eé]sel|H[ií]brido|HEV|PHEV|MHEV|El[eé]ctrico|EV|GLP)[^<]*)\s*<\/td>/i
        )?.[1]
        ?.trim() ?? ""

    if (!name || !labelRaw) {
      continue
    }

    rows.push({ name, labelRaw, motor })
  }
  return rows
}

function parseNextDataJson(html) {
  const match = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
  )
  if (!match) {
    return null
  }
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function collectCochesClassifiedNodes(root, output = []) {
  if (!root || typeof root !== "object") {
    return output
  }
  if (
    root.technicalData?.engine?.transmission?.name &&
    root.technicalData?.pollutionTag &&
    typeof root.name === "string"
  ) {
    output.push(root)
  }
  for (const value of Object.values(root)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectCochesClassifiedNodes(item, output)
      }
    } else if (value && typeof value === "object") {
      collectCochesClassifiedNodes(value, output)
    }
  }
  return output
}

function parseCochesVersions(html) {
  const nextData = parseNextDataJson(html)
  if (!nextData) {
    return []
  }

  const nodes = collectCochesClassifiedNodes(nextData)
  const versions = []
  const seen = new Set()

  for (const node of nodes) {
    const versionName = `${node.model?.name ?? ""} ${node.name ?? ""}`.trim()
    const fuelText = node.technicalData?.fuel?.name ?? ""
    const transmissionRaw = node.technicalData?.engine?.transmission?.name ?? ""
    const labelRaw = `${node.technicalData?.pollutionTag ?? ""}`.trim()

    const dgtLabel = mapLabel(labelRaw)
    const transmission =
      mapTransmissionFromLabel(transmissionRaw) ??
      mapTransmission(versionName, fuelText)
    const powertrain = mapPowertrain(fuelText, versionName)

    if (!dgtLabel || !transmission || !powertrain) {
      continue
    }

    const versionId = slugify(versionName).slice(0, 72)
    const key = `${powertrain}|${transmission}|${dgtLabel}|${versionId}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    versions.push({
      id: versionId,
      powertrain,
      transmission,
      dgtLabel,
    })
  }

  return versions
}

function htmlDecode(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
}

function stripHtml(value) {
  return htmlDecode(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractKm77Field(html, labels) {
  for (const label of labels) {
    const re = new RegExp(
      `<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`,
      "i"
    )
    const match = html.match(re)
    if (!match) {
      continue
    }

    const tdHtml = match[1]
    const titleMatch = tdHtml.match(/title=\"([^\"]+)\"/i)
    const raw = titleMatch?.[1] ?? stripHtml(tdHtml)
    if (raw) {
      return htmlDecode(raw).trim()
    }
  }
  return ""
}

function parseKm77SummaryVersions(html) {
  const gearbox = extractKm77Field(html, ["Caja de cambios"])
  const dgt = extractKm77Field(html, [
    "Distintivo medioambiental DGT",
    "Distintivo ambiental DGT",
  ])
  const fuel = extractKm77Field(html, ["Combustible"])
  const electricRange = extractKm77Field(html, ["Autonomía eléctrica WLTP"])

  if (!gearbox || !dgt) {
    return []
  }

  const gearboxes = gearbox
    .split(/[,/]| y /i)
    .map((v) => v.trim())
    .filter(Boolean)
  const labels = dgt
    .split(/[,/]| y /i)
    .map((v) => v.trim())
    .filter(Boolean)

  const versions = []
  const seen = new Set()
  const electricRangeKm = Number.parseInt(
    (electricRange.match(/\d+/)?.[0] ?? "0").trim(),
    10
  )

  let powertrain = mapPowertrain(fuel, "")
  if (electricRangeKm > 0) {
    if (powertrain === "gasoline" || powertrain === "diesel") {
      powertrain = "phev"
    } else if (!powertrain) {
      powertrain = "electric"
    }
  }
  if (
    powertrain === "gasoline" &&
    /eco/i.test(dgt) &&
    /(hybrid|h[ií]br|\bhev\b|\bmhev\b)/i.test(html)
  ) {
    powertrain = "hybrid"
  }

  const dgtLabelsToUse =
    electricRangeKm > 0
      ? labels
      : labels.filter((labelText) => mapLabel(labelText) !== "CERO")

  for (const g of gearboxes) {
    const transmission = mapTransmissionFromLabel(g)
    if (!transmission) {
      continue
    }
    for (const l of dgtLabelsToUse) {
      const dgtLabel = mapLabel(l)
      if (!dgtLabel) {
        continue
      }
      if (!powertrain) {
        continue
      }
      const versionId = slugify(
        `km77-${powertrain}-${transmission}-${dgtLabel}`
      )
      const key = `${powertrain}|${transmission}|${dgtLabel}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      versions.push({ id: versionId, powertrain, transmission, dgtLabel })
    }
  }
  return versions
}

function normalizeKm77Url(rawUrl) {
  if (!rawUrl) {
    return null
  }
  const trimmed = rawUrl.trim()
  if (/^javascript:/i.test(trimmed)) {
    return null
  }
  const absolute = trimmed.startsWith("http")
    ? trimmed
    : `https://www.km77.com${trimmed.startsWith("/") ? "" : "/"}${trimmed}`
  if (!absolute.startsWith("https://www.km77.com/coches/")) {
    return null
  }
  return absolute.replace(/#.*$/, "")
}

function extractKm77DataLinks(html) {
  const links = new Set()
  const hrefRe = /href=\"([^\"]+)\"/gi
  for (const match of html.matchAll(hrefRe)) {
    const normalized = normalizeKm77Url(match[1])
    if (!normalized) {
      continue
    }
    if (!/\/datos(\/equipamiento)?(\?|$)/.test(normalized)) {
      continue
    }
    links.add(normalized.replace(/\/datos\/equipamiento(\?|$)/, "/datos$1"))
  }
  return [...links]
}

function escapeTs(value) {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"')
}

function writeOutputTs(outputPath, versionsById) {
  const ids = Object.keys(versionsById).sort()
  const lines = []
  lines.push('import type { CarMetadata } from "@/data/car-metadata"')
  lines.push("")
  lines.push("// Auto-generated by scripts/fetch_qcm_versions_metadata.mjs")
  lines.push(
    "// Sources (priority): coches.com -> km77.com -> quecochemecompro.com"
  )
  lines.push(
    "export const carMetadataVersionsAutoById: Record<string, CarMetadata> = {"
  )

  for (const id of ids) {
    const versions = versionsById[id]
    lines.push(`  \"${escapeTs(id)}\": {`)
    lines.push("    versions: [")
    for (const version of versions) {
      lines.push("      {")
      lines.push(`        id: \"${escapeTs(version.id)}\",`)
      lines.push(`        powertrain: \"${version.powertrain}\",`)
      lines.push(`        transmission: \"${version.transmission}\",`)
      lines.push(`        dgtLabel: \"${version.dgtLabel}\",`)
      lines.push("      },")
    }
    lines.push("    ],")
    lines.push("  },")
  }

  lines.push("} as const")
  lines.push("")
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8")
}

async function main() {
  const mapping = JSON.parse(fs.readFileSync(MAPPING_JSON, "utf8"))
  const manualMetadataTs = fs.readFileSync(MANUAL_METADATA_TS, "utf8")
  const forcedIds = parseCliForcedIds(process.argv.slice(2))
  const targetIds = [
    ...new Set([
      ...parseManualMissingVersionIds(manualMetadataTs),
      ...forcedIds,
    ]),
  ]

  const enrichedById = {}
  const report = {
    generatedAt: new Date().toISOString(),
    sourcePriority: SOURCE_PRIORITY,
    targetCount: targetIds.length,
    resolvedCount: 0,
    models: {},
  }

  for (const id of targetIds) {
    const entry = mapping[id]
    if (!entry) {
      continue
    }

    const slugs = buildCandidateSlugs(id, entry)
    const brandSlug = slugify(entry.canonicalBrand ?? "")
    const modelSlugs = [
      ...new Set(
        slugs
          .map((slug) =>
            slug.replace(new RegExp(`^${escapeRegExp(brandSlug)}-`), "")
          )
          .filter(Boolean)
      ),
    ]

    const brandCandidates = [
      brandSlug,
      brandSlug.replace(/-benz$/, ""),
      brandSlug.replace(/-/, ""),
    ].filter(Boolean)

    let versions = []
    let sourceUsed = null
    let sourceUrl = null

    for (const slug of slugs) {
      const url = `https://www.coches.com/coches-nuevos/${slug}`
      // eslint-disable-next-line no-await-in-loop
      const html = await fetchText(url)
      if (!html) {
        continue
      }
      const parsed = parseCochesVersions(html)
      if (parsed.length === 0) {
        continue
      }
      versions = parsed
      sourceUsed = "coches"
      sourceUrl = url
      break
    }

    if (versions.length === 0) {
      for (const brand of brandCandidates) {
        for (const modelSlug of modelSlugs.slice(0, 8)) {
          const queue = [...(KM77_SEED_URLS_BY_ID[id] ?? [])]
          for (const model of buildKm77ModelCandidates(modelSlug)) {
            queue.push(...buildKm77StartUrls(brand, model))
          }
          const seenUrls = new Set()

          while (queue.length > 0 && seenUrls.size < 14) {
            const url = queue.shift()
            if (!url || seenUrls.has(url)) {
              continue
            }
            seenUrls.add(url)

            // eslint-disable-next-line no-await-in-loop
            const html = await fetchText(url)
            if (
              !html ||
              /window\.pageId\.current\s*=\s*'pf_error'/.test(html)
            ) {
              continue
            }

            const parsed = parseKm77SummaryVersions(html)
            if (parsed.length > 0) {
              versions = parsed
              sourceUsed = "km77"
              sourceUrl = url
              break
            }

            const discovered = extractKm77DataLinks(html)
            for (const discoveredUrl of discovered) {
              if (!seenUrls.has(discoveredUrl)) {
                queue.push(discoveredUrl)
              }
            }
          }
          if (versions.length > 0) {
            break
          }
        }
        if (versions.length > 0) {
          break
        }
      }
    }

    if (versions.length === 0) {
      for (const slug of slugs) {
        const url = `https://www.quecochemecompro.com/precios/${slug}/`
        // eslint-disable-next-line no-await-in-loop
        const html = await fetchText(url)
        if (!html) {
          continue
        }

        const rows = parseRows(html)
        const parsed = []
        const seen = new Set()

        for (const row of rows) {
          const dgtLabel = mapLabel(row.labelRaw)
          const transmission = mapTransmission(row.name, row.motor)
          const powertrain = mapPowertrain(row.motor, row.name)

          if (!dgtLabel || !transmission || !powertrain) {
            continue
          }

          const versionId = slugify(row.name).slice(0, 72)
          const key = `${powertrain}|${transmission}|${dgtLabel}|${versionId}`
          if (seen.has(key)) {
            continue
          }
          seen.add(key)

          parsed.push({
            id: versionId,
            powertrain,
            transmission,
            dgtLabel,
          })
        }

        if (parsed.length > 0) {
          versions = parsed
          sourceUsed = "qcm"
          sourceUrl = url
          break
        }
      }
    }

    if (versions.length === 0) {
      continue
    }

    enrichedById[id] = versions
    report.models[id] = {
      source: sourceUsed,
      sourceUrl,
      versionsCount: versions.length,
      transmissions: [...new Set(versions.map((v) => v.transmission))],
      dgtLabels: [...new Set(versions.map((v) => v.dgtLabel))],
      powertrains: [...new Set(versions.map((v) => v.powertrain))],
    }
  }

  report.resolvedCount = Object.keys(enrichedById).length

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8")
  writeOutputTs(OUTPUT_TS, enrichedById)

  console.log("Versions metadata fetch summary")
  console.log(`- target ids (missing versions): ${report.targetCount}`)
  if (forcedIds.length > 0) {
    console.log(`- forced ids (--ids): ${forcedIds.length}`)
  }
  console.log(`- enriched ids: ${report.resolvedCount}`)
  console.log(
    `- source usage: ${JSON.stringify(
      Object.values(report.models).reduce((acc, model) => {
        const key = model.source ?? "unknown"
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {})
    )}`
  )
  console.log(`- output JSON: ${OUTPUT_JSON}`)
  console.log(`- output TS: ${OUTPUT_TS}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
