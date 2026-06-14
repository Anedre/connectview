# 01 · Resumen ejecutivo y diagnóstico

## Veredicto

ARIA es un producto **funcionalmente potente, con cimientos de diseño sólidos**, frenado
para "premium" por **inconsistencia de implementación y deuda de accesibilidad** — no por
falta de calidad en las pantallas individuales. Varias ya están a nivel showcase (Flow
Builder, LoadingScreen, wizard de Connect, calendario de Citas, AgentBuilder). El problema
es que **no se sienten una sola familia**.

**Calificación global de diseño: ~5.8 / 10** ("bueno con potencial premium claro").

### Scorecard por dominio

| Dominio | Nota | Fortaleza | Freno principal |
|---|---|---|---|
| Shell / navegación / auth | 6.0 | Login/Loading premium; tokens sólidos | A11y de teclado rota; no responsive; shell muerto duplicado |
| Dashboard / charts | 6.0 | InsightsPanel rico; StatCards con sparkline | Doble librería de charts; paleta de datos ajena a la marca; 3 cards huérfanas |
| Agent Desktop / Workspace | 6.5 | Muy completo; buena jerarquía del softphone | A11y; no responsive < 1080px; 3 relojes; email de 2ª clase |
| Pipeline / Leads / Campañas | 5.5 | Motor superior a Kommo (telefonía, timeline) | Cisma visual fuerte; tarjeta de lead pobre; `confirm()` nativo |
| Supervisión / Monitoreo | 5.5 | MonitoringPage bien tokenizada | `queue/*` en Tailwind crudo; sin `aria-live`; severidad solo-color |
| Grabaciones / Reportes | 5.0 | Vistas de canal con buena metáfora | Dos design systems sin puente; AudioPlayer inaccesible; 3 motores de chart |
| Admin / IA / Flow / Citas | 5.5 | Flow Builder (7/10) y Citas fuertes | Forms sin validación inline; 4 secciones "Próximamente"; `confirm()` |

> **Lectura clave:** las notas son parejas (5–6.5). Eso confirma que el problema es
> **sistémico** (atraviesa todos los dominios), no localizado. Por eso la mayor palanca
> es arreglar el **sistema** (doc 02), no pantalla por pantalla.

---

## Los 12 problemas sistémicos (cuantificados)

Ordenados por impacto en la percepción "premium" + esfuerzo de corrección.

### 🔴 P1 — Cisma de implementación visual
Tres formas de pintar lo mismo conviven:
- **Capa A — CSS custom tokenizado** (`.mon-*`, `.lead-*`, `.gcal-*`, `vox-*`): usa `var(--*)`. ✅
- **Capa B — shadcn puenteado** (`ui/*` con `bg-card`, `bg-primary`): mapeado a tokens vía
  `@theme inline` (`index.css:12-33`). ✅ *coherente con la marca* (matiz importante: estos
  **no** son el problema).
- **Capa C — Tailwind crudo con número** (`bg-emerald-100`, `from-sky-400`, `ring-rose-400`):
  **307 ocurrencias en 31 archivos**, NO puenteadas. Son colores de **tema claro** que se ven
  lavados sobre `--bg-0 #0A0A0B`. **Este es el cisma real.**

Concentración de la Capa C: `pipeline/*` (FlowView 37, BoardView 30, AgentRail 19, Stage 17,
ContactBubble 13, TimelineStrip 27, CampaignProgressPanel 12, PinnedCampaignCard 12),
`queue/*` (ActiveCampaignsPanel 16, AgentCard 12), y las 3 cards huérfanas del dashboard
(Gamification 12, Wellness 12, Churn 8). El usuario que arrastra un lead (ámbar/cyan) y abre
"Cola en vivo" (gradientes `sky→blue`, rings esmeralda) **cree estar en dos productos**.

**Fix:** mapear toda la Capa C a `--accent-*` / `--data-*` / `--ch-*` (ver doc 02). Prohibir
colores Tailwind con número por lint.

### 🔴 P2 — Accesibilidad de teclado ausente en la capa que domina la UI
- **Foco visible:** la única regla `:focus-visible` en 4.120 líneas de `index.css` es
  `.amplify-input:focus-visible { outline: none }` (`index.css:2673`). Los primitivos shadcn
  (`Button`) **sí** traen `focus-visible` propio, pero la UI de dominio está construida
  mayormente con clases custom (`.btn`, `.sb__item`, `.tb__iconbtn`, `.vox-sp__*`, `.mon-*`) y
  con `<div onClick>` — **ninguno tiene foco visible**. Resultado neto: navegar con teclado es
  invisible. **WCAG 2.4.7 (AA) roto.**
- **Operabilidad:** la nav principal son `<div onClick>` sin `role`/`tabIndex`/teclado
  (`VoxSidebar.tsx:171`, menús de `VoxTopbar.tsx:154,232`). **WCAG 2.1.1 roto.**
- **Sin `aria-live`** en pantallas que cambian solas (monitoreo, llamada entrante, transcript
  en vivo): un lector de pantalla no anuncia "Llamada entrante", "3 en breach SLA", etc.

**Fix:** regla global `:focus-visible` tokenizada + convertir controles a `<button>`/roles +
capa de anuncios `aria-live`. Bajo esfuerzo, altísimo impacto, se nota en demo.

### 🔴 P3 — `confirm()` / `alert()` nativos en flujos destructivos
**16 usos en 13 archivos** (eliminar lead/contacto/bot/agente/cita, rotar token, forzar
desconexión, relaunch). El diálogo del SO rompe por completo la estética dark. **Fix:**
`<ConfirmDialog>` del design system (base-ui/Radix ya está disponible).

### 🟡 P4 — Faltan primitivos canónicos → todo se reinventa
No existen como componentes únicos: `<EmptyState>`, `<ErrorState>`, `<Modal>` (con focus-trap),
`<DataTable>`, `<FormField>`, `<ConfirmDialog>`, `<ChannelBadge>`, `<StatusDot/SeverityBadge>`,
`<KpiTile>`, `<CallDuration>`. Consecuencia: **~5 variantes del mismo KPI tile**, **3-4 tarjetas
de agente**, **3 implementaciones de tabla**, **6 definiciones duplicadas de `inputStyle`**,
overlays de modal con 3 recetas distintas. Ver catálogo en doc 02.

### 🟡 P5 — Estados incompletos (empty/loading/error)
- El `<Skeleton>` primitivo **existe** (`ui/skeleton.tsx`) pero está infrautilizado: la mayoría
  de pantallas muestra **"Cargando…" en texto plano**.
- **Errores casi siempre por `toast`**, no inline ni recuperables: un fallo de red deja la
  pantalla en blanco o con datos viejos sin avisar (patrón confirmado en los 7 dominios).
- Faltan estados clave de dominio: **"stale/desactualizado"** en pantallas live, **buffering/
  error** en el AudioPlayer, **validación inline** en formularios.

### 🟡 P6 — Doble/triple motor de visualización de datos
`recharts` (solo en `InsightsPanel`) + `ECharts` (`EChart.tsx` → CustomCharts, ChartsLab) +
**SVG a mano** (ReportsPage). El mismo `InsightsPanel` mezcla recharts arriba y ECharts en
"Ver más". Dos modelos de tooltip/leyenda/animación, doble bundle. **Fix:** unificar en
**ECharts** con un tema derivado de los tokens.

### 🟡 P7 — Paleta de datos desacoplada de la marca
La paleta de charts está **hardcodeada por triplicado** (`EChart.tsx:31`, `InsightsPanel.tsx:52`,
`ChartsLabPage`) con teal/emerald/lime/orange que **no coinciden con ningún acento del sistema**.
El acento primario (ámbar) ni siquiera lidera. Además hay **dos taxonomías de color de canal
contradictorias** (voz=cyan vs voz=sky en distintos componentes). **Fix:** tokens `--data-*` y
`--ch-*` como fuente única.

### 🟡 P8 — Iconografía mixta (emoji + lucide)
Emojis usados como iconos semánticos en superficies de primer nivel (chips de canal 💬📧📞,
adjuntar 📎, dial modes 📞⚡👤🤖, estados ✅⚠️🔒) conviviendo con `lucide-react`. Renderizan
distinto por SO y no heredan color de token. **Fix:** prohibir emoji-como-icono; todo a lucide.

### 🟡 P9 — Sin escala tipográfica ni de espaciado/z-index
`font-size` "mágicos" en px decimales (`12.5`, `11.5`, `10.5`, `9.5`, `13.5`) repetidos
**cientos de veces** inline + `text-[10px]` arbitrarios. Igual con z-index (`20`, `50`, `60`,
`200` sin escala) y espaciados ad-hoc. Imposible mantener ritmo vertical premium. **Fix:**
tokens `--text-*`, `--space-*`, `--z-*`.

### 🟡 P10 — No responsive en superficies clave
`.app` (shell) y `.call` (desktop, `min-width:1080px`) tienen **0 media queries**; las tablas
densas no colapsan; FlowBuilder y AdminPage tienen paneles de ancho fijo. La app autenticada se
rompe < 768px y el desktop fuerza scroll horizontal en laptops 1366px. **Fix:** breakpoints +
sidebar/right-rail colapsables a drawer.

### 🟢 P11 — Marca inconsistente de cara al usuario
El producto se llama **ARIA**, pero la UI a veces muestra la grafía vieja **"AIRA"** (~20 ocurrencias visibles:
`index.html:10`, `App.tsx:204,308,355`, `NotFoundPage.tsx:46`, wizard, admin, leads…) y
**"Vox"** ("Agentes IA de Vox" `AgentePage.tsx:307`, "…mientras usas Vox" `App.tsx:394`).
La grafía equivocada "AIRA" rompía la consistencia visible. **Fix:** un `<BrandLockup>` único,
todo a "ARIA". *(El codename "Vox" en identificadores de código/CSS se mantiene — solo se
corrige el texto visible.)*

### 🟢 P12 — Motion incompleta y sin `prefers-reduced-motion`
La media query `prefers-reduced-motion` cubre **solo 3 animaciones**; pulsos/pings/spinners de
tiempo real (live-dot, accept-ring, audio equalizer, monitor-pulse) siguen animando. Motion
incoherente entre tarjetas vecinas (unas animan la entrada, otras no). Keyframes `spin`/`pulse`
duplicados inline por componente. **Fix:** consolidar keyframes en `index.css` + cobertura
global de reduced-motion.

---

## Priorización en 4 fases

Pensada para que cada fase **suba visiblemente la percepción de calidad** con esfuerzo creciente.

### Fase 0 — Cimientos del sistema (habilita todo lo demás)
> *Sin esto, cada pantalla rediseñada vuelve a divergir.*
- Definir los **tokens nuevos** (foco, escala tipográfica, espaciado, z-index, `--data-*`,
  `--ch-*`, `--sev-*`, `--scrim`, marca-terceros) — doc 02 §Tokens.
- Regla global `:focus-visible` + barrido de `outline:none`.
- Construir los **primitivos base**: `<Button/IconButton>`, `<FormField>`, `<Modal>`,
  `<ConfirmDialog>`, `<EmptyState>`, `<ErrorState>`, `<Skeleton>` (uso real), `<DataTable>`.
- Unificar marca → `<BrandLockup>` (ARIA).

### Fase 1 — Cerrar el cisma + a11y (mayor palanca de "premium")
- Migrar las **307 ocurrencias de Tailwind crudo** a tokens (empezar por `pipeline/*` y `queue/*`).
- Reemplazar **16 `confirm()`** por `<ConfirmDialog>`.
- Reemplazar emoji-icono por lucide.
- Convertir nav `<div onClick>` → `<button>`/roles + teclado; `aria-live` en pantallas live.
- Borrar el **código muerto** (ver abajo) para que nadie reintroduzca patrones viejos.

### Fase 2 — Consolidar componentes duplicados
- `<KpiTile>` único (mata 5 variantes), `<ChannelBadge>`+`CHANNEL_TOKENS`,
  `<StatusDot/SeverityBadge>` (forma+color+texto), `<Avatar>` determinístico,
  `<CallDuration>`, `<SegmentedControl>`, `<FilterChipBar>`.
- Unificar charts en **ECharts** + tema de tokens. Migrar `InsightsPanel`/Reports.
- Estados completos (skeleton/empty/error/stale) en todas las pantallas.

### Fase 3 — Diseñar lo que falta + pulido premium
- El **backlog de doc 03** (waveform + transcript clickable, hilo omnicanal unificado, tarjeta
  de lead nivel Pipedrive, drag&drop accesible, secciones admin "Próximamente", composer de
  email, centro de notificaciones, responsive completo, command palette del agente).
- Microinteracciones con propósito (transición de estado de llamada, stagger de entrada),
  respetando reduced-motion.

---

## Inventario de pantallas (21 páginas)

| Ruta | Página | Rol | Estado de pulido | Auth |
|---|---|---|---|---|
| `/` | DashboardPage | Inicio (agente/supervisor/admin) | 🟡 rico pero charts/skeletons | sí |
| `/agent` | AgentDesktopPage | Escritorio del agente (núcleo) | 🟡 completo, a11y/responsive | sí |
| `/queue` | MonitoringPage | Supervisión en vivo | 🟡 tokenizada, falta a11y/stale | sí |
| `/campaigns` | CampaignsPage | Lista de campañas outbound | 🟡 ok, faltan skeletons | sí |
| `/campaigns/nueva` | CampaignCreatePage | Wizard de campaña | 🟡 sin stepper/validación | sí |
| `/campaigns/:id` | CampaignDetailPage | Detalle de campaña | 🟢 de los más completos | sí |
| `/leads` | LeadsPage | Embudo CRM (kanban) | 🟡 cisma visual, tarjeta pobre | sí |
| `/recordings` | RecordingsPage | Grabaciones/omnicanal | 🟠 dos DS, player inaccesible | sí |
| `/reports` | ReportsPage | Reportes/analítica | 🟠 3 motores de chart, filtros falsos | sí |
| `/admin` | AdminPage | Configuración (8 secciones) | 🟠 4/8 "Próximamente" | sí |
| `/appointments` | AppointmentsPage | Citas (calendario) | 🟢 fuerte; falta empty/skeleton | sí |
| `/bot` | FlowBuilderPage | Constructor de bots | 🟢 el más premium | sí |
| `/agente` | AgentePage | Hub de Agentes IA | 🟢 hero rico; tools sin terminar | sí |
| `/charts-lab` | ChartsLabPage | Laboratorio de charts (22) | ⚪ interno/datos falsos | sí |
| `/coach-demo` | CoachDemoPage | Demo coach IA | ⚪ demo | sí |
| `/wrapup-demo` | WrapUpDemoPage | Demo wrap-up | ⚪ demo | sí |
| `/monitor-demo` | MonitorDemoPage | Demo barra de monitor | ⚪ demo | sí |
| `/bot-demo` | FlowBuilderDemoPage | Preview Flow Builder | 🟢 **verificado en navegador** | **no** |
| `/agente-demo` | AgentePage | Preview Agentes IA | 🟢 **verificado en navegador** | **no** |
| `/wizard-demo` | WizardDemoPage | Preview wizard Connect | 🟢 **verificado en navegador** | **no** (dev) |
| `*` | NotFoundPage | 404 | 🟡 ok, no respeta dark | — |

Leyenda: 🟢 cerca de premium · 🟡 funcional con deuda · 🟠 necesita rediseño · ⚪ interno/demo.

> **Verificado en navegador** (dev server, pantallas auth-free): el **Flow Builder** se ve
> claramente premium (nodos coloreados por tipo, minimapa, paleta de pasos, estados
> Borrador/Sin avisos). El **hub de Agentes IA** y el **wizard de Connect** están limpios y
> bien resueltos. El resto requiere login (Cognito + Connect) y se auditó por código.

---

## Código muerto a borrar (limpieza de Fase 1)

Eliminar evita que se reintroduzcan patrones viejos y limpia el inventario del design system:

| Archivo | Por qué está muerto |
|---|---|
| `components/layout/AppSidebar.tsx` | Shell alternativo shadcn nunca importado; nav divergente del real |
| `components/layout/Header.tsx` | Header alternativo nunca importado (paleta indigo/purple ajena) |
| `components/layout/RoleGate.tsx` | Exportado sin consumidores (los gates se hacen inline) |
| `components/layout/ThemeToggle.tsx` | Solo lo usa el `Header` muerto |
| `lib/constants.ts → NAV_ITEMS` | Solo lo usa `AppSidebar` muerto (nav divergente) |
| `components/monitoring/KPICard.tsx` | Sin imports; copy en inglés |
| `components/monitoring/QueueTable.tsx` | Sin imports; copy en inglés |
| `components/monitoring/AgentTable.tsx` | Sin imports; copy en inglés |
| `components/monitoring/RefreshIndicator.tsx` | Sin imports |
| `components/dashboard/GamificationCard.tsx` | Huérfano (¡pero premium! → **montar o borrar**, ver doc 03) |
| `components/dashboard/ChurnRiskCard.tsx` | Huérfano (premium → montar o borrar) |
| `components/dashboard/WellnessCard.tsx` | Huérfano (premium → montar o borrar) |
| `components/recordings/CustomerContactsList.tsx` | Huérfano |
| `components/recordings/CustomerListSidebar.tsx` | Huérfano |
| `components/pipeline/Pipeline.tsx` | Probable legacy (las cards usan Board/FlowView directo) — verificar |

> ⚠️ Las 3 cards del dashboard (Gamification/Churn/Wellness) son de **alto acabado** y fueron
> diseñadas para la vista de agente. Decisión de diseño: **activarlas** (portándolas a tokens
> + español) o borrarlas. No dejarlas en limbo.
