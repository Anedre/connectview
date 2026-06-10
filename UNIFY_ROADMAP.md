# Vox — Roadmap de Unificación

**Objetivo:** reemplazar el stack fragmentado del cliente (Kommo + Chattigo + Sappier + Salesforce manual) con **una sola plataforma**. El dolor central: *tipificación manual y triple herramienta para clasificar el mismo lead de WhatsApp, y después otra vuelta para empujarlo a Salesforce.*

**Principio rector:** Vox ya tiene el 60% del stack de contact-center (voz, WhatsApp, Customer Profiles, dialer, wrap-up tree, coach, pipeline, callbacks, Contact Lens). Este roadmap **cierra los gaps específicos** que hoy obligan al cliente a pagar 3 herramientas — no reconstruye lo que ya existe.

**Sizing:** S ≈ ½ día · M ≈ 1-2 días · L ≈ 3-5 días · XL ≈ 1-2 semanas.

---

## Lo que YA tenemos (no se reconstruye)

| Capacidad | Dónde vive | Estado |
|---|---|---|
| Campañas voz + dialer (tick EventBridge 1 min) | `campaign-dialer`, `connectview-campaigns/-contacts` | ✅ |
| Campañas WhatsApp (Meta Cloud API) | `send-whatsapp-template` (SocialMessaging) | ✅ |
| Customer Profiles unificado por teléfono | `lookup/update/search-customer-profile` + upsert CSV | ✅ |
| Árbol de tipificación (stage/subStage/valoración) + historial append-only | `dispositions.ts`, `save-agent-notes`, `connectview-wrapup-history` | ✅ |
| Coach interactivo (6 tipos de bloque + CTA dispatcher) | `AICoachPanel.tsx`, `generate-call-summary` (Bedrock) | ✅ |
| Pipeline / stages / board / queue manager | `usePipelineStages`, `get-live-queue`, `Pipeline.tsx` | ✅ |
| Callbacks / follow-ups multicanal | `schedule-callback`, `callback-dispatcher`, `connectview-callbacks` | ✅ |
| Contact Lens transcript + sentiment en vivo | `get-live-transcript`, `LiveTranscriptPanel.tsx` | ✅ |
| Cliente 360 + thread merge + adjuntos cross-channel | `get-customer-thread/-attachments`, `CustomerProfilePanel.tsx` | ✅ |
| Admin: monitor / transfer / stop / change-status / audit | `admin-*` lambdas, `connectview-admin-audit` | ✅ |
| Q knowledge base (Wisdom) | `get-q-suggestions`, `AIAssistPanel.tsx` | ✅ |
| Grabaciones + búsqueda + playback | `get-recording`, `RecordingsPage.tsx` | ✅ |

---

# WAVE 1 — Motor de Clasificación Unificada
> **El asesinato del dolor.** Esto es lo que reemplaza Kommo + las 3 herramientas de tipificación. Máxima prioridad porque es la razón #1 por la que el cliente quiere cambiar.

### 1. Tipificación universal cross-channel — ✅ HECHO (2026-05-29)
- **Estado:** el wrap-up tree existe pero está cableado al flujo de voz. Chat/email/WhatsApp no comparten la misma tipificación.
- **Gap (confirmado por el cliente):** hoy tienen **3 taxonomías paralelas** — Salesforce, Chattigo y la 3ra herramienta (Kommo). El mismo lead se tipifica distinto en cada una. **La meta: UNA sola taxonomía canónica que usan todos los agentes en todos los canales, y que se empuja a Salesforce (SF deja de ser taxonomía → pasa a ser destino).**
- **Build entregado:** `WrapUpView` ahora carga la taxonomía vía `useTaxonomy()` (misma fuente para voice/chat/whatsapp/email — el componente ya era channel-aware). `save-agent-notes` ahora persiste `channel` en la fila de wrap-up y en el history append-only para segmentar reportes por canal.
- **Esfuerzo:** M (real) · **Toca:** `WrapUpView.tsx`, `save-agent-notes`, `useTaxonomy.ts`

### 2. Taxonomía configurable (no hardcodeada) — EL source of truth único — ✅ HECHO (2026-05-29)
- **Estado:** el árbol vivía hardcodeado en `src/lib/dispositions.ts`.
- **Gap:** para reemplazar las 3 taxonomías del cliente, esta tabla tiene que ser EL canónico editable que todos los canales consumen y que mapea hacia los campos de Salesforce.
- **Build entregado:** tabla `connectview-taxonomies` (PK=`taxonomyId`) + Lambda `connectview-manage-taxonomy` (CRUD, Function URL pública, inline IAM `TaxonomyAccess`). `dispositions.ts` ahora tiene loader async con caché + fallback estático; `useTaxonomy()` hook. Editor admin en **Configuración → Tipificación** (`TaxonomyEditor.tsx`): edita stages/subStages/valoración/descripción, guarda vía Lambda, invalida caché. UDEP default seedeado (`scripts/seed-taxonomy.mjs`). El tipo soporta `salesforceValue` por stage/subStage para el mapeo a SF (#23). Verificado end-to-end en Chrome: editar→guardar→persiste en DDB→re-fetch.
- **Pendiente menor:** taxonomía por-campaña (hoy hay 1 default global; el modelo ya soporta múltiples docs).
- **Esfuerzo:** L (real) · **Toca:** nueva tabla+Lambda+IAM, `dispositions.ts`, `useTaxonomy.ts`, `TaxonomyEditor.tsx`, `AdminPage.tsx`, `api.ts`, `amplify_outputs.json`

### 3. ⭐ Auto-clasificación asistida por el Coach — ✅ HECHO (2026-05-29)
- **Estado:** el Coach ya propone bloques `form` y `action`. No proponía tipificación.
- **Gap:** ESTE es el remate del pitch. "No más tipificación manual" = Claude sugiere la tipificación leyendo el transcript.
- **Build entregado:** modo `mode: "wrap-up-suggest"` en `generate-call-summary` recibe la taxonomía activa + transcript y devuelve `{ stageId, subStageId, valoracion, confidence, reason }`. `WrapUpView.tsx` lo fetchea al montar, auto-aplica la sugerencia (sin pisar selección manual), muestra banner violeta con confidence% + cita del cliente, badges "🪄 IA" en stage/subStage, y botón "Aplicar sugerencia" si el agente se desvió. Demo en `/wrapup-demo`.
- **Verificado:** 3/3 transcripts reales clasificados correctos (incluso matcheó subStage al canal pedido). Override + re-aplicar OK.
- **Esfuerzo:** M (real: ~½ día) · **Toca:** `generate-call-summary` (+prompt+TaxonomyStage type), `WrapUpView.tsx`, `WrapUpDemoPage.tsx`

### 4. Lead pipeline / embudo generalizado — ✅ MVP HECHO (2026-05-29)
- **Entregado:** tabla `connectview-leads` + Lambda `connectview-manage-leads` (CRUD + dedup-by-phone + move-stage) + `LeadsPage.tsx` (ruta `/leads`, nav "Leads"). **Board Kanban cuyas columnas SON las stages de la taxonomía unificada (#2)** — un lead vive en la columna de su tipificación. Cards con fuente (Campaña/Web/Salesforce/Manual) + dropdown para mover. Dedup por teléfono (re-upsert actualiza, no duplica). **Verificado en vivo** (3 leads de 3 fuentes, move OK). Cierra la narrativa: una taxonomía → wrap-up + embudo + mapeo SF.
- **Futuro:** drag-and-drop, custom fields por stage, GSI por phone para escala, crear-lead automático desde wrap-up/inbound.

- **Estado:** hay pipeline para campañas (stages de contacto), no un embudo de lead estilo Kommo con deal cards.
- **Gap:** Kommo: hasta 10 pipelines, 100 stages, custom fields per stage, drag-and-drop. El cliente clasifica leads moviéndolos por el embudo.
- **Build:** tabla `connectview-leads` (PK=`leadId`, GSI por `phone` y por `stageId`). Reusar la vista `BoardView.tsx`/`Stage.tsx` que ya existe. Custom fields por stage (JSON). Un lead se crea desde: form web (#25), inbound WhatsApp, CSV de campaña, o manual. Vínculo lead↔Customer Profile por teléfono.
- **Esfuerzo:** XL · **Dependencias:** #2 · **Toca:** nueva tabla + `manage-leads` Lambda, reuso `BoardView`, nueva `LeadCard.tsx`

---

# WAVE 2 — Reporting & Analytics
> **La joya de la corona de Chattigo.** El cliente dijo explícitamente "las métricas de Chattigo son buenas". Si vamos a reemplazarlo, hay que igualar o superar sus 7 reportes.

### 5. Los 7 reportes de Chattigo — 🟡 EN PROGRESO (1/7 hecho, 2026-05-29)
- **Estado:** hay `getCampaignStats` y `get-realtime-metrics` (snapshot). ReportsPage ya tenía volumen-por-canal + AHT histogram + sentiment.
- **Gap:** Resumen de chats · Detalles · **Rendimiento agente ✅** · Sesiones · Bot · Chat CRM · HSM Outbound.
- **Entregado:** **Rendimiento de agente** (`AgentPerformanceReport.tsx`) — tabla por agente (volumen, AHT, % positivo/negativo, canal, abandono), ordenable, agregación frontend sobre los `contacts` reales ya cargados (sin Lambda nuevo). Resuelve el nombre del agente vía `useUsers`. **Verificado en vivo** con 116 contactos reales.
- **Pendiente:** los otros 6 reportes (especialmente HSM Outbound #6). Para reportes más pesados/cross-source convendrá el Lambda `get-analytics-report` + `connect:GetMetricDataV2`.
- **Esfuerzo:** L→XL · **Toca:** `AgentPerformanceReport.tsx`, `ReportsPage.tsx`

### 6. ⭐ Reporte HSM Outbound (el más detallado del mercado) — 🟡 BASE HECHA (2026-05-29)
- **Entregado:** tabla `connectview-hsm-sends` + `send-whatsapp-template` escribe una fila por envío (status `sent`) + Lambda `connectview-get-hsm-report` (agrega por plantilla) + UI `HsmOutboundReport.tsx` en ReportsPage (KPIs enviados/entregados/leídos/fallidos/%lectura/%fallo + tabla por plantilla). **Verificado** con filas sintéticas (ya borradas). **Falta (#14):** los eventos de estado de AWS Social Messaging que llenan delivered/read/failed — hoy solo se puebla `sent`.
- **Estado previo:** mandamos templates WhatsApp pero no trackeábamos su ciclo de vida.
- **Gap:** Chattigo trackea: enviados/entregados/leídos/fallidos-por-causa/expirados/pendientes + response rate + conversion + quality rating trend + opt-outs por 1000 + atribución de revenue.
- **Build:** tabla nueva `connectview-hsm-sends` (PK=`sendId`, GSI por `campaignId`, `phone`, `templateName`). Cada `send-whatsapp-template` escribe una fila. Webhook de status de Meta (sent→delivered→read→failed) actualiza la fila (nuevo Lambda `whatsapp-status-webhook`). Reporte agrega todo + cruza con wrap-up para conversion.
- **Esfuerzo:** L · **Dependencias:** #14 (status webhook) · **Toca:** nueva tabla, `send-whatsapp-template` (+escritura), nuevo webhook Lambda

### 7. Exports programados (Excel/CSV daily/weekly/monthly)
- **Estado:** no hay exports automáticos.
- **Gap:** Chattigo envía reportes por mail en schedule.
- **Build:** tabla `connectview-report-schedules`. EventBridge cron dispara `run-scheduled-reports` que genera el reporte (#5), lo convierte a XLSX (lib `xlsx`), y lo manda por **SES** a los destinatarios. UI para configurar el schedule.
- **Esfuerzo:** M · **Dependencias:** #5 · **Toca:** nuevo Lambda + tabla + cron, SES setup

### 8. Dashboard custom con widgets real-time — ✅ HECHO (2026-05-29)
- **Entregado:** `CustomWidgets.tsx` en DashboardPage — fila "Mis widgets" toggleable (Personalizar, persiste en localStorage) con datos reales: Leads en embudo, Citas próximas, Plantillas WA enviadas, Catálogos. **Verificado** en vivo (3 leads, 1 cita). Drag-drop/grid libre = futuro.

- **Estado:** `DashboardPage` tiene snapshot fijo.
- **Gap:** Kommo: dashboard con widgets ilimitados, real-time.
- **Build:** layout de widgets configurable (grid arrastrable). Cada widget consume un endpoint existente (`getCampaignStats`, `get-live-queue`, `get-realtime-metrics`). Persistir layout por usuario en `connectview-contacts`-style prefs o localStorage v1.
- **Esfuerzo:** L · **Dependencias:** #5 (para widgets de reporte) · **Toca:** `DashboardPage.tsx`, nueva `WidgetGrid.tsx`

### 9. ⭐ Supervisor escuchar/intervenir en vivo (GANA a ambos) — ✅ HECHO (2026-05-29)
- **Estado:** tenemos `admin-monitor-contact` (silent monitor).
- **Gap:** **ni Kommo ni Chattigo tienen barge/listen-in en vivo.** Diferenciador puro — Connect lo soporta nativo.
- **Realidad de plataforma (importante):** Amazon Connect + amazon-connect-streams 2.25 exponen SOLO `SILENT_MONITOR` y `BARGE` programáticamente. **NO existe whisper/coaching en la Streams API** (el whisper de Connect vive en el Agent Workspace nativo). Así que entregamos los 2 modos reales, honestamente — sin un botón "whisper" que mienta.
- **Build entregado:** `admin-monitor-contact` pide `[SILENT_MONITOR, BARGE]` (param `allowBarge`). CCPContext detecta la sesión de monitoreo vía `getMonitorStatus()` y expone `monitorSession` + `setMonitorState()` (usa `contact.silentMonitor()`/`bargeIn()`) + `endMonitor()`. `MonitorControlBar` flotante (el CCP es headless → es la única UI): Escuchar↔Intervenir en vivo (se pone roja al barge) + Salir. `AgentActionsDialog` simplificado: "Monitorear" inicia escuchando, la barra escala. Demo en `/monitor-demo`.
- **Verificación:** UI verificada en Chrome (toggle + salir). Falta prueba con llamada real + softphone supervisor (necesita 2 partes en vivo).
- **Pendiente opcional:** alarmas SLA en vivo sobre `get-live-queue`.
- **Esfuerzo:** M (real) · **Toca:** `admin-monitor-contact`, `CCPContext.tsx`, `MonitorControlBar.tsx`, `AgentActionsDialog.tsx`, `useAdminActions.ts`, `App.tsx`

---

# WAVE 3 — Riqueza de WhatsApp
> Lo que hace que el WhatsApp de Kommo se sienta premium. El cliente vive en WhatsApp.

### 10. ⭐ WhatsApp Flows (forms in-chat) — 🟡 V1 HECHA (2026-06-10, falta Flow real del usuario)
- **Entregado (v1):** Lambda `connectview-send-whatsapp-flow` (mensaje interactivo Flows API v3, dual-mode AWS/Meta, dryRun, tracking en hsm-sends como `flow:<nombre>`) + captura de la respuesta `nfm_reply` en `whatsapp-meta-webhook` → `propagateLead` (lead + CP + SF) con los campos del form como attributes `flow_*` + history + **trigger nuevo de Automatizaciones `whatsapp_flow_completed`** (form completado → mover etapa / plantilla / webhook). UI: registro de Flows (flow_id+nombre+CTA+pantalla) en Integraciones → WhatsApp; botón "Enviar formulario" en el composer del chat (solo WA, respeta ventana 24h). **Verificado e2e sintético** (webhook → lead "Carla Flow E2E" + automatización OK). **Falta (usuario):** diseñar/publicar un Flow real en Meta Business Manager y pegarlo en Integraciones; registrar el webhook en su app Meta (tenants modo "meta"). **Limitación v1:** captura estructurada solo modo "meta" (en modo "aws" la respuesta llega al chat del agente — la WABA tiene un solo event destination); Flows en campañas masivas = v2.
- **Estado previo:** mandamos templates con variables.
- **Gap:** Kommo tiene Flows — formularios multi-pantalla DENTRO de WhatsApp. Reemplaza Typeform/Sappier para captura de datos.
- **Build:** integrar Meta WhatsApp Flows API. Nuevo Lambda `send-whatsapp-flow`. El Flow JSON se diseña en Meta; Vox lo dispara y recibe la respuesta vía webhook → escribe en Customer Profile + crea/actualiza lead. **Esto es directamente lo que Sappier hace, pero nativo en WhatsApp.**
- **Esfuerzo:** L · **Dependencias:** #14 · **Toca:** nuevo Lambda, webhook handler

### 11. Templates Carousel + List Message
- **Estado:** solo templates de texto con variables.
- **Gap:** Kommo soporta carruseles (cards con botones) y list messages (menús hasta 10 items).
- **Build:** extender `send-whatsapp-template` para `components` tipo carousel y la API de interactive list. UI en el wizard de campaña para elegir tipo.
- **Esfuerzo:** M · **Dependencias:** ninguna · **Toca:** `send-whatsapp-template`, `NewCampaignWizard.tsx`

### 12. Countdown de ventana 24h / 72h — ✅ HECHO (2026-05-29)
- **Entregado:** `WindowCountdown.tsx` — chip en el composer (solo WhatsApp) con tiempo restante de la ventana de 24h desde el último mensaje del cliente; verde/amber/rojo + "ventana cerrada · solo plantillas" al expirar.

- **Estado:** no se muestra la ventana de sesión.
- **Gap:** Kommo muestra al agente el timer de la ventana de 24h (y 72h para click-to-WA ads). Crítico para no mandar free-text fuera de ventana.
- **Build:** calcular desde el último mensaje inbound del cliente (ya está en el thread). Mostrar chip countdown en el chat panel. Fuera de ventana → forzar uso de template.
- **Esfuerzo:** S · **Dependencias:** ninguna · **Toca:** `ChatThreadPanel.tsx`

### 13. Quality Rating + Messaging Limits monitor
- **Estado:** no monitoreamos la salud del número Meta.
- **Gap:** Chattigo muestra trend de Quality Rating y evolución de Messaging Limits.
- **Build:** Lambda `get-whatsapp-health` que consulta la WhatsApp Business Management API (phone number quality_rating, messaging_limit_tier). Widget en dashboard + alarma si baja a YELLOW/RED.
- **Esfuerzo:** M · **Dependencias:** ninguna · **Toca:** nuevo Lambda, widget

### 14. Webhook de status de WhatsApp (deliverability)
- **Estado:** mandamos, no sabemos si llegó/se leyó.
- **Gap:** sent/delivered/read/failed/expired tracking — base para #6 y #10.
- **Build:** Lambda `whatsapp-status-webhook` (Function URL pública) suscrito a los webhooks de Meta. Actualiza `connectview-hsm-sends` y el thread. **Habilitador de #6 y #10.**
- **Esfuerzo:** M · **Dependencias:** ninguna (es base) · **Toca:** nuevo Lambda + config Meta webhook

---

# WAVE 4 — Motor de Automatización
> El equivalente a Salesbot + Digital Pipeline de Kommo. Lo que hace que los leads se clasifiquen y avancen solos.

### 15. Reglas de automatización por eventos (Digital Pipeline) — 🟡 V1 HECHA (2026-06-10)
- **Entregado (v1):** tabla pooled Vox-side `connectview-automation-rules` (reglas=config, runs=log sin PII con TTL) + Lambda `connectview-manage-automations` (CRUD, JWT, Admins) + Lambda `connectview-automation-engine` (dual: eventos HTTP con `x-vox-internal` + tick EventBridge `connectview-automation-tick` rate 5 min para `lead_inactive`). Triggers: lead_created (manage-leads + web-form-capture), lead_stage_changed, lead_inactive (dedup por episodio vía `attributes.autoFired_<ruleId>`), wrapup_saved (save-agent-notes). Acciones: send_whatsapp_template (BYO-aware), move_stage (DDB directo + history + propagate CP/SF, anti-loop), schedule_callback (solo tenant legacy), webhook (1 intento). Hook `_shared/automationHook.ts` (no-op sin envs). UI `/automations` (sidebar Crecimiento): lista + 4 plantillas + editor CUANDO/SI/ENTONCES + modal de ejecuciones. **Pendiente:** policy IAM `AutomationsAccess` (la corre el usuario) + e2e; #17 retries de webhook; encadenamiento de reglas (deliberadamente off); lead_created desde CSV de campañas/SF-inbound; callbacks BYO.
- **Estado previo:** el dialer reacciona a campañas; no hay reglas generales.
- **Gap:** Kommo Digital Pipeline: triggers (mensaje recibido, cambio de stage, time-in-stage) → acciones (mandar template, cambiar stage, notificar, crear task, webhook).
- **Build:** tabla `connectview-automation-rules` (trigger + conditions AND/OR + actions[]). Lambda `automation-engine` evaluado en: (a) el tick del dialer, (b) inbound webhook, (c) cambios de wrap-up. Acciones reusan endpoints existentes (`send-whatsapp-template`, `schedule-callback`, `save-agent-notes`, `manage-leads`).
- **Esfuerzo:** XL · **Dependencias:** #4, #14 · **Toca:** nueva tabla + Lambda, hooks en dialer

### 16. Flow builder visual (Salesbot equivalent)
- **Estado:** no hay bot builder.
- **Gap:** Salesbot de Kommo (14 step types). Esto es lo más caro de todo el roadmap.
- **Build (por fases):** **Fase A** — bot lineal con steps básicos (Message, Condition, Collect field, Handoff a agente). **Fase B** — branching visual (react-flow), validation, pause/timer. **Fase C** — custom code / webhook steps. Persistir el flow JSON en `connectview-bots`. Runtime: Lambda `bot-runtime` invocado por inbound webhook. **Considerar:** Amazon Lex como backend del NLP en vez de construir from scratch.
- **Esfuerzo:** XL (cada fase L) · **Dependencias:** #14, #15 · **Toca:** nueva tabla + runtime Lambda, nueva `BotBuilder.tsx` (react-flow)

### 17. Webhooks salientes con retry multi-día
- **Estado:** no hay webhooks out.
- **Gap:** Chattigo reintenta 7 días si tu endpoint está caído. Esencial para integraciones (Salesforce, etc.).
- **Build:** acción `send_webhook` en #15. Cola SQS con DLQ + reintentos exponenciales hasta N días. Tabla `connectview-webhook-deliveries` para visibilidad.
- **Esfuerzo:** M · **Dependencias:** #15 · **Toca:** nuevo Lambda + SQS

### 18. Flows de reactivación / carrito abandonado
- **Estado:** las campañas son one-shot.
- **Gap:** "reactivar bases antiguas desde landing" (dolor explícito) + Chattigo abandoned-cart.
- **Build:** un tipo de automatización (#15) con trigger temporal: "lead sin actividad en X días → mandar template de reactivación". El landing carga la base vía `createCampaign` (ya existe el contrato HTTP — ver `DIALER_FOR_SALESFORCE.md`).
- **Esfuerzo:** S (sobre #15) · **Dependencias:** #15 · **Toca:** config de regla

---

# WAVE 5 — IA en línea (suite de Kommo, con Claude)
> Kommo tiene Rewriter, Suggested Replies, Sentiment, Summary. Vos ya tenés Bedrock+Claude cableado — esto es barato de sumar y se siente premium.

### 19. Rewriter + ajuste de tono — ✅ HECHO (2026-05-29)
- **Build entregado:** botón ✨ IA en el toolbar del composer (`RewriterButton.tsx`) con menú de tonos (profesional/amigable/conciso/suavizar) → `generate-call-summary` mode `rewrite` (branch temprano, sin transcript) → reemplaza el draft. **Verificado:** 3 tonos reescriben bien un borrador brusco.
- **Esfuerzo:** S (real) · **Toca:** `RewriterButton.tsx`, `ChatThreadPanel.tsx`, `generate-call-summary`

### 20. Suggested replies en el composer — ✅ HECHO (2026-05-29)
- **Build entregado:** `SuggestedReplies.tsx` — cuando el último mensaje es del cliente y el agente no empezó a tipear, Claude sugiere 2-3 respuestas (mode `suggest-replies`, ventana de los últimos 6 mensajes). Chips violetas clickeables sobre el composer → llenan el draft. **Verificado:** sugerencias relevantes con placeholders `[precio]` cuando falta el dato.
- **Esfuerzo:** M (real) · **Toca:** `SuggestedReplies.tsx`, `ChatThreadPanel.tsx`, `generate-call-summary`

### 21. Auto-resumen post-conversación
- **Estado:** `generate-call-summary` existe pero es manual.
- **Build:** al cerrar wrap-up, auto-generar el resumen y guardarlo en la fila de wrap-up. Aparece en el historial del cliente sin que el agente lo pida.
- **Esfuerzo:** S · **Dependencias:** #1 · **Toca:** `WrapUpPanel.tsx`, `save-agent-notes`

### 22. Sentiment en vivo destacado + alerta — 🟡 TREND + COACHING POR DURACIÓN HECHOS (2026-06-01)
- **Entregado:** barra de tendencia de sentiment por segmento en `LiveTranscriptPanel` (un tick por segmento, rojo/verde/neutro, cliente vs agente). Aprovecha el `sentiment` por segmento que ya devuelve get-live-transcript. **Falta:** alerta cross-contacto al supervisor en MonitoringPage — requiere agregar sentiment a `get-live-queue` (N llamadas a transcript por contacto activo, con costo) — diferido.
- **Coaching operativo en vivo — ✅ HECHO (2026-06-01):** la sección "Coaching automático · alertas en vivo" en `MonitoringPage` dispara señales con **metas reales y dinámicas**: llamada activa o ACW que supera **1.5× el promedio del día** del equipo (`get-realtime-metrics` → `summary.today.avgHandleTime` / `avgAcw`, calculados con `GetMetricDataV2`; piso 240s/90s y fallback honesto cuando aún no hay datos). Cada señal trae acción (Whisper/Mensaje) que engancha con el monitor en vivo (#9). Cubre el coaching por *duración*; falta el coaching por *sentiment*.
- **Sentiment-coaching al supervisor — ROADMAP (real-time, diferido):** alertar al supervisor cuando un contacto activo cae a NEGATIVE sostenido. Dos caminos:
  - **A (rápido, con costo):** en `get-live-queue`, por cada contacto activo llamar a `get-live-transcript` y exponer el último sentiment. Simple pero son N llamadas por poll → caro y con latencia.
  - **B (correcto a escala) ⭐:** consumir el **stream de Contact Lens real-time** (`RealTimeContactAnalysisSegmentStream` / Kinesis) con un Lambda que escribe el último sentiment por `contactId` en DynamoDB (TTL corto); el supervisor lo lee barato. Requiere habilitar real-time analytics en el contact flow + tabla + Lambda consumer. **Esfuerzo:** M-L · **Toca:** flow Connect (real-time CL), nuevo `contact-lens-realtime-consumer` + tabla, `get-live-queue` (join), `MonitoringPage` (tarjeta de alerta).

- **Estado:** Contact Lens da sentiment; el Coach ya muestra chip "Urgente" en NEGATIVE.
- **Build:** línea de tiempo de sentiment por segmento + alerta al supervisor cuando un contacto cae a NEGATIVE sostenido (engancha con #9).
- **Esfuerzo:** M · **Dependencias:** #9 · **Toca:** `LiveTranscriptPanel.tsx`, `MonitoringPage.tsx`

---

# WAVE 6 — Integraciones & Moats
> Lo que cierra la unificación: Salesforce como destino, y los canales que el cliente ya usa.

### 23. ⭐ Conector Salesforce nativo (bidireccional) — ✅ HECHO (2026-05-29, falta config SF-side)
- **Estado:** nada. El cliente hoy empuja a SF manual.
- **Gap:** Kommo solo tiene Zapier (latency, rompe). Chattigo es middleware. **Native bidireccional gana a ambos.**
- **Build entregado (contra Developer Edition org):**
  - `_shared/salesforceClient.ts`: OAuth 2.0 **Client Credentials Flow** (token cacheado, lee creds de Secrets Manager `connectview/salesforce`) + helpers REST (soql/insert/update).
  - `connectview-salesforce-sync` (Vox→SF, Function URL pública): upsert Lead por phone/email + tipificación→Lead Status (vía `salesforceValue`) + Task "completed" con la gestión. Disparado fire-and-forget desde `WrapUpView` tras guardar el wrap-up.
  - `connectview-salesforce-inbound-webhook` (SF→Vox, Function URL pública + gate `x-vox-token`): recibe el callout del Flow de SF → upsert Customer Profile (reusa `upsertProfileFromCsvContact`). **Verificado end-to-end.**
  - TaxonomyEditor expone el campo `SF Lead Status` por stage. IAM: `SalesforceSecretAccess` en el campaign role.
- **Pendiente (lado SF, lo hace el cliente — ver `SALESFORCE_SETUP.md`):** crear Connected App, guardar el secret en Secrets Manager (activa Vox→SF), y armar el Flow record-triggered → HTTP callout (activa SF→Vox).
- **Esfuerzo:** XL (real) · **Toca:** `_shared/salesforceClient.ts`, 2 Lambdas nuevos, `WrapUpView.tsx`, `TaxonomyEditor.tsx`, `api.ts`, `amplify_outputs.json`, IAM

### 24. Canal Mercado Libre (moat LATAM)
- **Estado:** nada.
- **Gap:** Chattigo lo tiene, Kommo NO. Moat regional puro.
- **Build:** Lambda `mercadolibre-channel` con OAuth ML. Inbound de preguntas/post-venta → contacto en el inbox unificado. Outbound de respuestas.
- **Esfuerzo:** L · **Dependencias:** #1 (inbox unificado) · **Toca:** nuevo Lambda + OAuth ML

### 25. Web form → CRM (reemplaza "Sappier") — ✅ HECHO (2026-05-29)
- **Entregado:** Lambda `connectview-web-form-capture` (Function URL pública, acepta JSON y form-urlencoded) → upsert Customer Profile (reusa `upsertProfileFromCsvContact`, fusiona por teléfono) + snippet embebible `public/embed-form-example.html`. **Verificado end-to-end** en el navegador (form real → perfil "Carla Demo Web" con `web_form`/`lead_source` attrs). Gotcha: NO setear Access-Control-Allow-Origin en el handler (la Function URL ya lo hace → headers duplicados → el browser rechaza).

- **Estado:** nada.
- **Gap:** "formularios nativos en la web que llegan directo al CRM". Lo que el cliente cree que hace Sappier.
- **Build:** form embebible (snippet JS o iframe) que postea a un Lambda `web-form-capture` → crea/actualiza Customer Profile + lead (#4). O usar **WhatsApp Flows (#10)** como el form. Doble vía: web + WhatsApp, mismo destino.
- **Esfuerzo:** M · **Dependencias:** #4 · **Toca:** nuevo Lambda + snippet hosteado

### 26. Appointment scheduling nativo — ✅ HECHO (2026-05-29)
- **Entregado:** tabla `connectview-appointments` + Lambda `connectview-manage-appointment` (CRUD + status) + `AppointmentsPage.tsx` (ruta `/appointments`, nav "Citas") — booking form + lista con estados (scheduled/done/no_show/cancelled). **Verificado** en vivo. GCal sync = futuro.

- **Estado:** hay callbacks; no booking con disponibilidad.
- **Gap:** Kommo tiene scheduling con disponibilidad + Google Cal sync.
- **Build:** tabla `connectview-appointments`, disponibilidad por agente, link de booking público, sync Google Calendar (OAuth). El Coach puede proponer "agendar cita" como CTA.
- **Esfuerzo:** L · **Dependencias:** ninguna · **Toca:** nuevo Lambda + tabla, OAuth Google

---

# WAVE 7 — Hardening Enterprise
> Lo que ambos competidores tienen flojo. Te diferencia en deals grandes.

### 27. SSO empresarial (SAML/OIDC)
- **Gap:** Kommo solo social SSO. Chattigo no documentado. Vox ya está detrás de Cognito → agregar federación SAML/OIDC es nativo en Cognito.
- **Esfuerzo:** M · **Dependencias:** ninguna · **Toca:** `amplify/auth/resource.ts` (+identity providers)

### 28. Permisos granulares (per-stage + per-field) — ✅ HECHO (matriz por capability, 2026-05-29)
- **Entregado:** tabla `connectview-permissions` + Lambda `connectview-manage-permissions` (matriz capability→minRole, con defaults) + hook `usePermissions`/`useCan(cap)` (chequea contra `useRoles.isAtLeast`) + editor en Configuración → Seguridad (`PermissionsEditor.tsx`) + cableado demostrativo en LeadsPage ("Nuevo lead" gated por `manage_leads`). **Verificado** en vivo. Capabilities: campaigns/leads/appointments/taxonomy/catalogs/users/audit/monitor/reports/queue. **Futuro:** per-stage/per-field (más fino) + retrofit de `useCan` en más acciones.

- **Gap:** Kommo: Denied / If-Responsible / Group / Allowed por stage y por campo.
- **Build:** modelo de roles sobre los 3 que ya existen (agent/supervisor/admin). Matriz de permisos por taxonomía-stage y por campo de lead.
- **Esfuerzo:** L · **Dependencias:** #2, #4 · **Toca:** auth context, guards en UI

### 29. Audit log de primera clase — ✅ HECHO (2026-05-29)
- **Entregado:** `AuditLogViewer.tsx` en Configuración → Seguridad — visor filtrable (búsqueda + acción + resultado) sobre `connectview-admin-audit` (reusa `useAdminAudit`) + export CSV. **Verificado** con 21 entradas reales (start-email, update-customer-profile, transfer-contact, etc.).

- **Estado:** `connectview-admin-audit` existe para acciones admin.
- **Build:** expandir a todo evento sensible (wrap-up, envío masivo, cambio de permiso, export) + UI filtrable + export. Ya tenés `adminListAudit`.
- **Esfuerzo:** M · **Dependencias:** ninguna · **Toca:** `admin-list-audit`, audit writes dispersos

### 30. Custom Lists / Catálogos — ✅ HECHO (2026-05-29)
- **Entregado:** tabla `connectview-catalogs` + Lambda `connectview-manage-catalog` (CRUD, Function URL) + editor admin en Configuración → Catálogos (`CatalogEditor.tsx`): tablas de referencia arbitrarias (columnas + filas editables). **Verificado** en vivo (creó/editó "Planes UDEP"). Referenciable a futuro desde leads/bot/guiones.

- **Gap:** Kommo: directorios arbitrarios (productos, SKUs, propiedades) referenciables desde leads y bots.
- **Build:** tabla genérica `connectview-catalogs` (catalogId + items JSON). Referenciable desde custom fields de lead (#4) y desde el bot (#16).
- **Esfuerzo:** M · **Dependencias:** #4 · **Toca:** nueva tabla + Lambda, picker en UI

---

# Secuenciación recomendada (orden de ataque)

```
SPRINT 1 (el pitch killer)         SPRINT 2 (lo que aman de Chattigo)
├─ #1 Tipificación universal        ├─ #14 WhatsApp status webhook (base)
├─ #2 Taxonomía configurable        ├─ #6 Reporte HSM Outbound
├─ #3 Auto-clasificación Coach ⭐    ├─ #5 Los 3 reportes core
└─ #9 Whisper/barge (quick win) ⭐   └─ #7 Exports programados

SPRINT 3 (WhatsApp premium)         SPRINT 4 (automatización)
├─ #12 Countdown ventana (S)        ├─ #15 Reglas por eventos
├─ #10 WhatsApp Flows ⭐            ├─ #17 Webhooks retry
├─ #11 Carousel/List                ├─ #18 Reactivación
└─ #19 Rewriter (S, gratis)         └─ #25 Web form → CRM

SPRINT 5 (unificación final)        SPRINT 6 (moats + enterprise)
├─ #4 Lead pipeline                 ├─ #16 Bot builder (XL, por fases)
├─ #23 Salesforce nativo ⭐         ├─ #24 Mercado Libre
├─ #20 Suggested replies            ├─ #27 SSO
└─ #21 Auto-resumen                 └─ #28/#29/#30 permisos/audit/catálogos
```

**Quick wins para demo inmediata (1-2 días total):** #3 (auto-clasificación), #9 (whisper/barge), #12 (countdown), #19 (rewriter). Los cuatro son alto-impacto-visual y bajo-esfuerzo, y los cuatro **muestran algo que ni Kommo ni Chattigo tienen tan integrado.**

---

# Tabla maestra

| # | Feature | Wave | Esfuerzo | ⭐ |
|---|---|---|---|---|
| 1 | Tipificación universal cross-channel | 1 | M | |
| 2 | Taxonomía configurable | 1 | L | |
| 3 | Auto-clasificación por Coach | 1 | M | ⭐ |
| 4 | Lead pipeline / embudo | 1 | XL | |
| 5 | Los 7 reportes Chattigo | 2 | L→XL | |
| 6 | Reporte HSM Outbound | 2 | L | ⭐ |
| 7 | Exports programados | 2 | M | |
| 8 | Dashboard widgets real-time | 2 | L | |
| 9 | Supervisor whisper/barge | 2 | M | ⭐ |
| 10 | WhatsApp Flows | 3 | L | ⭐ |
| 11 | Carousel + List templates | 3 | M | |
| 12 | Countdown ventana 24/72h | 3 | S | |
| 13 | Quality Rating monitor | 3 | M | |
| 14 | Status webhook WhatsApp | 3 | M | |
| 15 | Reglas automatización | 4 | XL | |
| 16 | Bot builder visual | 4 | XL | |
| 17 | Webhooks retry multi-día | 4 | M | |
| 18 | Flows reactivación | 4 | S | |
| 19 | Rewriter + tono | 5 | S | |
| 20 | Suggested replies | 5 | M | |
| 21 | Auto-resumen post-chat | 5 | S | |
| 22 | Sentiment vivo + alerta | 5 | M | |
| 23 | Salesforce nativo | 6 | XL | ⭐ |
| 24 | Mercado Libre | 6 | L | |
| 25 | Web form → CRM | 6 | M | |
| 26 | Appointment scheduling | 6 | L | |
| 27 | SSO SAML/OIDC | 7 | M | |
| 28 | Permisos granulares | 7 | L | |
| 29 | Audit log first-class | 7 | M | |
| 30 | Custom Lists / Catálogos | 7 | M | |
