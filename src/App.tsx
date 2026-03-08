import { useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CarFront,
  Filter,
  ImageOff,
  Info,
  List,
  MoveHorizontal,
  Ruler,
  Search,
  Table as TableIcon,
  Trash2,
  Trees,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  bodyTypeLabels,
  carsSpainTopSalesRolling12m,
  dataLastUpdated,
  dataSources,
  dgtLabelLabels,
  salesWindowLabel,
  salesWindowMonths,
  type Car,
  type CarVersion,
  type BodyType,
  type DgtLabel,
  powertrainLabels,
  type PowertrainType,
  transmissionLabels,
  type TransmissionType,
} from "@/data/cars-es"

type SortField =
  | "salesUnits12m"
  | "brandModel"
  | "lengthMm"
  | "widthMm"
  | "trunkLiters"

type SortDirection = "asc" | "desc"
type ViewMode = "cards" | "table"
type TableColumnKey =
  | "photo"
  | "model"
  | "salesUnits12m"
  | "bodyType"
  | "dgtLabels"
  | "transmissions"
  | "powertrains"
  | "lengthMm"
  | "widthMm"
  | "trunkLiters"
type ResultsLimit = "15" | "30" | "50" | "all"

type Filters = {
  query: string
  powertrains: PowertrainType[]
  transmissions: TransmissionType[]
  dgtLabels: DgtLabel[]
  bodyTypes: BodyType[]
  minLength?: number
  maxLength?: number
  minWidth?: number
  maxWidth?: number
  minTrunk?: number
  maxTrunk?: number
}

type UrlState = {
  filters: Filters
  sortField: SortField
  sortDirection: SortDirection
  viewMode: ViewMode
  visibleColumns: TableColumnKey[]
  resultsLimit: ResultsLimit
}

type CarWithVisibleVersions = Car & {
  matchingVersions: CarVersion[]
  visiblePowertrains: PowertrainType[]
  visibleTransmissions: TransmissionType[]
  visibleDgtLabels: DgtLabel[]
}

const defaultSortField: SortField = "salesUnits12m"
const defaultSortDirection: SortDirection = "desc"
const defaultViewMode: ViewMode = "cards"
const defaultResultsLimit: ResultsLimit = "15"
const resultsLimitOptions: Array<{ value: ResultsLimit; label: string }> = [
  { value: "15", label: "15 coches" },
  { value: "30", label: "30 coches" },
  { value: "50", label: "50 coches" },
  { value: "all", label: "Todos" },
]

const queryParamKeys = {
  query: "q",
  powertrains: "motor",
  transmissions: "cambio",
  dgtLabels: "etiqueta",
  bodyTypes: "tipo",
  minLength: "minLength",
  maxLength: "maxLength",
  minWidth: "minWidth",
  maxWidth: "maxWidth",
  minTrunk: "minTrunk",
  maxTrunk: "maxTrunk",
  sortBy: "sortBy",
  sortDir: "sortDir",
  view: "view",
  columns: "cols",
  limit: "limit",
} as const

const powertrainOptions = Object.entries(powertrainLabels) as Array<
  [PowertrainType, string]
>
const transmissionOptions = Object.entries(transmissionLabels) as Array<
  [TransmissionType, string]
>
const dgtLabelOptions = Object.entries(dgtLabelLabels) as Array<
  [DgtLabel, string]
>
const bodyTypeOptions = Object.entries(bodyTypeLabels) as Array<
  [BodyType, string]
>
const availablePowertrainOptions = powertrainOptions.filter(([value]) =>
  carsSpainTopSalesRolling12m.some((car) =>
    car.versions.some((version) => version.powertrain === value)
  )
)
const availableTransmissionOptions = transmissionOptions.filter(([value]) =>
  carsSpainTopSalesRolling12m.some((car) =>
    car.versions.some((version) => version.transmission === value)
  )
)
const availableDgtLabelOptions = dgtLabelOptions.filter(([value]) =>
  carsSpainTopSalesRolling12m.some((car) =>
    car.versions.some((version) => version.dgtLabel === value)
  )
)
const availableBodyTypeOptions = bodyTypeOptions.filter(([value]) =>
  carsSpainTopSalesRolling12m.some((car) => car.bodyType === value)
)
const hasLengthData = carsSpainTopSalesRolling12m.some(
  (car) => typeof car.lengthMm === "number"
)
const hasWidthData = carsSpainTopSalesRolling12m.some(
  (car) => typeof car.widthMm === "number"
)
const hasTrunkData = carsSpainTopSalesRolling12m.some(
  (car) => typeof car.trunkLiters === "number"
)
const hasVersionMetadata =
  availablePowertrainOptions.length > 0 ||
  availableTransmissionOptions.length > 0 ||
  availableDgtLabelOptions.length > 0
const hasExtendedMetadata =
  hasVersionMetadata ||
  availableBodyTypeOptions.length > 0 ||
  hasLengthData ||
  hasWidthData ||
  hasTrunkData

const tableColumnDefinitions: Array<{
  key: TableColumnKey
  label: string
  sortField?: SortField
}> = [
  { key: "photo", label: "Foto" },
  { key: "model", label: "Modelo", sortField: "brandModel" },
  {
    key: "salesUnits12m",
    label: `Ranking ${salesWindowMonths}m`,
    sortField: "salesUnits12m",
  },
  { key: "bodyType", label: "Tipo" },
  { key: "dgtLabels", label: "Etiqueta" },
  { key: "transmissions", label: "Cambio" },
  { key: "powertrains", label: "Motores" },
  { key: "lengthMm", label: "Longitud", sortField: "lengthMm" },
  { key: "widthMm", label: "Anchura", sortField: "widthMm" },
  { key: "trunkLiters", label: "Maletero", sortField: "trunkLiters" },
]
const allTableColumns = tableColumnDefinitions.map((column) => column.key)

const defaultVisibleColumns: TableColumnKey[] = [
  "model",
  "salesUnits12m",
  "photo",
  "dgtLabels",
  "transmissions",
  "lengthMm",
  "trunkLiters",
]
const defaultSortDirectionByField: Record<SortField, SortDirection> = {
  salesUnits12m: "desc",
  brandModel: "asc",
  lengthMm: "asc",
  widthMm: "asc",
  trunkLiters: "asc",
}
const sortFieldLabels: Record<SortField, string> = {
  salesUnits12m: `Ranking ${salesWindowMonths}m`,
  brandModel: "Marca/Modelo",
  lengthMm: "Longitud",
  widthMm: "Anchura",
  trunkLiters: "Maletero",
}
const appName = "Rueda"

const integerFormatter = new Intl.NumberFormat("es-ES")
const naText = "N/D"

function compareOptionalNumber(
  left: number | undefined,
  right: number | undefined
) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right
  }
  if (typeof left === "number") {
    return -1
  }
  if (typeof right === "number") {
    return 1
  }
  return 0
}

function formatOptionalNumber(value: number | undefined, suffix: string) {
  if (typeof value !== "number") {
    return naText
  }
  return `${integerFormatter.format(value)} ${suffix}`
}

function parseInteger(value: string | null) {
  if (value === null || value.trim() === "") {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return undefined
  }

  return parsed
}

function parseMultiValue<T extends string>(
  value: string | null,
  allowed: ReadonlySet<string>
): T[] {
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is T => allowed.has(item))
}

function parseSortField(value: string | null): SortField {
  const allowedValues = new Set<SortField>([
    "salesUnits12m",
    "brandModel",
    "lengthMm",
    "widthMm",
    "trunkLiters",
  ])

  if (value && allowedValues.has(value as SortField)) {
    return value as SortField
  }

  return defaultSortField
}

function parseSortDirection(value: string | null): SortDirection {
  if (value === "asc" || value === "desc") {
    return value
  }

  return defaultSortDirection
}

function parseViewMode(value: string | null): ViewMode {
  if (value === "cards" || value === "table") {
    return value
  }

  return defaultViewMode
}

function parseResultsLimit(value: string | null): ResultsLimit {
  if (value === "15" || value === "30" || value === "50" || value === "all") {
    return value
  }

  return defaultResultsLimit
}

function parseVisibleColumns(value: string | null): TableColumnKey[] {
  if (!value) {
    return defaultVisibleColumns
  }

  const allowedColumns = new Set(allTableColumns)
  const selectedColumns = value
    .split(",")
    .map((column) => column.trim())
    .filter((column): column is TableColumnKey =>
      allowedColumns.has(column as TableColumnKey)
    )

  if (selectedColumns.length === 0) {
    return defaultVisibleColumns
  }

  return allTableColumns.filter((column) => selectedColumns.includes(column))
}

function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search)

  const powertrainSet = new Set(powertrainOptions.map(([value]) => value))
  const transmissionSet = new Set(transmissionOptions.map(([value]) => value))
  const dgtLabelSet = new Set(dgtLabelOptions.map(([value]) => value))
  const bodyTypeSet = new Set(bodyTypeOptions.map(([value]) => value))

  return {
    filters: {
      query: params.get(queryParamKeys.query)?.trim() ?? "",
      powertrains: parseMultiValue<PowertrainType>(
        params.get(queryParamKeys.powertrains),
        powertrainSet
      ),
      transmissions: parseMultiValue<TransmissionType>(
        params.get(queryParamKeys.transmissions),
        transmissionSet
      ),
      dgtLabels: parseMultiValue<DgtLabel>(
        params.get(queryParamKeys.dgtLabels),
        dgtLabelSet
      ),
      bodyTypes: parseMultiValue<BodyType>(
        params.get(queryParamKeys.bodyTypes),
        bodyTypeSet
      ),
      minLength: parseInteger(params.get(queryParamKeys.minLength)),
      maxLength: parseInteger(params.get(queryParamKeys.maxLength)),
      minWidth: parseInteger(params.get(queryParamKeys.minWidth)),
      maxWidth: parseInteger(params.get(queryParamKeys.maxWidth)),
      minTrunk: parseInteger(params.get(queryParamKeys.minTrunk)),
      maxTrunk: parseInteger(params.get(queryParamKeys.maxTrunk)),
    },
    sortField: parseSortField(params.get(queryParamKeys.sortBy)),
    sortDirection: parseSortDirection(params.get(queryParamKeys.sortDir)),
    viewMode: parseViewMode(params.get(queryParamKeys.view)),
    visibleColumns: parseVisibleColumns(params.get(queryParamKeys.columns)),
    resultsLimit: parseResultsLimit(params.get(queryParamKeys.limit)),
  }
}

function serializeUrlState(state: UrlState): string {
  const params = new URLSearchParams()

  const setMultiValue = (key: string, values: string[]) => {
    if (values.length > 0) {
      params.set(key, [...values].sort().join(","))
    }
  }

  const setNumericValue = (key: string, value: number | undefined) => {
    if (typeof value === "number") {
      params.set(key, String(value))
    }
  }

  if (state.filters.query.trim()) {
    params.set(queryParamKeys.query, state.filters.query.trim())
  }

  setMultiValue(queryParamKeys.powertrains, state.filters.powertrains)
  setMultiValue(queryParamKeys.transmissions, state.filters.transmissions)
  setMultiValue(queryParamKeys.dgtLabels, state.filters.dgtLabels)
  setMultiValue(queryParamKeys.bodyTypes, state.filters.bodyTypes)

  setNumericValue(queryParamKeys.minLength, state.filters.minLength)
  setNumericValue(queryParamKeys.maxLength, state.filters.maxLength)
  setNumericValue(queryParamKeys.minWidth, state.filters.minWidth)
  setNumericValue(queryParamKeys.maxWidth, state.filters.maxWidth)
  setNumericValue(queryParamKeys.minTrunk, state.filters.minTrunk)
  setNumericValue(queryParamKeys.maxTrunk, state.filters.maxTrunk)

  if (state.sortField !== defaultSortField) {
    params.set(queryParamKeys.sortBy, state.sortField)
  }

  if (state.sortDirection !== defaultSortDirection) {
    params.set(queryParamKeys.sortDir, state.sortDirection)
  }

  if (state.viewMode !== defaultViewMode) {
    params.set(queryParamKeys.view, state.viewMode)
  }

  if (state.visibleColumns.join(",") !== defaultVisibleColumns.join(",")) {
    params.set(queryParamKeys.columns, state.visibleColumns.join(","))
  }

  if (state.resultsLimit !== defaultResultsLimit) {
    params.set(queryParamKeys.limit, state.resultsLimit)
  }

  return params.toString()
}

function uniqueOrdered<T extends string>(values: T[], order: T[]) {
  const selected = new Set(values)
  return order.filter((value) => selected.has(value))
}

function versionMatchesFilters(version: CarVersion, filters: Filters) {
  if (
    filters.powertrains.length > 0 &&
    !filters.powertrains.includes(version.powertrain)
  ) {
    return false
  }

  if (
    filters.transmissions.length > 0 &&
    !filters.transmissions.includes(version.transmission)
  ) {
    return false
  }

  if (
    filters.dgtLabels.length > 0 &&
    !filters.dgtLabels.includes(version.dgtLabel)
  ) {
    return false
  }

  return true
}

function toggleArrayValue<T extends string>(
  items: T[],
  value: T,
  shouldBeIncluded: boolean
): T[] {
  const alreadyIncluded = items.includes(value)

  if (shouldBeIncluded && !alreadyIncluded) {
    return [...items, value]
  }

  if (!shouldBeIncluded && alreadyIncluded) {
    return items.filter((currentValue) => currentValue !== value)
  }

  return items
}

function AppLogo() {
  return (
    <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-white/25 bg-black/20 shadow-lg backdrop-blur-sm">
      <div className="absolute inset-0 bg-linear-to-br from-cyan-300 via-sky-400 to-emerald-400 opacity-85" />
      <div className="absolute inset-[3px] rounded-xl bg-slate-950/80" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative h-7 w-7">
          <div className="absolute inset-0 rounded-full border-2 border-cyan-200/80" />
          <div className="absolute inset-[7px] rounded-full bg-cyan-300" />
          <div className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-950" />
        </div>
      </div>
    </div>
  )
}

function App() {
  const [state, setState] = useState<UrlState>(() =>
    parseUrlState(window.location.search)
  )
  const [isColumnPanelOpen, setIsColumnPanelOpen] = useState(false)
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set())

  const {
    filters,
    sortField,
    sortDirection,
    viewMode,
    visibleColumns,
    resultsLimit,
  } = state

  useEffect(() => {
    const handlePopstate = () => {
      setState(parseUrlState(window.location.search))
    }

    window.addEventListener("popstate", handlePopstate)
    return () => window.removeEventListener("popstate", handlePopstate)
  }, [])

  useEffect(() => {
    if (viewMode !== "table") {
      setIsColumnPanelOpen(false)
    }
  }, [viewMode])

  useEffect(() => {
    const queryString = serializeUrlState(state)
    const current = window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : window.location.search

    if (queryString === current) {
      return
    }

    const nextUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname

    window.history.replaceState(null, "", nextUrl)
  }, [state])

  const filteredCars = useMemo<CarWithVisibleVersions[]>(() => {
    const normalizedQuery = filters.query.trim().toLowerCase()
    const powertrainOrder = powertrainOptions.map(([value]) => value)
    const transmissionOrder = transmissionOptions.map(([value]) => value)
    const dgtLabelOrder = dgtLabelOptions.map(([value]) => value)

    return carsSpainTopSalesRolling12m
      .map((car) => {
        if (
          normalizedQuery &&
          !`${car.brand} ${car.model}`.toLowerCase().includes(normalizedQuery)
        ) {
          return null
        }

        if (
          filters.bodyTypes.length > 0 &&
          (!car.bodyType || !filters.bodyTypes.includes(car.bodyType))
        ) {
          return null
        }

        if (
          typeof filters.minLength === "number" &&
          (typeof car.lengthMm !== "number" || car.lengthMm < filters.minLength)
        ) {
          return null
        }

        if (
          typeof filters.maxLength === "number" &&
          (typeof car.lengthMm !== "number" || car.lengthMm > filters.maxLength)
        ) {
          return null
        }

        if (
          typeof filters.minWidth === "number" &&
          (typeof car.widthMm !== "number" || car.widthMm < filters.minWidth)
        ) {
          return null
        }

        if (
          typeof filters.maxWidth === "number" &&
          (typeof car.widthMm !== "number" || car.widthMm > filters.maxWidth)
        ) {
          return null
        }

        if (
          typeof filters.minTrunk === "number" &&
          (typeof car.trunkLiters !== "number" ||
            car.trunkLiters < filters.minTrunk)
        ) {
          return null
        }

        if (
          typeof filters.maxTrunk === "number" &&
          (typeof car.trunkLiters !== "number" ||
            car.trunkLiters > filters.maxTrunk)
        ) {
          return null
        }

        const hasVersionFilters =
          filters.powertrains.length > 0 ||
          filters.transmissions.length > 0 ||
          filters.dgtLabels.length > 0
        const matchingVersions = car.versions.filter((version) =>
          versionMatchesFilters(version, filters)
        )
        if (car.versions.length === 0 && hasVersionFilters) {
          return null
        }
        if (car.versions.length > 0 && matchingVersions.length === 0) {
          return null
        }

        const visiblePowertrains = uniqueOrdered(
          matchingVersions.map((version) => version.powertrain),
          powertrainOrder
        )
        const visibleTransmissions = uniqueOrdered(
          matchingVersions.map((version) => version.transmission),
          transmissionOrder
        )
        const visibleDgtLabels = uniqueOrdered(
          matchingVersions.map((version) => version.dgtLabel),
          dgtLabelOrder
        )

        return {
          ...car,
          matchingVersions: car.versions.length > 0 ? matchingVersions : [],
          visiblePowertrains,
          visibleTransmissions,
          visibleDgtLabels,
        }
      })
      .filter((car): car is CarWithVisibleVersions => car !== null)
  }, [filters])

  const sortedCars = useMemo(() => {
    const directionMultiplier = sortDirection === "asc" ? 1 : -1
    const nextCars = [...filteredCars]

    nextCars.sort((carA, carB) => {
      let comparison = 0

      if (sortField === "brandModel") {
        comparison = `${carA.brand} ${carA.model}`.localeCompare(
          `${carB.brand} ${carB.model}`,
          "es",
          { sensitivity: "base" }
        )
      }

      if (sortField === "salesUnits12m") {
        comparison = carA.salesUnits12m - carB.salesUnits12m
      }

      if (sortField === "lengthMm") {
        comparison = compareOptionalNumber(carA.lengthMm, carB.lengthMm)
      }

      if (sortField === "widthMm") {
        comparison = compareOptionalNumber(carA.widthMm, carB.widthMm)
      }

      if (sortField === "trunkLiters") {
        comparison = compareOptionalNumber(carA.trunkLiters, carB.trunkLiters)
      }

      if (comparison !== 0) {
        return comparison * directionMultiplier
      }

      return carA.salesRank12m - carB.salesRank12m
    })

    return nextCars
  }, [filteredCars, sortDirection, sortField])
  const displayedCars = useMemo(() => {
    if (resultsLimit === "all") {
      return sortedCars
    }

    return sortedCars.slice(0, Number.parseInt(resultsLimit, 10))
  }, [resultsLimit, sortedCars])

  const visibleColumnSet = useMemo(
    () => new Set<TableColumnKey>(visibleColumns),
    [visibleColumns]
  )
  const visibleColumnDefinitions = useMemo(
    () =>
      tableColumnDefinitions.filter((column) =>
        visibleColumnSet.has(column.key)
      ),
    [visibleColumnSet]
  )

  const activeFiltersCount =
    filters.powertrains.length +
    filters.transmissions.length +
    filters.dgtLabels.length +
    filters.bodyTypes.length +
    (filters.query.trim() ? 1 : 0) +
    (typeof filters.minLength === "number" ? 1 : 0) +
    (typeof filters.maxLength === "number" ? 1 : 0) +
    (typeof filters.minWidth === "number" ? 1 : 0) +
    (typeof filters.maxWidth === "number" ? 1 : 0) +
    (typeof filters.minTrunk === "number" ? 1 : 0) +
    (typeof filters.maxTrunk === "number" ? 1 : 0)

  const updateFilters = (updater: (previous: Filters) => Filters) => {
    setState((previous) => ({
      ...previous,
      filters: updater(previous.filters),
    }))
  }

  const resetFilters = () => {
    updateFilters(() => ({
      query: "",
      powertrains: [],
      transmissions: [],
      dgtLabels: [],
      bodyTypes: [],
    }))
  }

  const updateNumericFilter = (
    key:
      | "minLength"
      | "maxLength"
      | "minWidth"
      | "maxWidth"
      | "minTrunk"
      | "maxTrunk",
    value: string
  ) => {
    const parsed = Number.parseInt(value, 10)

    updateFilters((previous) => ({
      ...previous,
      [key]: value === "" || Number.isNaN(parsed) ? undefined : parsed,
    }))
  }

  const toggleVisibleColumn = (
    columnKey: TableColumnKey,
    shouldShow: boolean
  ) => {
    setState((previous) => {
      const nextVisibleColumns = shouldShow
        ? previous.visibleColumns.includes(columnKey)
          ? previous.visibleColumns
          : [...previous.visibleColumns, columnKey]
        : previous.visibleColumns.filter((key) => key !== columnKey)

      const normalizedColumns = allTableColumns.filter((key) =>
        nextVisibleColumns.includes(key)
      )

      if (normalizedColumns.length === 0) {
        return previous
      }

      return {
        ...previous,
        visibleColumns: normalizedColumns,
      }
    })
  }

  const sortByColumn = (field: SortField) => {
    setState((previous) => {
      if (previous.sortField === field) {
        return {
          ...previous,
          sortDirection: previous.sortDirection === "asc" ? "desc" : "asc",
        }
      }

      return {
        ...previous,
        sortField: field,
        sortDirection: defaultSortDirectionByField[field],
      }
    })
  }

  const markImageAsBroken = (id: string) => {
    setBrokenImageIds((previous) => {
      if (previous.has(id)) {
        return previous
      }

      const next = new Set(previous)
      next.add(id)
      return next
    })
  }

  return (
    <TooltipProvider>
      <main className="min-h-svh bg-linear-to-b from-background via-background to-muted/40 px-4 py-8 text-foreground sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="relative overflow-hidden rounded-3xl border border-slate-800 bg-linear-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-slate-100 shadow-xl sm:p-8">
          <div className="pointer-events-none absolute -top-20 -left-16 h-56 w-56 rounded-full bg-cyan-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -right-20 -bottom-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />

          <div className="relative z-10 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AppLogo />
                <div>
                  <p className="text-[10px] font-semibold tracking-[0.28em] text-cyan-200/80 uppercase">
                    Market Radar
                  </p>
                  <h1 className="text-3xl leading-none font-black tracking-tight sm:text-4xl">
                    {appName}
                  </h1>
                </div>
              </div>

              <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
                Comparador de coches en Espana con foco en matriculaciones
                reales. Filtra, ordena y comparte cada vista directamente con la
                URL.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                  <CarFront className="size-3.5" />
                  Mercado espanol
                </span>
                <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200">
                  Ventana: {salesWindowLabel}
                </span>
              </div>
            </div>

            <div className="grid gap-2 text-right text-sm sm:min-w-52">
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs text-slate-300">Modelos monitorizados</p>
                <p className="text-2xl font-bold tracking-tight">
                  {carsSpainTopSalesRolling12m.length}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs text-slate-300">Datos actualizados</p>
                <p className="font-semibold">{dataLastUpdated}</p>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-2xl border bg-card/95 p-4 shadow-sm lg:sticky lg:top-6 lg:h-fit">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
                <Filter className="size-4" />
                Filtros
              </h2>
              <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                {activeFiltersCount} activos
              </span>
            </div>

            <Button
              variant="outline"
              onClick={resetFilters}
              disabled={activeFiltersCount === 0}
              className="mb-4 w-full"
            >
              <Trash2 className="size-4" />
              Clear all filters
            </Button>

            <div className="space-y-5 text-sm">
              <label className="space-y-2">
                <span className="font-medium">Buscar modelo</span>
                <span className="relative block">
                  <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                  <Input
                    value={filters.query}
                    onChange={(event) =>
                      updateFilters((previous) => ({
                        ...previous,
                        query: event.target.value,
                      }))
                    }
                    placeholder="Ej: Corolla, SUV, Peugeot"
                    className="pr-3 pl-8"
                  />
                </span>
              </label>

              {!hasExtendedMetadata && (
                <p className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                  Dataset actual: solo ranking y matriculaciones por modelo.
                </p>
              )}

              {availablePowertrainOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium">Tipo de motor</p>
                  <div className="grid gap-2">
                    {availablePowertrainOptions.map(([value, label]) => (
                      <label
                        key={value}
                        className="inline-flex items-center gap-2"
                      >
                        <Checkbox
                          checked={filters.powertrains.includes(value)}
                          onCheckedChange={(checked) =>
                            updateFilters((previous) => ({
                              ...previous,
                              powertrains: toggleArrayValue(
                                previous.powertrains,
                                value,
                                checked === true
                              ),
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {availableTransmissionOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium">Cambio</p>
                  <div className="grid gap-2">
                    {availableTransmissionOptions.map(([value, label]) => (
                      <label
                        key={value}
                        className="inline-flex items-center gap-2"
                      >
                        <Checkbox
                          checked={filters.transmissions.includes(value)}
                          onCheckedChange={(checked) =>
                            updateFilters((previous) => ({
                              ...previous,
                              transmissions: toggleArrayValue(
                                previous.transmissions,
                                value,
                                checked === true
                              ),
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {availableDgtLabelOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium">Etiqueta ambiental</p>
                  <div className="grid gap-2">
                    {availableDgtLabelOptions.map(([value, label]) => (
                      <label
                        key={value}
                        className="inline-flex items-center gap-2"
                      >
                        <Checkbox
                          checked={filters.dgtLabels.includes(value)}
                          onCheckedChange={(checked) =>
                            updateFilters((previous) => ({
                              ...previous,
                              dgtLabels: toggleArrayValue(
                                previous.dgtLabels,
                                value,
                                checked === true
                              ),
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {availableBodyTypeOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium">Tipo de carroceria</p>
                  <div className="grid gap-2">
                    {availableBodyTypeOptions.map(([value, label]) => (
                      <label
                        key={value}
                        className="inline-flex items-center gap-2"
                      >
                        <Checkbox
                          checked={filters.bodyTypes.includes(value)}
                          onCheckedChange={(checked) =>
                            updateFilters((previous) => ({
                              ...previous,
                              bodyTypes: toggleArrayValue(
                                previous.bodyTypes,
                                value,
                                checked === true
                              ),
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {hasLengthData && (
                <div className="space-y-2">
                  <p className="inline-flex items-center gap-2 font-medium">
                    <Ruler className="size-4" />
                    Longitud (mm)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={filters.minLength ?? ""}
                      onChange={(event) =>
                        updateNumericFilter("minLength", event.target.value)
                      }
                      placeholder="Min"
                    />
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={filters.maxLength ?? ""}
                      onChange={(event) =>
                        updateNumericFilter("maxLength", event.target.value)
                      }
                      placeholder="Max"
                    />
                  </div>
                </div>
              )}

              {hasWidthData && (
                <div className="space-y-2">
                  <p className="inline-flex items-center gap-2 font-medium">
                    <MoveHorizontal className="size-4" />
                    Anchura (mm)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={filters.minWidth ?? ""}
                      onChange={(event) =>
                        updateNumericFilter("minWidth", event.target.value)
                      }
                      placeholder="Min"
                    />
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={filters.maxWidth ?? ""}
                      onChange={(event) =>
                        updateNumericFilter("maxWidth", event.target.value)
                      }
                      placeholder="Max"
                    />
                  </div>
                </div>
              )}

              {hasTrunkData && (
                <div className="space-y-2">
                  <p className="inline-flex items-center gap-2 font-medium">
                    <Trees className="size-4" />
                    Maletero (L)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={filters.minTrunk ?? ""}
                      onChange={(event) =>
                        updateNumericFilter("minTrunk", event.target.value)
                      }
                      placeholder="Min"
                    />
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={filters.maxTrunk ?? ""}
                      onChange={(event) =>
                        updateNumericFilter("maxTrunk", event.target.value)
                      }
                      placeholder="Max"
                    />
                  </div>
                </div>
              )}
            </div>
          </aside>

          <div className="space-y-4">
            <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Mostrando <strong>{displayedCars.length}</strong> de{" "}
                  {sortedCars.length} coches
                </p>
                <p className="text-xs text-muted-foreground">
                  Datos actualizados: {dataLastUpdated}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Orden actual:{" "}
                    <strong>
                      {sortFieldLabels[sortField]} (
                      {sortDirection === "asc" ? "asc" : "desc"})
                    </strong>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    En tabla: haz click en la cabecera de la columna para
                    ordenar.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Mostrar</span>
                  <Select
                    value={resultsLimit}
                    onValueChange={(value) =>
                      setState((previous) => ({
                        ...previous,
                        resultsLimit: parseResultsLimit(value),
                      }))
                    }
                  >
                    <SelectTrigger size="sm" className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {resultsLimitOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Tabs
                    value={viewMode}
                    onValueChange={(value) =>
                      setState((previous) => ({
                        ...previous,
                        viewMode: value as ViewMode,
                      }))
                    }
                  >
                    <TabsList>
                      <TabsTrigger value="cards">
                        <List className="size-4" />
                        Tarjetas
                      </TabsTrigger>
                      <TabsTrigger value="table">
                        <TableIcon className="size-4" />
                        Tabla
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {viewMode === "table" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setIsColumnPanelOpen((previous) => !previous)
                      }
                    >
                      Columnas ({visibleColumns.length})
                    </Button>
                  )}
                </div>
              </div>

              {viewMode === "table" && isColumnPanelOpen && (
                <div className="mt-3 rounded-lg border bg-card p-3 shadow-sm">
                  <p className="text-xs font-medium text-muted-foreground">
                    Columnas visibles
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {tableColumnDefinitions.map((column) => {
                      const isVisible = visibleColumnSet.has(column.key)
                      const isLastVisible =
                        visibleColumns.length === 1 && isVisible

                      return (
                        <label
                          key={column.key}
                          className="inline-flex items-center gap-2 text-xs"
                        >
                          <Checkbox
                            checked={isVisible}
                            disabled={isLastVisible}
                            onCheckedChange={(checked) =>
                              toggleVisibleColumn(column.key, checked === true)
                            }
                          />
                          <span>{column.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {displayedCars.length === 0 ? (
              <div className="rounded-xl border bg-card p-10 text-center shadow-sm">
                <p className="text-base font-medium">
                  No hay resultados para esos filtros.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Prueba a ampliar rangos o quitar etiquetas, cambios y motores.
                </p>
              </div>
            ) : viewMode === "cards" ? (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {displayedCars.map((car) => (
                  <li key={car.id}>
                    <Card className="overflow-hidden py-0 transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="aspect-16/9 bg-muted">
                        {!car.imageUrl || brokenImageIds.has(car.id) ? (
                          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                            <ImageOff className="size-4" />
                            Imagen no disponible
                          </div>
                        ) : (
                          <img
                            src={car.imageUrl}
                            alt={`${car.brand} ${car.model}`}
                            loading="lazy"
                            className="h-full w-full object-cover"
                            onError={() => markImageAsBroken(car.id)}
                          />
                        )}
                      </div>

                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-muted-foreground">
                          {integerFormatter.format(car.salesUnits12m)}{" "}
                          matriculaciones ({salesWindowMonths}m)
                        </p>
                        <h3 className="mt-1 text-lg font-semibold">
                          {car.brand} {car.model}
                        </h3>

                        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                          <Badge variant="secondary">
                            {car.bodyType
                              ? bodyTypeLabels[car.bodyType]
                              : "Tipo N/D"}
                          </Badge>
                          {car.visibleDgtLabels.map((label) => (
                            <Badge
                              key={label}
                              className="bg-emerald-100 font-medium text-emerald-900"
                            >
                              {label}
                            </Badge>
                          ))}
                        </div>

                        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <dt className="text-xs text-muted-foreground">
                              Longitud
                            </dt>
                            <dd className="font-medium">
                              {formatOptionalNumber(car.lengthMm, "mm")}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">
                              Anchura
                            </dt>
                            <dd className="font-medium">
                              {formatOptionalNumber(car.widthMm, "mm")}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">
                              Maletero
                            </dt>
                            <dd className="font-medium">
                              {formatOptionalNumber(car.trunkLiters, "L")}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-4 space-y-2">
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Motores disponibles
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                              {car.visiblePowertrains.length > 0 ? (
                                car.visiblePowertrains.map((powertrain) => (
                                  <Badge key={powertrain} variant="outline">
                                    {powertrainLabels[powertrain]}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-muted-foreground">
                                  {naText}
                                </span>
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground">
                              Cambios disponibles
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                              {car.visibleTransmissions.length > 0 ? (
                                car.visibleTransmissions.map((transmission) => (
                                  <Badge key={transmission} variant="outline">
                                    {transmissionLabels[transmission]}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-muted-foreground">
                                  {naText}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border bg-card shadow-sm">
                <Table className="min-w-[900px]">
                  <TableHeader className="bg-muted/60">
                    <TableRow>
                      {visibleColumnDefinitions.map((column) => (
                        <TableHead
                          key={column.key}
                          className="h-11 bg-muted/60"
                        >
                          {column.sortField ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="-ml-2 h-8 px-2 text-xs font-semibold"
                              onClick={() => sortByColumn(column.sortField!)}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                {column.label}
                                {column.key === "salesUnits12m" ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/80 hover:text-foreground"
                                        role="button"
                                        tabIndex={0}
                                        aria-label="Info sobre Ranking 12m"
                                        onClick={(event) => {
                                          event.preventDefault()
                                          event.stopPropagation()
                                        }}
                                        onKeyDown={(event) => {
                                          if (
                                            event.key === "Enter" ||
                                            event.key === " "
                                          ) {
                                            event.preventDefault()
                                            event.stopPropagation()
                                          }
                                        }}
                                      >
                                        <Info className="size-3.5" />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-64 text-xs leading-relaxed">
                                      Total de matriculaciones acumuladas por modelo en los
                                      ultimos {salesWindowMonths} meses completos
                                      ({salesWindowLabel}).
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </span>
                              {sortField === column.sortField ? (
                                sortDirection === "asc" ? (
                                  <ArrowUp className="size-3.5" />
                                ) : (
                                  <ArrowDown className="size-3.5" />
                                )
                              ) : (
                                <ArrowUpDown className="size-3.5 opacity-60" />
                              )}
                            </Button>
                          ) : (
                            column.label
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_tr:nth-child(even)]:bg-muted/15">
                    {displayedCars.map((car) => (
                      <TableRow key={car.id}>
                        {visibleColumnDefinitions.map((column) => {
                          if (column.key === "photo") {
                            return (
                              <TableCell key={column.key}>
                                <div className="h-16 w-28 overflow-hidden rounded-md border bg-muted">
                                  {!car.imageUrl ||
                                  brokenImageIds.has(car.id) ? (
                                    <div className="flex h-full items-center justify-center text-muted-foreground">
                                      <ImageOff className="size-4" />
                                    </div>
                                  ) : (
                                    <img
                                      src={car.imageUrl}
                                      alt={`${car.brand} ${car.model}`}
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                      onError={() => markImageAsBroken(car.id)}
                                    />
                                  )}
                                </div>
                              </TableCell>
                            )
                          }

                          if (column.key === "model") {
                            return (
                              <TableCell
                                key={column.key}
                                className="max-w-56 font-medium"
                              >
                                {car.brand} {car.model}
                                <p className="text-xs text-muted-foreground">
                                  {car.bodyType
                                    ? bodyTypeLabels[car.bodyType]
                                    : "Tipo N/D"}
                                </p>
                              </TableCell>
                            )
                          }

                          if (column.key === "salesUnits12m") {
                            return (
                              <TableCell key={column.key}>
                                {integerFormatter.format(car.salesUnits12m)}
                              </TableCell>
                            )
                          }

                          if (column.key === "bodyType") {
                            return (
                              <TableCell key={column.key}>
                                {car.bodyType
                                  ? bodyTypeLabels[car.bodyType]
                                  : naText}
                              </TableCell>
                            )
                          }

                          if (column.key === "dgtLabels") {
                            return (
                              <TableCell
                                key={column.key}
                                className="max-w-36 overflow-hidden text-ellipsis whitespace-nowrap"
                                title={car.visibleDgtLabels.join(", ")}
                              >
                                {car.visibleDgtLabels.join(", ") || naText}
                              </TableCell>
                            )
                          }

                          if (column.key === "transmissions") {
                            return (
                              <TableCell
                                key={column.key}
                                className="max-w-44 overflow-hidden text-ellipsis whitespace-nowrap"
                                title={car.visibleTransmissions
                                  .map((item) => transmissionLabels[item])
                                  .join(", ")}
                              >
                                {car.visibleTransmissions
                                  .map((item) => transmissionLabels[item])
                                  .join(", ") || naText}
                              </TableCell>
                            )
                          }

                          if (column.key === "powertrains") {
                            return (
                              <TableCell
                                key={column.key}
                                className="max-w-64 overflow-hidden text-ellipsis whitespace-nowrap"
                                title={car.visiblePowertrains
                                  .map((item) => powertrainLabels[item])
                                  .join(", ")}
                              >
                                {car.visiblePowertrains
                                  .map((item) => powertrainLabels[item])
                                  .join(", ") || naText}
                              </TableCell>
                            )
                          }

                          if (column.key === "lengthMm") {
                            return (
                              <TableCell key={column.key}>
                                {formatOptionalNumber(car.lengthMm, "mm")}
                              </TableCell>
                            )
                          }

                          if (column.key === "widthMm") {
                            return (
                              <TableCell key={column.key}>
                                {formatOptionalNumber(car.widthMm, "mm")}
                              </TableCell>
                            )
                          }

                          return (
                            <TableCell key={column.key}>
                              {formatOptionalNumber(car.trunkLiters, "L")}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <footer className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground shadow-sm">
              <p>
                Fuentes:
                <a
                  className="ml-1 underline"
                  href={dataSources.salesRanking.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {dataSources.salesRanking.title}
                </a>
                ,
                <a
                  className="ml-1 underline"
                  href={dataSources.modelMetadata.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {dataSources.modelMetadata.title}
                </a>
                .
              </p>
              <p className="mt-1">
                Nota: las matriculaciones se agregan sobre los ultimos{" "}
                {salesWindowMonths} meses disponibles ({salesWindowLabel}) para
                categoria M1. Los metadatos tecnicos se completan desde un cache
                local (actualmente para los 20 modelos mas vendidos); el resto
                se muestra como {naText}.
              </p>
            </footer>
          </div>
        </section>
      </div>
      </main>
    </TooltipProvider>
  )
}

export default App
