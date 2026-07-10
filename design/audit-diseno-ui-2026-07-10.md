# Auditoría de diseño UI — ARIA (2026-07-10)

**Método:** 4 agentes en paralelo (Configuración/Admin · Agente-Conversaciones · Grabaciones · Páginas) + recorrido visual en Chrome de 8 secciones. Objetivo: qué le falta diseño a cada sección/modal/hover/item.

---

## Veredicto en una línea

ARIA tiene un **sistema fuerte** (tokens `aria-base.css`, librería `@/components/aria`, y un **kit de controles moderno completo** en `ui/*`) — pero la **adopción es casi cero en formularios, modales y paneles**. La _cáscara_ (páginas, dashboards, list-cards, shells) es premium; el _relleno_ (config, modales, cuerpos de canal, filtros) es **nativo/inline/hand-rolled**. El gap de diseño es **sub-adopción sistémica**, no piezas faltantes.

**Dato duro:** el kit `ui/{modal,select,switch,segmented,radio-cards,duration-field,token-input,input,textarea,skeleton,empty-state}` existe y:

- **17/17** managers de `admin/*` → **0** lo importan.
- Agente/Conversaciones → **0** archivos lo importan (solo `TasksLauncher` usa `skeleton`/`empty-state`).
- Grabaciones → primitivos de estado sin usar salvo el heatmap.

---

## Los patrones sistémicos (cruzan TODA la app)

1. **Controles nativos crudos** — `<select>/<input>/<textarea>/checkbox/radio` del navegador con estilos inline, en vez del kit. ~30+ solo en workspace/inbox; 17/17 en admin; filtros de Reportes; cuerpos de Grabaciones.
2. **~14+ overlays hechos a mano** — `position:fixed` con scrim/sombra/radio hardcodeados, **sin** `ui/modal.tsx` → sin focus-trap, sin restore-focus, sin animación de entrada, ignorando los tokens `--scrim`/`--shadow-modal`/`--z-modal` que YA existen.
3. **Sin foco visible** — `outline:none` inline sin `:focus-visible` de reemplazo (a11y): campos invisibles al teclado en decenas de sitios (incl. `aria-cockpit/styles.ts INP_STYLE` → 5 archivos).
4. **Loading/empty/error como texto plano** — `"Cargando…"`/`"No hay…"` en `div.muted`, ignorando `Skeleton`/`EmptyState`/`ErrorState` que existen.
5. **Colores/sombras hardcodeados que rompen el tema** — moradios del Copilot (`#6E54E0`/`#9B6DFF`), `colorScheme:"dark"` en pickers (picker oscuro en tema claro), sombras `rgba(0,0,0,.5)` feas en claro, tokens rotos (`var(--accent-blue-soft,#e6f0ff)`).
6. **KPI/Stat cards lavados** — labels gris muy claro sobre fondo casi blanco = bajo contraste; visible en Automatizaciones, Journeys, Reportes, Configuración, Agente IA.
7. **El chip de estado "Live" del HeroBand es código muerto** — cada página arma un pulso ("Live · hora", "En vivo · N conectados", "N leads en el embudo") que **nunca se renderiza**: `HeroBand` retorna `null` y solo iza `right` al topbar (`charts.tsx:157`). Dead-prop en ~9 páginas + CSS huérfano (`.hero__chip`). → renderizarlo en el topbar o borrar props+CSS.
8. **Paletas de charts hardcodeadas en hex** (no theme-aware) → rompen dark mode y divergen: **3 "verdes" distintos** para el mismo semántico (`exec.css:29` #138354 / `ExecCharts.tsx:15` #1F8A5B / `SentimentChart.tsx:16` #25B873). → derivar de `useChartTokens()`.
9. **Dos sistemas de primitivos** coexisten — `vox/primitives` (legacy, 21 archivos) vs `@/components/aria` (14); páginas mezclan `.chip` con `<Pill>`. → converger a `aria`.
10. **La tarjeta KPI reinventada 4×** con tamaños/radios distintos (`Stat` fs29 vs `ExecStat` vs `Kpi` locales fs24/26, r10/12/13). → un único primitivo KPI (explica también el look "lavado" del #6).

---

## Por zona (veredicto + top gaps)

### Configuración / Admin — **Necesita sistema**

17/17 managers con controles nativos; ~10 copias divergentes de `inputStyle`; 6 modales a mano; `confirm()` nativo (×3); Skeleton/EmptyState sin usar.
**Top 5:** `SegmentsManager` (100% nativo) · `KnowledgeEditor` · `WhatsAppTemplatesManager` (mayor volumen, 2348 líneas) · `SuppressionManager` · `ConnectUserRoleModal`.
Mejor referencia: `IntegrationsManager` (usa `useConfirm` + modal accesible).

### Agente / Conversaciones — **Dos velocidades**

Shells sólidos (`MonitoringPage`, `AgentDesktopPage`, `InboxPage`, `TasksLauncher`). Modales/paneles nativos.
**Top 5:** `ScheduleCallbackModal` (2 selects nativos + bug tema + canal=RadioCards + overlay sin focus-trap; máximo tráfico) · `WrapUpView` (fin de CADA contacto: 2 radios+3 checks+2 textareas nativos) · `AICoachPanel` (en cada llamada: select/input/textarea/checkbox nativos + callouts rgba) · `ConversationThread` (corazón del inbox: modal "Lista" a mano) · `CopilotPanel` (global: morados hardcodeados, tabs a mano).
Mejor referencia: `TasksLauncher` (adopta Skeleton/EmptyState/ErrorState).

### Grabaciones — **Aceptable** (cáscara premium, cuerpos sin sistematizar)

Shell (workspace, lightbox, ⌘K) premium. Cuerpos de canal ~90% inline con **3 burbujas divergentes** (WhatsApp/Chat/Email) y estados improvisados.
**Fix:** extraer un `<ChatBubble>` único + enchufar `Skeleton`/`EmptyState`.

### Reportes — **Necesita diseño en filtros**

Barra de filtros con **date inputs y `<select>` nativos**; KPI cards lavados. Charts limpios.

### Dashboard (Inicio) — **Sólido** (deuda de paleta)

La zona más premium (motion escalonado, count-up, sparklines, skeleton real, ejes ECharts theme-aware). Frenos: paletas de series congeladas al tema claro (`InsightsPanel.tsx:68`, `ExecEcharts.tsx:30`) + 3 verdes divergentes (patrón 8). `CustomWidgets.tsx:174` reinventa una 4ª KPI card.

### Leads — **Necesita diseño (el peor infractor del scope)**

**146 bloques `style={{` + 34 hex crudos** (vs ~0 en el resto). `STAGE_PALETTE` hex hardcodeada (`LeadsPage.tsx:81`); tarjeta/columna/tabla 100% inline; **modal de detalle a mano** (`rgba(0,0,0,.5)+blur`, sin focus-trap ni animación) `LeadsPage.tsx:1457`; sombras crudas; barra de acción masiva con `#0B0F1A`. → clases `.lead-*` tokenizadas + portar el modal a `<Modal>`.

### Campañas (lista) — **Sólido**

Usa bien Btn/Card/Stat/Pill. Gaps: loading texto plano (`:272`), error como caja cruda (`:278`) → `ErrorState`, botón "…" stub no-op (`:402`).

### Campaign Create — **Aceptable**

101 inline; el "wizard" son 2 step-cards **SIN stepper/progreso real** (`CampaignCreatePage.tsx:47`) → header de progreso de pasos; empties ad-hoc.

### Reports — **Aceptable (shell) / Necesita diseño (sub-reportes)**

El shell usa primitivos; los sub-reportes no: **7 loaders de texto plano**, empties ad-hoc, **tablas hechas a mano sin hover/sticky/zebra** (`AgentPerformanceReport`, `HsmOutboundReport`, `WhatsAppAnalyticsPanel`), KPI reinventado. Además de los filtros con date/select nativos.

### Programs — **Sólido (mejor adopción del sistema)**

Usa Card/Stat/Pill/Skeleton/EmptyState/ErrorState. Único gap: los 2 modales son overlays a mano sin blur/animación/focus-trap (`ProgramsHubPage.tsx:703`) → `<Modal>`.

### Appointments (Citas) — **Aceptable**

Calendario propio `.gcal-*`; popovers SÍ animan de entrada. Gaps: sombra rgba cruda (no `--sh-4`), sin estado vacío "sin citas", loading sin skeleton, micro-tipografía densa ad-hoc.

---

## Bugs de tema encontrados (bonus del audit)

- `ScheduleCallbackModal.tsx:554` y `ContactDetailModal.tsx:840` — `colorScheme:"dark"` hardcodeado → picker/audio oscuro en tema claro.
- `CopilotPanel.tsx:206,261,378,418` + `CopilotMessage.tsx:162` — morados `#9B6DFF`/`#6E54E0` hardcodeados: rompen tema y contradicen la identidad "IA" iris/cyan → usar `var(--iris)`.
- `EmailThreadsView.tsx:396` — token inexistente `var(--accent-blue-soft,#e6f0ff)` → siempre pinta el hex.
- `SoftphoneBanner.tsx:87` — copy en **voseo** (contra la regla de español neutro).

---

## Plan de remediación (por apalancamiento, no por archivo)

Las palancas sistémicas rinden mucho más que ir archivo por archivo:

1. **Adopción del kit en cascada** — reemplazar los controles nativos por `Select`/`Switch`/`SegmentedControl`/`RadioCards`/`DurationField`/`TokenInput` + `Input`/`Textarea`/`Field`. Erradica ~30+ controles, el foco invisible y el estilo divergente de una.
2. **Migrar overlays a `ui/modal.tsx`** — focus-trap + restore-focus + animación de entrada + `var(--scrim)`/`--shadow-modal` gratis en ~14 modales.
3. **Estados con primitivos** — `Skeleton`/`EmptyState`/`ErrorState` en todos los loading/empty/error.
4. **Erradicar hardcodes** — tokens en vez de hex/rgba; arreglar los `colorScheme:"dark"`; Copilot a `var(--iris)`.
5. **KPI cards** — subir contraste de labels (mismo componente en toda la app).
6. **Unificaciones** — `<ChatBubble>` (grabaciones), `<Banner tone>` (4 banners casi idénticos), `<Field>` (formularios).

## Top 12 a rediseñar primero (mezclando los top-5 por zona)

1. `LeadsPage.tsx` (el infractor más pesado: 146 inline + 34 hex + modal a mano) · 2. `ScheduleCallbackModal.tsx` · 3. `WrapUpView.tsx` · 4. `WhatsAppTemplatesManager.tsx` · 5. `SegmentsManager.tsx` · 6. `AICoachPanel.tsx` · 7. `ConversationThread.tsx` · 8. `CopilotPanel.tsx` · 9. `KnowledgeEditor.tsx` · 10. cuerpos de canal de Grabaciones · 11. sub-reportes + filtros de `ReportsPage.tsx` · 12. modales de `ProgramsHubPage.tsx`.

## Arreglos sistémicos de alto ROI (independientes de archivo)

- Renderizar (o borrar) el **chip live** del HeroBand → recupera un elemento diseñado en ~9 páginas de golpe.
- Tokenizar las **paletas de charts** (`useChartTokens`) → arregla dark mode + unifica los 3 verdes.
- Un **primitivo KPI único** → arregla el look "lavado" en toda la app.

---

_El kit de controles (`ui/_`) ya está completo tras esta sesión. El trabajo de rediseño pendiente es, en su mayoría, **adopción** — sustituir lo nativo/hand-rolled por los primitivos, zona por zona, verificando en Chrome.\*
