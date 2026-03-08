# Design Recommendations — Rueda (Car Comparison App)

Recommendations after exploring the app at http://localhost:5173/ (cards + table views, filters, header, footer).

---

## 1. **Page title and meta**

- **Issue:** `index.html` uses generic `<title>vite-app</title>` and `lang="en"` while the app is Spanish.
- **Recommendation:** Set `<title>Rueda — Comparador de coches España</title>` and `<html lang="es">` for SEO and accessibility.

---

## 2. **Header**

- **What works:** Strong hero (gradient, logo, “Market Radar” + “Rueda”), clear value proposition and stats (modelos monitorizados, datos actualizados).
- **Recommendations:**
  - Add a skip link (e.g. “Saltar al contenido”) for keyboard/screen-reader users.
  - Consider a short, visible “Última actualización: …” next to the stats so the date is obvious.
  - If “Market Radar” is a product line and “Rueda” is the app name, make that hierarchy clearer (e.g. size/weight or a short subtitle).

---

## 3. **Filters sidebar** (Done)

- **What works:** Filters are grouped, “X activos” and “Clear all filters” give feedback; range inputs (Longitud, Anchura, Maletero) are clear.
- **Recommendations:**
  - **Collapse/expand:** Allow collapsing filter groups (e.g. “Tipo de motor”, “Etiqueta ambiental”) so power users see more results above the fold and mobile users scroll less. Preserve open/closed state in URL or session if useful.
  - **“Clear all filters”:** Use Spanish: e.g. “Borrar filtros” or “Quitar todos los filtros” for consistency.
  - **Filter count:** When `activeFiltersCount === 0`, the badge “0 activos” can feel noisy; consider hiding the badge when 0 or showing a short “Sin filtros” state.
  - **Search:** Add `aria-describedby` or a short hint (e.g. “Marca o modelo”) so the purpose is clear for assistive tech and first-time users.

---

## 4. **Results bar (above cards/table)**

- **What works:** “Mostrando X de Y coches”, “Orden actual”, selector “Mostrar” (15/30/50/Todos), Tarjetas/Tabla, and “Columnas” in table view are all present.
- **Recommendations:**
  - **Responsiveness:** On small screens, stack controls vertically or use a compact layout (e.g. dropdown “Opciones” that opens sort + limit + view + columns) so the bar doesn’t wrap awkwardly.
  - **Order copy:** “Orden actual: Ranking 12m (asc/desc)” could be shortened to “Orden: Ranking 12m ↑/↓” with an icon or tooltip for “asc/desc” to save space.
  - **Table “Columnas”:** When the column panel is open, give the button a pressed/selected state (e.g. `aria-pressed="true"`, stronger background) so it’s clear the panel is tied to it.

---

## 5. **Cards view**

- **What works:** 16:9 image, sales line, brand+model as heading, body type + DGT badges, dimensions grid, powertrains/transmissions.
- **Recommendations:**
  - **Image loading:** Keep the current placeholder/fallback; consider a subtle skeleton or blur-up for loading state so layout shift is minimal.
  - **Card actions:** Add at least one clear action per card (e.g. “Ver detalle”, “Comparar”, or “Compartir”) so the card feels interactive and shareable; link could encode current filters/sort in the URL.
  - **Badges:** DGT labels already use color (e.g. `emerald`); ensure sufficient contrast (WCAG 2.1) and, if needed, add a small icon or tooltip for “Etiqueta ECO”, “Cero”, etc.
  - **Empty state:** “No hay resultados para esos filtros” is good; add a primary button “Borrar filtros” that runs `resetFilters` for faster recovery.

---

## 6. **Table view**

- **What works:** Sortable headers, visible columns selector, alternating row background, tooltip on “Ranking 12m”.
- **Recommendations:**
  - **Horizontal scroll:** Table has `min-w-[900px]`; wrap it in a labeled scroll container (e.g. “Tabla desplazable horizontalmente”) and ensure focus is visible when scrolling with keyboard.
  - **Header semantics:** Use `<th scope="col">` (and proper `<thead>`) if not already; this improves screen reader announcements.
  - **Row links:** If rows stay non-clickable, add a visible “Expandir” or “Ver en tarjetas” action (e.g. icon) so users can jump to a card or detail without changing view.
  - **Sticky first column:** Consider making “Modelo” (and optionally “Foto”) sticky on horizontal scroll so context is always visible.

---

## 7. **Footer**

- **What works:** Data sources and the note about 12 months and M1 are valuable.
- **Recommendations:**
  - **Links:** Ensure “DGT - Microdatos…” and “Cache local…” have a discernible focus style and, if useful, `rel="noopener noreferrer"` for security (already using `rel="noreferrer"`).
  - **Readability:** Break the long “Nota: las matriculaciones…” into 2–3 short sentences or a small bullet list so it’s easier to scan.

---

## 8. **Visual and UX polish**

- **Theme:** App uses a dark header with cyan/emerald accents and a light main area. Consider:
  - A global “Modo oscuro” toggle that switches `document.documentElement.classList.toggle('dark')` (you already have `.dark` in CSS) and persist preference (e.g. `localStorage`).
- **Spacing and typography:**
  - Slightly increase spacing between card grid items on large screens (e.g. `gap-5` or `gap-6`) for a less dense feel.
  - Use a dedicated font for the “Rueda” hero title (e.g. a bold display font) to differentiate it from body/shadcn defaults.
- **Micro-interactions:**
  - Card hover already uses `-translate-y-0.5` and `hover:shadow-md`; consider a subtle scale (e.g. `hover:scale-[1.02]`) and `transition-transform` for a smoother feel.
  - Table row hover: add a light background or border-left accent on hover for clarity.
- **Loading and errors:**
  - If data ever loads async, add a small loading state (skeleton or spinner) for the results area.
  - If image fetch fails, the current “Imagen no disponible” is good; ensure the icon + text meet contrast requirements.

---

## 9. **Accessibility**

- **Focus:** Confirm focus ring is visible on all interactive elements (search, checkboxes, selects, tabs, buttons, links). If you use `outline: none`, replace with a clear `ring` or `box-shadow` on focus.
- **Labels:** All filter controls appear to have labels; ensure every checkbox/input is associated with its label (e.g. `id` + `htmlFor` or `aria-label`).
- **Live region:** When filters change and the result count updates, consider `aria-live="polite"` on the “Mostrando X de Y” element so screen reader users get the update without re-scanning.
- **Language:** Use `lang="es"` on the document and optionally on any embedded non-Spanish content.

---

## 10. **Quick wins**

| Change | Where | Effort |
|--------|--------|--------|
| Spanish title + `lang="es"` | `index.html` | Low |
| “Clear all filters” → “Borrar filtros” | `App.tsx` | Low |
| “Borrar filtros” button in empty state | `App.tsx` | Low |
| Dark mode toggle + persistence | New component + `index.css` / main.tsx | Medium |
| Collapsible filter groups | Filters section | Medium |
| Sticky first column in table | Table wrapper | Low |
| Focus styles audit | Global CSS / Tailwind | Low |

---

If you tell me which area you want to tackle first (e.g. SEO/meta, filters, cards, table, or dark mode), I can propose concrete code changes or patches next.
