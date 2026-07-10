# Auditoría amplia de ARIA — 2026-07-09

Barrido multi-agente sobre `src/` (frontend) y `amplify/functions/` (backend), buscando: código
mock/demo/stub en producción, código muerto/aislado, funciones no implementadas o inertes, y
coherencia de flujo + brechas de UX/diseño. Cada hallazgo está verificado contra el código real con
`archivo:línea`.

> **Estado:** informe vivo. Los frentes _código muerto_ y _no-implementado_ seguían corriendo al
> momento de escribir; se anexan cuando terminen. El fix 🔒 ya está aplicado en esta sesión.

## Resumen por severidad

| Severidad  | Qué significa                                                     | Nº aprox. |
| ---------- | ----------------------------------------------------------------- | --------- |
| 🔴 BLOCKER | Llega a producción y expone datos, o rompe un flujo núcleo        | 5         |
| 🟠 MAJOR   | Defecto real de flujo/estado que el usuario nota                  | ~14       |
| 🟡 MINOR   | Voseo, copy en inglés, colores hardcodeados, inconsistencia de DS | ~30       |

---

## 1. Mock / Demo / Stub en producción

### 🔴 BLOCKER

- **`src/App.tsx` — 3 rutas demo sin auth en producción.** `/bot-demo`, `/agente-demo` e
  `/inicio-demo` omitían el guard `import.meta.env.DEV &&` que sí tienen las otras 7 rutas demo.
  `/agente-demo` montaba el **AgentePage real** (CRUD vía Function URLs públicas) sin login.
  **🔒 CORREGIDO en esta sesión** — las tres ahora son DEV-only, como las demás.
- **`src/pages/AgentDesktopPage.tsx:773-833`** — Toggle **"Vista demo"** siempre visible en el Agent
  Desktop real (no gated por DEV ni rol). Al activarlo reemplaza todo el softphone por el cockpit
  mock (`aria-cockpit/mockData.ts`) y **persiste en localStorage** (`vox.agentDesktop.demoView`).
  Está rotulado honestamente, pero es la mayor superficie mock en una pantalla núcleo.
  **Decisión de producto pendiente:** ¿removerlo, esconderlo tras flag, o dejarlo?

### 🟠 MAJOR — rutas lab/demo alcanzables por URL (requieren login, sin DEV-gate ni enlace)

- `/coach-demo` (`src/pages/CoachDemoPage.tsx`) — sus CTAs llaman a **endpoints reales**.
- `/wrapup-demo` (`WrapUpDemoPage.tsx`), `/monitor-demo` (`MonitorDemoPage.tsx`),
  `/charts-lab` (`ChartsLabPage.tsx`, datos "representativos").
- **Fix sugerido:** DEV-gatearlas igual que las otras (cambio consistente y seguro).

### 🟡 MINOR — placeholders honestos "Próximamente"

`AdminPage.tsx:372`, `EmailThreadPanel.tsx:412/429/437`, `ChannelsManager.tsx:180`,
`EditCampaignDialog.tsx:300`, `ConversationThread.tsx:841`, `CustomerContextBar.tsx:344`,
`automations.ts:311`. No devuelven datos falsos, pero exponen features vacías.

### ✅ Verificado limpio

Dashboard real `/` (datos reales; `execMock` solo por tipos), backend `amplify/functions/`
(sin datos fabricados), y el resto de rutas `*-demo` (bien envueltas en `import.meta.env.DEV`).

---

## 2. Coherencia de flujo — callejones sin salida y CTAs inertes

### 🔴 BLOCKER / 🟠 MAJOR — botones primarios sin `onClick` (no hacen nada)

- **`aria-cockpit/StartContact.tsx:73/86/99`** — "Capturar lead", "Crear tarea" y "Enviar email":
  los tres CTAs primarios sin handler; los inputs además sin estado. Clic = nada.
- **`aria-cockpit/Tareas.tsx:90`** — "Listo" (completar tarea) sin `onClick`; la acción principal
  de la tarjeta es inerte (el hermano "Llamar" sí está cableado).
- **`aria-cockpit/AgentCockpitDemo.tsx:258`** — "Llamar" en el ChannelBar sin `onClick`.
- **Fix:** cablear handler (validar + emitir; al mínimo `toast` + volver al menú), aun en demo.

### 🟠 MAJOR — errores/loading tragados (el usuario pierde datos en silencio)

- **`workspace/AIAssistPanel.tsx:43-58`** — `search()` sin `catch` ni chequeo `r.ok`; sin estado
  `error`. Un fallo cae al empty state → no distingue "falló" de "sin resultados".
- **`workspace/AICoachPanel.tsx:278-296`** — `fetchSuggestions()` igual (sin `catch`/`r.ok`),
  aunque el resto del archivo sí usa `toast.error`. El coach falla mudo.
- **`AgentIdleCockpit.tsx:126-138`** — Consume hooks que exponen `loading`/`error` pero solo lee la
  data; si falla el fetch, los leads/llamadas perdidas del agente **desaparecen sin aviso**.
- **`pages/ReportsPage.tsx:295`** — descarta `error` de `useContacts`; un fallo se ve como
  "Sin contactos en el rango".
- **`pages/AppointmentsPage.tsx:269-275`** — descarta `error` de `useCallbacks`; el calendario queda
  vacío en silencio.
- **Fix (patrón):** desestructurar `error`, mostrar banner/toast distinto del empty state.

### 🟠 MAJOR — acciones consecuentes sin confirmación

- **`workspace/AICoachPanel.tsx:946-1017`** — `transfer` (mueve el contacto vivo de cola) y
  `send_template` (envía WhatsApp al cliente) disparan con **un solo clic**, label autogenerado por
  IA, solo feedback post-hoc. **Fix:** confirm o ventana de "deshacer" antes de disparar.
- **`reports/ScheduledExportsPanel.tsx:212`** — borra el export programado sin confirmación.
- **`aria-cockpit/MyLeads.tsx:93`** — "Saltar" lead sin confirm/undo.

### 🟠 MAJOR — otros callejones / navegación equivocada

- **`workspace/MissedCallBanner.tsx:111-124`** — si no resuelve un estado ruteable, el único botón
  queda `disabled` y el banner **no tiene cierre** → el agente queda bloqueado sin salida.
- **`reports/BotAnalyticsReport.tsx:253`** — el empty state del reporte "Agente IA" manda a `/bot`
  ("Probar bot"), pero el Agente IA se prueba en `/agente`. CTA a la página equivocada.
- **`pages/AdminPage.tsx:343 + 350-361`** — **doble render en Segmentos**: se muestran a la vez el
  `SegmentsManager` real y la tarjeta "Próximamente · Segmentos" (la cadena de exclusión omite
  `section !== "segments"`).
- **`pages/AdminPage.tsx:149/234/380`** — enlaces "Abrir en Connect" hacen `window.open(instanceUrl…)`;
  con `instanceUrl=""` (tenant en onboarding) abren `<app>/connect/users` → 404. **Fix:** `disabled`.
- **`pages/AppointmentsPage.tsx:675-679`** — "Conectar base de datos" navega a `/admin`, que cae en
  "Usuarios y roles" (default), no en Integraciones. **Fix:** preseleccionar la sección.

---

## 3. UX pulible / feedback

- **`AgentIdleCockpit.tsx:230-231/331-338`** y **`Dialer.tsx:248`** — muestran copy de "vacío"
  ("0 tareas", "sin contactos en cola") **durante la carga** en vez de un skeleton; subtítulo de
  tareas con números inventados hardcodeados ("2 vencen hoy · 1 atrasada").
- **`AIAssistPanel.tsx:60-67`** — el auto-suggest pisa lo que el agente está tecleando en el buscador.
- **`AIAssistPanel.tsx:191`** — las pestañas Conocimiento/Guiones/Objeciones muestran el **mismo**
  resultado (mismo endpoint) → se sienten no-funcionales.
- **`aria-cockpit/MissedCalls.tsx` / `CustomerSearch.tsx`** — filas de WhatsApp/email bajo un CTA
  ("Devuélvelas…") pero sin acción; solo las de voz son accionables.
- **`AppointmentsPage.tsx:1460-1489`** — feedback inconsistente: unas acciones de estado dan toast y
  otras no. **`:346/402`** — reprogramar/editar sin endpoint no da feedback.
- **`ActiveContactsTabStrip.tsx:234`** — "hace {N}s" congelado (no arranca timer como `LiveDuration`).

---

## 4. Voseo (copy) — español neutro pendiente

Restos de voseo argentino visibles al usuario (el copy debe ser tuteo neutro):

- **Builders (bots):** `FlowBuilder.tsx` coach + `FlowHelpWizard.tsx` (5 casos) — **🔒 CORREGIDO**.
- **`pages/ReportsPage.tsx:236/699`** — "Exportá/programá", "Bajá".
- **`pages/AppointmentsPage.tsx:677`** — "Activala".
- **`reports/PowerBiFeedPanel.tsx:146/223/227/231`** — "Tratala/aceptá/expandí/programá".
- **`reports/ScheduledExportsPanel.tsx:148`** — "Corré". **`reports/ReportDownloads.tsx:12`** — "bajás".

## 5. Copy en inglés (debería estar en español)

- **`reports/ContactFilters.tsx:76/102`** — "Username del agente", "Sentiment".
- **`reports/ContactsTable.tsx:122`** — header "Sentiment".

## 6. Colores hardcodeados / mezcla de vocabularios de token

Hex/rgba literales en vez de tokens (rompen dark mode): `BotAnalyticsReport.tsx:228/266` (#9B6DFF),
`LiveTranscriptPanel.tsx:302` (#8B7EE8/#22B8D9), `AICoachPanel.tsx:656-684` (rgba de tono),
`CallBar.tsx:187` / `MissedCallBanner.tsx` (#fff), `PhonePad.tsx:106`, `DateRangePicker.tsx:184`.
Además, mezcla `--iris/--gold/--cyan` (aliases) vs `--accent-violet/--accent-amber/--accent-cyan`
entre paneles hermanos (`MomentsPanel`, `CustomerBrowser`) — inconsistencia de nombres, no roto.

## 7. Inconsistencias de design system

Botones/inputs/tabs/pills crudos (`btn btn--…`, `<select>`, `pill pill--outline`) rehechos a mano en
vez de `Btn`/`Card`/`Pill` de `@/components/aria`, en: `ScheduledExportsPanel`, `ContactFilters`,
`CustomerSearch`, `StartContact`, `CustomerBrowser`, `AdminPage` (Usuarios), `LiveTranscriptPanel`,
`Customer360MoreMenu`, y las 3 páginas repiten su propia barra de tabs. **Fix estructural sugerido:**
extraer primitivos `Tabs`/segmented y una variante de `Pill`/`Btn` clicable; y un `Alert`/`Banner`
común (hoy `AdminPage:213` pinta el error a mano).

## Bugs sutiles verificados

- **`reports/AttributionReport.tsx:49-60`** — fetch sin guard `cancelled` → una respuesta vieja puede
  pisar la nueva al cambiar de programa rápido (los hermanos sí lo tienen).
- **`reports/ScheduledExportsPanel.tsx:163`** — `<select>` de dataset con **una sola** opción.
- **`reports/AgentPerformanceReport.tsx:87-134`** — orden siempre descendente; reclickear la columna
  no alterna asc/desc.

---

---

## 8. Ola 2 — Agent Desktop, Monitoreo, Agente IA, Configuración

### 🔴 BLOCKER / 🟠 MAJOR nuevos (verificados)

- **`hooks/useConnections.ts:324`** — **Falso "guardado".** El POST al backend está en
  `try {…} catch { /* el cache local ya guardó */ }`: un fallo de red/servidor se **descarta en
  silencio** y `save()` resuelve como éxito. Encadena a `toast.success` incondicionales en
  `ChannelsManager.tsx:70-83`, `IntegrationsManager.tsx:278/1791/1946` → el usuario cree que guardó
  su conexión de Connect/Meta/SSO cuando no. **El más importante de esta ola.**
- **`workspace/EmailThreadPanel.tsx:403-410`** — Composer de email muerto: se escribe la respuesta
  completa pero "Enviar respuesta" está `disabled` permanente ("necesita SendEmail Lambda"). El canal
  email es de solo lectura de facto. **Fix:** cablear el Lambda o no meter al agente a un textarea muerto.
- **`pages/MonitoringPage.tsx:220-230`** — **Pantalla en blanco si la carga inicial falla.**
  `if (!metrics) return null` corre antes de la UI de error (que solo se ve en un refresh posterior).
  **Fix:** renderizar error + "Reintentar" antes del `return null`.
- **`admin/CatalogEditor.tsx:56-64`** y **`admin/KnowledgeEditor.tsx:119-127`** — `load()` con
  `try/finally` **sin catch** → un fallo de red se disfraza de empty state ("Todavía no tienes…").
- **`pages/AgentePage.tsx:417-419`** — el modal de detalle de conversación **no se puede cerrar
  mientras carga** (backdrop gateado en `!convLoading`, la X no limpia `convLoading`).

### 🟠 MAJOR — feedback / afordancias engañosas

- **`AgentePage.tsx:648` + `BotTester.tsx:228`** — la "X" del playground **reinicia** el chat en vez
  de cerrar (no hay nada que cerrar; está anclado). **Fix:** ocultar la X en modo embebido.
- **`MonitoringPage.tsx:282-290`** — botón rotulado **"Coach IA"** que en realidad solo silencia la
  alerta sonora (`muted`). **Fix:** rotular "Silenciar alertas" con ícono acorde.
- **`vox/WrapUpView.tsx:1100`** — chip "Q sugiere" (IA) sobre sugerencias que son un array estático.
- **`AgentePage.tsx:484`** — copy menciona modelo "Lex" que no está en `MODELS`.
- **`ChatThreadPanel.tsx:230`** — pill de estado muestra el string interno en inglés
  ("connecting"/"ended") cuando no está "connected".

### 🟡 MINOR — confirmaciones destructivas inconsistentes

`window.confirm()` nativo (en vez de `useConfirm`) en `SegmentsManager.tsx:127`,
`KnowledgeEditor.tsx:218`, `SuppressionManager.tsx:105`. Desconexión de **Salesforce**
(`IntegrationsManager.tsx:1002`) y **Mercado Libre** (`:2162`) y quitar agente de cola
(`QueuesPanel.tsx:566`) **sin confirmación**, mientras acciones hermanas del mismo archivo sí la piden.

### 🟡 Voseo — PERVASIVO en Configuración (~40 casos)

`IntegrationsManager.tsx` concentra ~25 (Desplegá/Autorizá/Registrá/Diseñalos/Personalizá/
Separalos/vendés/recibí/Tildá/suscribite…), + `ConnectSetupWizard.tsx` (~7), `CatalogEditor`,
`KnowledgeEditor`, `SegmentsManager`, `ConsumptionManager`, `AiContactLensManager`, `QueuesPanel`,
`ChannelsManager`, `TeamManager`, `WhatsAppTemplatesManager`, y `cfnTemplates.ts` (~14 en descripciones).
**Un solo barrido de español-neutro lo cierra** (mismo tipo de fix que ya apliqué en los builders).

### 🟡 Sistémico — Configuración usa el design system VIEJO

Los 17 componentes de `admin/` importan de `@/components/vox/primitives` (Card/Kpi/Avatar) + `.btn`
crudos; **ninguno** usa los primitivos nuevos `@/components/aria` (`Btn`/`Card`/`Stat`/`Pill`). No hay
mezcla en una misma pantalla (bueno), pero toda el área quedó sin migrar. Checkbox/radio nativos sin
estilar en ~9 sitios.

### ✅ Verificado sano (ola 2)

CRUD de **Agente IA** (crear/editar/eliminar-con-confirm/duplicar/playground) sin callejones;
**NotFound** con "Volver al inicio"; idle cockpit real (handlers con toast+error); los 5 modales del
softphone (X+Esc+backdrop, loading/empty/error); `IntegrationHealthPanel`/`WhatsAppHealthPanel`.

---

## Prioridad sugerida de remediación

1. **🔴 Ya hecho:** DEV-gate de las 3 rutas demo (seguridad).
2. **🟠 Rápidas y de alto impacto:** cablear los CTAs inertes del cockpit; confirm en acciones
   destructivas/consecuentes (transfer, send_template, borrar export, saltar lead); consumir `error`
   en Reportes/Citas/cockpit; doble-render de Segmentos; enlaces Connect rotos en onboarding; CTA de
   `/agente` en el reporte de IA.
3. **🟡 Barrido de pulido:** voseo restante + copy en inglés + tokens de color + primitivos de DS.
4. **Decisión de producto:** el toggle "Vista demo" del Agent Desktop.

> Los frentes **código muerto/aislado** y **funciones no implementadas** se anexarán al terminar sus
> agentes.
