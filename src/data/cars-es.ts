import {
  rollingSalesEndMonth,
  rollingSalesLabel,
  rollingSalesStartMonth,
  rollingSalesTopModels,
  rollingSalesWindowMonths,
} from "@/data/sales-rolling-12m"
import { carMetadataById } from "@/data/car-metadata"
import { carMetadataAutoById } from "@/data/car-metadata-auto"

export type PowertrainType =
  | "gasoline"
  | "diesel"
  | "hybrid"
  | "mhev"
  | "phev"
  | "electric"
  | "lpg"

export type TransmissionType = "manual" | "automatic"

export type DgtLabel = "B" | "C" | "ECO" | "CERO"

export type BodyType = "utilitario" | "compacto" | "suv-urbano" | "suv-compacto"

export type CarVersion = {
  id: string
  powertrain: PowertrainType
  transmission: TransmissionType
  dgtLabel: DgtLabel
}

export type Car = {
  id: string
  brand: string
  model: string
  salesRank12m: number
  salesUnits12m: number
  bodyType?: BodyType
  versions: CarVersion[]
  lengthMm?: number
  widthMm?: number
  trunkLiters?: number
  imageUrl?: string
}

export const powertrainLabels: Record<PowertrainType, string> = {
  gasoline: "Gasolina",
  diesel: "Diesel",
  hybrid: "Hibrido",
  mhev: "Microhibrido (MHEV)",
  phev: "Hibrido enchufable (PHEV)",
  electric: "Electrico",
  lpg: "GLP",
}

export const transmissionLabels: Record<TransmissionType, string> = {
  manual: "Manual",
  automatic: "Automatico",
}

export const dgtLabelLabels: Record<DgtLabel, string> = {
  B: "Etiqueta B",
  C: "Etiqueta C",
  ECO: "Etiqueta ECO",
  CERO: "Etiqueta Cero",
}

export const bodyTypeLabels: Record<BodyType, string> = {
  utilitario: "Utilitario",
  compacto: "Compacto",
  "suv-urbano": "SUV urbano",
  "suv-compacto": "SUV compacto",
}

function toDisplayBrand(brand: string) {
  if (brand.length <= 4) {
    return brand
  }
  return brand
    .toLowerCase()
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ")
}

function toDisplayModel(brand: string, model: string) {
  let cleaned = model
  if (cleaned.startsWith(`${brand} `)) {
    cleaned = cleaned.slice(brand.length + 1)
  }
  cleaned = cleaned
    .replace(/\bC HR\b/g, "C-HR")
    .replace(/\bRAV4\b/g, "RAV4")
    .replace(/\bT ROC\b/g, "T-Roc")
  return cleaned
    .toLowerCase()
    .split(" ")
    .map((token) => {
      if (!token) {
        return token
      }
      if (/[0-9]/.test(token) || token.includes("-")) {
        return token.toUpperCase() === "C-HR"
          ? "C-HR"
          : token
              .split("-")
              .map((part) =>
                part.length <= 2 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)
              )
              .join("-")
      }
      if (token.length <= 2) {
        return token.toUpperCase()
      }
      return token.charAt(0).toUpperCase() + token.slice(1)
    })
    .join(" ")
}

export const carsSpainTopSalesRolling12m: Car[] = rollingSalesTopModels.map(
  (model) => {
    const metadata = { ...carMetadataAutoById[model.id], ...carMetadataById[model.id] }
    return {
      id: model.id,
      brand: toDisplayBrand(model.brand),
      model: toDisplayModel(model.brand, model.model),
      salesRank12m: model.salesRank12m,
      salesUnits12m: model.salesUnits12m,
      bodyType: metadata?.bodyType,
      versions: metadata?.versions ?? [],
      lengthMm: metadata?.lengthMm,
      widthMm: metadata?.widthMm,
      trunkLiters: metadata?.trunkLiters,
      imageUrl: metadata?.imageUrl,
    }
  }
)

export const dataLastUpdated = "2026-03-08"
export const salesWindowMonths = rollingSalesWindowMonths
export const salesWindowStartMonth = rollingSalesStartMonth
export const salesWindowEndMonth = rollingSalesEndMonth
export const salesWindowLabel = rollingSalesLabel

export const dataSources = {
  salesRanking: {
    title: "DGT - Microdatos de Matriculaciones de Vehiculos (mensual, acceso a listados)",
    url: "https://www.dgt.es/menusecundario/dgt-en-cifras/matraba-listados/matriculaciones-automoviles-mensual.html",
  },
  modelMetadata: {
    title: "Cache local de metadatos (manual + auto) basada en Automobile Dimension, marcas y Wikipedia",
    url: "https://www.automobiledimension.com/",
  },
} as const
