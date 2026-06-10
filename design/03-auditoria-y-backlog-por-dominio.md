# 03 · Auditoría y backlog por dominio

> Por cada dominio: **hallazgos a corregir** (severidad) · **lo que falta por diseñar** ·
> **estados faltantes**. Las referencias `archivo:línea` apuntan al código para quien lo tenga
> a la vista. Los problemas **sistémicos** (cisma, foco, `confirm()`, emoji, charts, marca) se
> describen una vez en [doc 01](01-resumen-y-diagnostico.md) y aquí solo se anota dónde pegan.

---

## 1. Shell, navegación y auth

**Nota 6.0** — El login (split-screen con aurora) y el LoadingScreen son **premium**. El shell
real (`VoxSidebar`/`VoxTopbar`) funciona pero arrastra la deuda de a11y y no es responsive.
Conviven un shell **muerto** (`AppSidebar`/`Header`/`RoleGate`/`ThemeToggle`/`NAV_ITEMS`) con
nav divergente.

**🔴 Corregir**
- Foco de teclado y nav operable (P2): `VoxSidebar.tsx:171`, `VoxTopbar.tsx:154,232` son
  `<div onClick>`. Icon-buttons con `title` pero sin `aria-label` (`VoxTopbar.tsx:190-210`).
- Shell **no responsive** (P10): `.app` (`index.css:143`) sin media queries → se rompe < 768px.
- Marca **ARIA/Vox** visible (P11). Unificar con `<BrandLockup>`.
- Menús flotantes con `position:absolute` + números mágicos (`VoxTopbar.tsx:121-175,211-244`):
  no reposicionan, no trapean foco, no cierran con `Esc` → `<Popover>`.

**🟡 Corregir**
- Búsqueda del topbar es decorativa (`VoxTopbar.tsx:82`): el kbd dice ⌘K pero no hace nada →
  conectar al CommandPalette.
- 3 listas de atajos divergentes (`ShortcutsDialog` vs `useKeyboardShortcuts` vs `CommandPalette`)
  → un solo `shortcuts.ts`.
- `LoginScreen`/`ErrorScreen`/`NotFound` ignoran dark; hex `--auth-*` duplicados (`index.css:2253+`).
- Hard-reload brusco en `LoginScreen` (`App.tsx:283,384,454`) → re-check de sesión suave.

**Falta por diseñar**
- Responsive del shell autenticado (drawer móvil + sidebar colapsable con tooltips en modo icono).
- **Centro de notificaciones** (la campana `VoxTopbar.tsx:201` no abre nada): panel, lista,
  agrupación, leído/no-leído, empty, badge-count.
- Búsqueda global funcional (⌘K como buscador real: contactos/agentes/casos).
- Selector de tema con **3 estados** (incluir "system", ya soportado por el context).
- Entrada a **perfil/preferencias** en el menú de cuenta (hoy solo "Cerrar sesión").
- Estado real de integraciones en el sidebar (conectado/caído/sin configurar) — hoy verde fijo.

**Estados faltantes:** VoxSidebar sin loading ni "rol desconocido"; VoxTopbar sin skeleton de
status ni panel de notificaciones; LoginScreen sin error si `instanceUrl` vacío; ErrorScreen sin
variantes por tipo ni respeto de dark.

---

## 2. Dashboard y charts

**Nota 6.0** — `InsightsPanel` (ejecutivo) es rico; los `StatCard` con sparkline están bien.
Pero hay **doble librería de charts**, paleta de datos ajena a la marca y **3 tarjetas premium
huérfanas**.

**🔴 Corregir**
- **Doble motor** recharts + ECharts en el mismo panel (P6): `InsightsPanel.tsx:2-19` (recharts)
  vs `CustomCharts.tsx`/`ChartsLabPage` (ECharts). → unificar en ECharts (`<Chart>`).
- **Paleta de datos hardcodeada ×3** y ajena a la marca (P7): `EChart.tsx:31`, `InsightsPanel.tsx:52`,
  `ChartsLabPage`. El ámbar ni lidera. → `--data-*`.
- **3 cards huérfanas premium**: `GamificationCard`, `ChurnRiskCard`, `WellnessCard` (shadcn +
  framer-motion, con estados completos) no se montan en ningún sitio y están **en inglés** +
  Tailwind crudo. → **montar** (portadas a tokens/español) **o borrar**.

**🟡 Corregir**
- Sin skeletons (P5): `InsightsPanel` usa texto "Cargando…"; el `<Skeleton>` existe sin usarse.
- **5 variantes de KPI** (`Kpi`, `StatCard`, `KPICard`, `.kpi-band`, `.mon-kpi`) → `<KpiTile>`.
- Estilo inline masivo en `InsightsPanel` (cientos de `style={{}}`; radius 14/16 fuera de escala).
- Charts sin `role="img"`/`aria-label`; heatmap solo por `title`; toggles no son `radiogroup`.
- Responsive frágil: grids con ratios fijos inline sin media queries (`InsightsPanel.tsx:820,883`).
- `ChartsLabPage` (22 charts con datos falsos) es ruta accesible → sacar de producción o marcar interno.

**Falta por diseñar**
- **Skeleton de dashboard** (KPI tiles + chart cards) reutilizable.
- `<DateRangePicker>` real (hoy solo presets) + comparación de período consistente en todos los KPIs.
- Estado de **error a nivel panel** ("no se pudieron cargar algunas métricas · reintentar";
  hoy los `fetch` hacen `.catch(()=>{})` silencioso).
- **Vista de agente con métricas propias** (hoy reusa globales; las cards Wellness/Gamification
  fueron diseñadas para esto).
- **Cross-filter** (clic en serie filtra el resto) y export (PNG/CSV/PDF).

**Estados faltantes:** loading/skeleton en todo; error por panel/chart; StatCard sin loading (muestra
`0`/`S/ 0` indistinguible de dato real) ni focus.

---

## 3. Agent Desktop / Workspace (núcleo del producto)

**Nota 6.5** — El más completo y el de mayor superficie. Buena jerarquía del softphone (3 botones
primarios, End rojo central). Pero concentra la deuda de a11y, no es responsive y tiene hardcode
de color masivo.

**🔴 Corregir**
- Foco de teclado en controles de llamada (P2): `vox-sp__pbtn` Mute/Colgar/Espera
  (`AgentDesktopPage.tsx:852-886`) sin foco visible.
- **Sin `aria-live`** para eventos de llamada (P2): "entrante/conectado/en espera/perdido" son
  texto visual (`AgentDesktopPage.tsx:769-783`, `MissedCallBanner.tsx:84`).
- `IncomingCallOverlay` (la pantalla más urgente) no es diálogo accesible y tiene z-index doble
  (`IncomingCallOverlay.tsx:179` `zIndex:200` vs `.incoming-overlay` `z-index:50`).
- **No responsive** (P10): `.call { grid-template-columns:340px 1fr 340px; min-width:1080px }`
  (`index.css:2124`) → scroll horizontal en laptops.
- Targets < 40px (P2): `.btn--sm{height:26px}` en barras densas de acción.

**🟡 Corregir**
- Hardcode de color en inline (P1): `AICoachPanel.tsx:659-682`, `CopilotPanel.tsx:84-198` (`#9B6DFF`),
  `LiveTranscriptPanel.tsx:302` (`#8B7EE8/#22B8D9`), scrim `rgba(8,10,16,.55)` repetido.
- Emoji-icono (P8): chips de canal 💬📧📞 (`AgentDesktopPage.tsx:717`), 📎 (`ChatThreadPanel.tsx:249`).
- **3 relojes de llamada** desincronizados (`CallTimer` vs `ActiveContactsTabStrip.LiveDuration` vs
  `FloatingCallWidget` que cuenta desde 0) → `<CallDuration startedAtMs>`.
- Estado de llamada nombrado/coloreado distinto entre componentes; bug `onHold` vs `onhold`
  (`FloatingCallWidget.tsx:42` vs tab strip `:94`).
- **Email es ciudadano de 2ª clase**: "Responder a todos"/"Reenviar"/"Enviar" `disabled` con
  `title="próximamente"` (`EmailThreadPanel.tsx:436-473`) → patrón honesto "Pronto" o composer real.
- Burbujas de chat (violet) ≠ burbujas de transcript (cyan): dos sistemas de "conversación".

**Falta por diseñar**
- **`<CallDock>` unificado** (`/agent` + flotante, mismo timer y controles) usando `--calldock-h:88px`.
- Estado **"conexión perdida/degradada"** (Streams socket + WebRTC) con banner persistente.
- **Vista de hold rica** (tiempo en espera con escalado de color; hoy el timer se congela en hold).
- Composer de **email funcional** con el mismo lenguaje del de chat (templates/rewriter/adjuntos).
- Indicadores de entrega por mensaje en chat (enviando/enviado/error+reintento) + typing indicator.
- **Command palette del agente (⌘K)**: cliente, transferir, DTMF, callback, template, estado.
- **Modo foco** durante llamada (atenúa todo lo no esencial; un solo locus de "siguiente acción").
- `<Modal>`/`<PanelEmpty>`/`<ChannelBadge>`/`<StateDot>` compartidos (hoy reimplementados N veces).
- Sistema de stacking de flotantes (Copilot, call widget, monitor bar, toasts colisionan).

**Estados faltantes:** `onhold` en el hero; `connecting/dialing` con timeout; reconexión de audio
(hoy solo toast); error de envío de mensaje + reintento; error en AIAssist/AICoach (sin `.catch` de
UI); skeletons de perfil/transcript/casos.

---

## 4. Pipeline, leads y campañas

**Nota 5.5** — El **motor supera a Kommo** (telefonía nativa, vista live-queue, timeline
Vox+Salesforce) pero se ve **menos premium** por el cisma visual y una tarjeta de lead pobre.

**🔴 Corregir**
- **Cisma máximo** (P1): `LeadsPage` (tokens) vs todo `pipeline/*` (Tailwind crudo:
  `ContactBubble.tsx:56-80` gradientes `sky→blue`, rings esmeralda). Mismo "contacto", dos paletas.
- Drag&drop **no accesible** (P2): checkbox con `tabIndex={-1}` + `pointerEvents:none`
  (`LeadsPage.tsx:1451`); sin alternativa de teclado ni `aria-live`. → menú "Mover a etapa →".
- **`confirm()` nativo** (P3): `LeadsPage.tsx:745`, `CampaignDetailPage.tsx:142,339`,
  `CampaignsPage.tsx:107`.
- **Tarjeta de lead pobre** vs Kommo: sin avatar de owner, sin tags, sin **próxima acción** (el
  `assignedAgent` existe pero no se renderiza). La `ContactBubble` solo muestra un cronómetro;
  nombre/teléfono enterrados en `title`.

**🟡 Corregir**
- Emoji-icono y glifos Unicode como controles (`▾↓↑↗✕◆`) (P8): `CampaignCreatePage.tsx:53`,
  `Stage.tsx:54-84`, `LeadsPage.tsx:1423,1653`.
- **3-4 representaciones de agente** (`AgentDropChip`/`AgentRowCard`/`AgentLane`/pills) con mapeos
  de color de estado duplicados y divergentes → `<ContactCard>`/`statusToToken()`.
- Wizard de campaña sin **stepper** ni validación por-campo (`CampaignCreatePage.tsx:340` solo
  "Falta: {missing}" en texto).
- `font-size` mágicos inline por decenas (P9); skeletons solo en 2 de ~6 superficies.
- Microcopy mezcla idioma ("skipped", "Done/Connected/Dialing", `row.status` sin traducir →
  el usuario ve "no_answer").

**Falta por diseñar**
- **`<ContactCard>` único** (lead | live-bubble | feed) 100% tokenizado.
- Tarjeta de lead nivel Pipedrive: owner, tags de color, próxima actividad con countdown, valor
  ponderado, días-en-etapa.
- **Sistema de tags/etiquetas** de lead (columna vertebral de Kommo, hoy ausente).
- Editor visual de **etapas del embudo** (reordenar/renombrar/colorear).
- Drag&drop premium: ghost custom tematizado, drop-zone con shimmer, `layoutId` compartido, undo.
- Bulk actions en el board (mover N, asignar owner, taggear) + densidad configurable.
- Insights del embudo (funnel real etapa→etapa, velocidad por etapa, "12 leads estancados >7d").

**Estados faltantes:** `LeadsPage.load()` traga el error (`:933`); BoardView/FlowView sin
loading/error si el poll falla; error recuperable (todo es `toast`); drag sin ghost custom ni undo visual.

**Pipeline vs Kommo:** gana en capacidades (telefonía, live-queue, timeline cross-CRM); pierde en
coherencia visual, tarjeta y detalles (confirm/emoji/foco). **A 3-4 fixes de verse superior.**

---

## 5. Supervisión y monitoreo

**Nota 5.5** — `MonitoringPage` (`/queue`) está bien tokenizada (`.mon-*`, identidad ámbar), pero
todo `queue/*` usa Tailwind crudo, no hay a11y de tiempo real y falta el indicador de "stale".

**🔴 Corregir**
- **Dos lenguajes** (P1): `MonitoringPage` (tokens) vs `queue/*` + `ContactBubble` (Tailwind
  `bg-emerald-100`/`bg-rose-100` — colores de tema **claro** lavados sobre negro).
  `ContactCard.tsx:52`, `AgentCard.tsx:22-29`, `AgentTable.tsx:15-36`.
- **Cero a11y de tiempo real** (P2): 0 `aria-live`/`role="status"` en una pantalla que cambia cada
  3-15s; sin `aria-label` en icon-buttons del header.
- **Severidad solo por color** (P2): barra SLA ámbar→rojo sin texto (`MonitoringPage.tsx:336`);
  `mon-hdot` círculo de color puro (`:373`); dots de estado de agente. → `<SeverityBadge>`/`<StatusDot>`.
- 4 componentes **muertos en inglés** (`monitoring/KPICard|QueueTable|AgentTable|RefreshIndicator`).

**🟡 Corregir**
- `MonitorControlBar` 100% hardcoded + **emojis** 🎧/🎙️ (`MonitorControlBar.tsx:51-75`) — la
  superficie más crítica del flujo de supervisión sin un token.
- `confirm()`/`alert()` (P3) en forzar desconexión/terminar (`QueueManagerPage.tsx:274,468`).
- Sin `prefers-reduced-motion` en pulsos/pings de tiempo real (P12).
- Beep de alerta con botón mal etiquetado ("Coach IA" mutea alertas, `MonitoringPage.tsx:273`).
- Dos taxonomías de color de canal contradictorias (`channelMeta` vs `ContactBubble.CHANNEL_COLOR`).

**Falta por diseñar**
- **`<FreshnessPill>`** (live/stale/disconnected) — el componente más necesario aquí; hoy el
  live-dot verde pulsa aunque los datos tengan 5 min.
- Vista de **detalle de llamada en vivo** desde el board (transcript en vivo, sentimiento, cliente).
- **Leyenda de semáforos** + umbral de SLA configurable en UI.
- Densidad seleccionable y **responsive de tablas** (la `mon-wtable` no colapsa; supervisor en
  tablet de pared se queda sin layout).
- Ordenamiento/columnas configurables; estado "sin permiso/monitoreo bloqueado".
- Centro de notificaciones para breaches (además del beep).

**Estados faltantes:** **stale ausente por completo**; error no degrada el live-dot; sin loading
incremental en refresh; AuditLog sin error ni paginación.

---

## 6. Grabaciones, transcripciones y reportes

**Nota 5.0** — El dominio con mayor brecha. Vive en **dos design systems sin puente** y su feature
core (escuchar grabaciones) tiene el componente menos terminado.

**🔴 Corregir**
- **Dos DS** (P1): `AudioPlayer`/`TranscriptViewer`/`ContactDetailView` + `reports/*` en shadcn
  (`bg-card`/`bg-muted`) vs vistas de canal en tokens. El ámbar (primario) **ausente** de todo el
  dominio (cyan es el acento de facto).
- **`AudioPlayer` inaccesible** (P2): scrubber `<div onClick>` sin `role="slider"`/teclado/aria
  (`AudioPlayer.tsx:94`); icono de volumen decorativo; sin velocidad ni estados buffering/error.
- **`TranscriptViewer` no navegable**: los segmentos resaltan por tiempo pero **no hacen seek** al
  clic ni auto-scrollean (`TranscriptViewer.tsx:42`); sin búsqueda. Ignora las `.transcript*` ya
  estiladas en `index.css:2154`.
- **Burbujas espejadas** entre vistas de chat: WhatsApp pone agente a la derecha
  (`WhatsAppThreadView.tsx:451`), ChatTranscriptView lo pone a la izquierda (`ChatTranscriptView.tsx:50`).
  El mismo cliente ve su conversación reflejada según qué vista abra.
- `SentimentChart`: inglés + hex (`#22c55e`) + **doble `<Card>` anidada** (`SentimentChart.tsx:45,69`;
  `ReportsPage.tsx:427`).

**🟡 Corregir**
- **3 motores de chart** en una pantalla (P6): SVG a mano (`ReportsPage.tsx:48-252`) + recharts
  (`SentimentChart`) + ECharts existe en stack.
- **3 tablas, 3 implementaciones** → `<DataTable>`.
- "Cargando…" en texto, cero skeletons (P5); modal a mano sin a11y (`Lead360View.tsx:180`).
- Filtros de fecha duplicados: botón decorativo "Últimos 7 días" (`ReportsPage.tsx:352`, sin handler)
  + `<input type="date">` nativo (rompe dark).
- Emoji como sistema de iconos (📞💬📧📎📜🖼️) junto a `primitives` reales.
- Hardcode de fallbacks WhatsApp claros (`#d9fdd3`/`#f0e6d8`) → fondo beige en app deep-black.

**Falta por diseñar**
- **Waveform** en el AudioPlayer (peaks + posición + regiones de sentiment) — oportunidad #1.
- **Transcript clickable-to-seek + auto-scroll + búsqueda**.
- **Hilo omnicanal unificado** (`<ConversationCanvas>`): una timeline cronológica con voz (player
  inline) + WhatsApp + email + archivos bajo el lead (hoy tarjetas separadas + modales).
- **Resumen IA de la llamada** (Bedrock ya existe en infra: `generate-call-summary`) como bloque
  de primer nivel con chips que saltan al timestamp.
- `<DateRangePicker>` unificado; export PDF/XLSX (hoy solo CSV, y el botón de header miente).
- Mini-player persistente + velocidad/volumen/descarga.

**Estados faltantes:** AudioPlayer sin buffering/error/ended/foco; TranscriptViewer sin loading propio
ni "sin Contact Lens" diferenciado; Reports sin skeleton de KPIs ni error de búsqueda; charts sin loading.

---

## 7. Admin, Agentes IA, Flow Builder y Citas

**Nota 5.5** — Polariza: el **Flow Builder (7/10)** y las **Citas** son fuertes; Admin/config es lo
"menos pulido" (forms sin validación, 4 secciones "Próximamente").

**🔴 Corregir**
- Foco de teclado (P2) + varios `outline:none` explícitos (`index.css:3922-3998`).
- **Formularios sin label real** (P2): 0 `aria-label`; placeholder-as-label rampante
  (`AgentePage.tsx:225`, `TaxonomyEditor.tsx:271-341`, `CatalogEditor.tsx:193-234`). WCAG 3.3.2.
- **Validación inexistente, todo por `toast`** (P5): ningún error inline; sin `aria-invalid`.
- **`confirm()` nativo** (P3): `AgentePage.tsx:180`, `FlowBuilderPage.tsx:110`, `AppointmentsPage.tsx:410`,
  `IntegrationsManager.tsx:485`.
- Marca AIRA/Vox/ARIA mezclada en UI (P11): "Agentes IA **de Vox**" (`AgentePage.tsx:307`),
  "Asistente **ARIA**" (`BotTester.tsx:154`), wizard mezcla ambas.

**🟡 Corregir**
- **6 definiciones duplicadas de `inputStyle`/`labelStyle`** (P4): `IntegrationsManager:122`,
  `ConnectSetupWizard:36`, `TeamManager:65`, `AgentePage:336`, `CatalogEditor:22`, `TaxonomyEditor:377`
  → `<FormField>` + tokens `--input-*`.
- **[SIN TERMINAR] AdminPage: 4/8 secciones** (`channels`/`queues`/`ai`/`security`) caen en
  placeholder "Próximamente" (`AdminPage.tsx:320`). El sidebar promete features que no existen.
- **FlowBuilder no responsive** (paneles fijos 200/322px → canvas 0px < 900px) y **sin drag-from-palette**
  (solo `onClick`, `FlowBuilder.tsx:182`); sin undo/redo ni atajos. Minimap `maskColor` fuera de paleta.
- `CatalogEditor`/`TaxonomyEditor` densos tipo hoja de cálculo cruda (el punto más flojo).
- Citas: reschedule = recrear+cancelar (parpadeo); popovers con posición a mano (números mágicos).
- Hardcode WhatsApp skin (`BotTester`/`.fb-wa*`) sin variante light; emoji-icono; voseo inconsistente.

**Falta por diseñar**
- **`<FormField>` + sistema de formularios** (label flotante, hint, error inline, `aria-*`) — la
  palanca #1 para que admin deje de verse "sin terminar".
- Las **4 secciones admin "Próximamente"** (channels/queues/ai/security).
- **Ejecución de tools en Agentes IA** (la UI admite "se conecta en el siguiente paso",
  `AgentePage.tsx:392`); catálogo de tools hoy hardcoded a 4.
- FlowBuilder nivel n8n: drag-from-palette, paneles colapsables/responsive, undo/redo, atajos
  (⌫/⌘Z), empty-canvas guiado, edges con label animado.
- Calendario: empty-state + skeleton + vista "Agenda" (lista) + reschedule in-place.
- Persistencia real de Integraciones (hoy "se guarda localmente por ahora", `IntegrationsManager.tsx:867`).
- `<ConfirmDialog>` + motion de entrada (stagger de cards, transición builder↔lista).

**Estados faltantes:** patrón sistémico **errores=toast, validación=toast, casi nada inline**;
Citas sin empty (data-plane + 0 citas) ni skeleton; AgentBuilder sin readiness/validación visible.
`IntegrationHealthPanel` es el único con error/empty de calidad → **usarlo como referencia**.

---

## Patrones reutilizables detectados (consolidado para el design system)

Los 7 dominios pidieron, de forma independiente, casi los mismos primitivos — fuerte señal de que
el catálogo de [doc 02](02-sistema-de-diseno-premium.md) es correcto. Los más repetidos:

| Primitivo | Lo pidieron (dominios) | Reemplaza |
|---|---|---|
| `<EmptyState>` / `<ErrorState>` | los 7 | N improvisaciones div+texto |
| `<DataTable>` | 5 | ~6 tablas a mano + shadcn |
| `<KpiTile>` | 4 | `Kpi`/`StatCard`/`KPICard`/`.kpi-band`/`.mon-kpi` |
| `<ConfirmDialog>` / `<Modal>` | 5 | 16 `confirm()` + 3 recetas de overlay |
| `<StatusDot>` / `<SeverityBadge>` | 3 | `STATUS_PILL`/`statusColor`/`tone` ×6 |
| `<ChannelBadge>` + `CHANNEL_TOKENS` | 3 | 3-4 taxonomías de color de canal |
| `<FormField>` | admin + workspace | 6 `inputStyle`/`labelStyle` duplicados |
| `<Skeleton>` (uso real) | los 7 | "Cargando…" en texto |
| `<Chart>` (un motor) | dashboard + reports + monitoring | recharts + ECharts + SVG |
| `<Avatar>` determinístico | 3 | 3-4 tratamientos de avatar |
| `<BrandLockup>` | shell | 5 implementaciones + fija marca |
| `<CallDuration>` | workspace | 3 relojes desincronizados |
