# AIRA · Auditoría de diseño y brief premium

> **Qué es esto.** Una auditoría de diseño completa del frontend de AIRA (codename
> Vox/Connectview) + el brief para elevarlo a producto SaaS **premium** (nivel
> Linear / Vercel / Stripe). Pensado para alimentar a "Claude design" (o cualquier
> herramienta/agente de diseño) junto con el código fuente.
>
> **Fecha:** 2026-06-07 · **Alcance:** 21 páginas, ~150 componentes, `src/index.css` (4.120 líneas).
> **Método:** lectura del 100% del código de UI por dominio + verificación en navegador
> de las pantallas auth-free + cuantificación por búsqueda (grep) de los problemas sistémicos.

---

## Estado de implementación — Fase 0 ✅ HECHA (2026-06-07)

Los **cimientos del sistema ya están en el código** (verificados: `tsc` limpio + tokens vivos en
el navegador, sin regresión). Claude design debe **usar** estos, no recrearlos:

- **Tokens nuevos** en `src/index.css` (bloque "DESIGN SYSTEM v2"): `--ring`, `--scrim`,
  `--shadow-modal`, escala tipográfica `--text-*`, espaciado `--space-*`, `--z-*`, paleta de datos
  `--data-1..8`, canal `--ch-*`, severidad `--sev-*`, marca-terceros `--brand-*`.
- **Foco de teclado global** (`:where(...):focus-visible { outline: 2px solid var(--ring) }`) +
  **`prefers-reduced-motion` global**.
- **Primitivos nuevos** en `src/components/ui/` (y `vox/`):
  `IconButton`, `EmptyState`/`ErrorState`, `Modal`, `ConfirmDialog` + `useConfirm()`, `FormField`,
  `BrandLockup`.

---

## Estado de implementación — Fase 1 ✅ HECHA (2026-06-09)

Cerrado el "cisma" y la a11y base (verificado: `tsc` 0 + `vite build` 0 en cada paso). Commits `6f2f9a8`→`313a97a`:

- **P1 (cisma de color) — CERRADO:** 0 colores Tailwind crudos numerados en TODO `src/`. Mapeado a `--accent-*`/`-soft` (marca) y neutros `--bg/--text/--border`, colapsando las variantes `dark:` redundantes. Verificado que Tailwind v4 genera las clases `prop-[var(--token)]`.
- **P3:** 16 `confirm()`/`alert()` nativos → `useConfirm()`/`ConfirmDialog`.
- **P11:** marca visible unificada a **AIRA** (`<title>`, login, ~50 textos `ARIA`/`Vox`). Codename `Vox` intacto en identificadores/CSS/comentarios.
- **P2 (a11y):** nav `<div onClick>` → `<button>` (teclado) + foco visible global (Fase 0) + `aria-current`/`role="alert"`.
- **P8:** ~87 emoji-icono → `lucide-react`/primitivos `Icon.*`. Emoji de copy/data (EmojiPicker, mensajes, plantillas, tonos) intacto.
- **Limpieza:** 11 archivos de código muerto borrados.

Pendientes de **Fase 2** (consolidar duplicados + diseñar lo que falta): `DataTable`, `KpiTile`,
`ChannelBadge`, `StatusDot`/`SeverityBadge`, `Chart` (ECharts), `Avatar`, `CallDuration`; **integrar**
los primitivos ya creados (EmptyState/Modal/FormField/IconButton/BrandLockup) en las pantallas;
`aria-live` exhaustivos en pantallas en vivo; y pulir pantalla por pantalla (doc 03).

---

## Cómo usar estos documentos con "Claude design"

El objetivo de la Fase 2 es **generar diseños** (pulir lo existente + diseñar lo que falta)
manteniendo **una sola familia visual**. Para que el resultado sea coherente, el orden de
lectura importa:

1. **Pega primero [`02-sistema-de-diseno-premium.md`](02-sistema-de-diseno-premium.md).**
   Es la fuente de verdad: north-star, principios, tokens, paletas, tipografía, los
   ~25 primitivos canónicos y las **reglas/anti-patrones**. Todo diseño nuevo debe respetarlo.
2. Luego el contexto de **qué** rediseñar: [`01-resumen-y-diagnostico.md`](01-resumen-y-diagnostico.md)
   (veredicto, scorecard, los 12 problemas transversales, priorización por fases, código muerto).
3. Para cada pantalla concreta, abre [`03-auditoria-y-backlog-por-dominio.md`](03-auditoria-y-backlog-por-dominio.md)
   y toma su sección: hallazgos a corregir + lo que falta por diseñar + estados faltantes.

**Prompt sugerido para Claude design** (por pantalla):

> "Rediseña `<pantalla>` de AIRA a nivel premium. Respeta `02-sistema-de-diseno-premium.md`
> al pie de la letra (tokens, primitivos, reglas). Corrige los hallazgos de su sección en
> `03-...` y diseña los estados faltantes (empty/loading/error). Dark-first deep-black,
> acento ámbar, una sola familia visual. No uses colores Tailwind crudos, ni emoji como
> iconos, ni `confirm()` nativo. Entrega todos los estados."

---

## Índice

| # | Documento | Contenido |
|---|-----------|-----------|
| 01 | [Resumen y diagnóstico](01-resumen-y-diagnostico.md) | Veredicto, scorecard por dominio, **12 problemas sistémicos** (cuantificados), priorización en 4 fases, inventario de pantallas, **código muerto a borrar**. |
| 02 | [Sistema de diseño premium](02-sistema-de-diseno-premium.md) | **El brief.** North-star, 7 principios, tokens (actuales + nuevos), paletas (UI/datos/canal/severidad), escala tipográfica, **~25 primitivos canónicos**, reglas/anti-patrones, dark/light, motion, accesibilidad. |
| 03 | [Auditoría y backlog por dominio](03-auditoria-y-backlog-por-dominio.md) | Los 7 dominios: hallazgos por severidad + **lo que falta por diseñar** + estados faltantes, pantalla por pantalla. |

---

## TL;DR (si solo lees una cosa)

AIRA tiene **mejores cimientos y más capacidad que sus competidores** (tokens bien pensados,
dark deep-black, fuente Geist, telefonía nativa, timeline omnicanal, flow builder, varias
pantallas ya premium como el Flow Builder, el Loading y el wizard de Connect). Lo que hoy lo
frena para "premium" **no es falta de talento sino falta de unificación y de los últimos detalles**:

1. **Cisma de implementación** — conviven una capa tokenizada (CSS custom + shadcn puenteado)
   y **307 usos de colores Tailwind crudos** (`bg-emerald-100`, `from-sky-400`) que son de
   tema claro y se ven lavados sobre el fondo negro. Mismo concepto pintado con 2-3 paletas.
2. **Accesibilidad** — **cero foco de teclado visible** en la capa custom (la que domina la
   UI), navegación con `<div onClick>`, sin `aria-live` en pantallas que cambian solas,
   targets < 40px, severidad solo por color.
3. **Detalles que delatan** — `confirm()`/`alert()` nativos (16 usos), emoji como iconos,
   `font-size` mágicos (12.5px) inline, marca inconsistente (**ARIA/Vox** en vez de AIRA),
   doble librería de charts, mezcla de idioma.
4. **Faltan primitivos y estados** — no hay `<EmptyState>`/`<ErrorState>`/`<Modal>`/`<DataTable>`/
   `<FormField>` canónicos; ~5 variantes del mismo KPI; "Cargando…" en texto en vez de skeletons.

**Está a un puñado de arreglos estructurales de verse claramente premium. El motor ya es bueno; falta la carrocería.**
