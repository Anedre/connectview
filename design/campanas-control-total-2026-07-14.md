# Campañas: control total del admin — diseño

**Fecha:** 2026-07-14 · **Rama:** `feat/campanas-control-total`
**Pedido:** (1) flujo directo sin bienvenida ni música de espera, (2) campañas exclusivas para los agentes asignados, (3) edición de agentes asignados en caliente, (4) ver/terminar llamadas en tiempo real desde el admin, (5) arreglar la falta de concordancia entre paneles del detalle de campaña.

---

## 1. Contexto (hallazgos del código)

- El dialer (`connectview-campaign-dialer`, hand-managed, tick EventBridge 1 min × 4 sub-ticks) marca con `StartOutboundVoiceContact` **sin `QueueId`**; el ruteo lo decide el `campaign.contactFlowId` (típicamente `ARIA-Outbound`), que hace `UpdateContactTargetQueue` → `TransferContactToQueue` a una **cola compartida** → cualquier agente de esa cola contesta. La "exclusividad" actual es solo **pacing** (marca cuando el agente del bucket está idle), no ruteo.
- Por eso "asignar agentes no importa" y por eso los paneles divergen: la fila nace con el **agente del bucket** (`assignedAgentUserId`) y `process-contact-event` la **re-atribuye** al agente real en `CONNECTED_TO_AGENT` (handler.ts:488). "Monitoreo en vivo" (poll de filas, 3 s) muestra la verdad final; el feed de "Actividad en vivo" congela el evento con el nombre del instante en que lo vio (CampaignActivity.tsx:100) y nunca lo corrige.
- **Ya existe** más de lo esperado: `admin-stop-contact` (StopContact, auth Admins/Supervisors), `admin-monitor-contact` (SILENT_MONITOR + BARGE), `assign-campaign-agents` (alta/baja de agentes EN VIVO — el dialer re-lee campaña y agentes en cada tick), `update-campaign` (PATCH parcial), y `get-campaign-stats` ya expone el `connectContactId` de cada llamada viva.
- No hay `_shared/rbac.ts`; el patrón real de auth backend es check inline de grupos Cognito (`PRIVILEGED_GROUPS`) + matriz `manage-permissions` aplicada solo en frontend (`useCan`).
- `provision-contact-flows` ya construye flows canónicos por tenant (ARIA-Inbound/Outbound/Disconnect/Outbound-Smart) y guarda los IDs en `connectview-connections.configJson.contactFlows`.

### Sintaxis de flow verificada (docs AWS)

- `UpdateContactTargetQueue` acepta `{"AgentId": <id|ARN|JSONPath>}` → rutea a la **cola personal del agente** (soportado en flows inbound/transfer; los contactos de `StartOutboundVoiceContact` corren un contact flow normal).
- `UpdateContactEventHooks` `{"EventHooks": {"CustomerQueue": <flow ARN>}}` → reemplaza la música de espera por un queue flow propio. Soportado en todos los tipos de flow.
- `TransferContactToQueue` **NO** se puede usar dentro de un customer queue flow; el overflow ahí se hace con `MessageParticipantIteratively` (Loop prompts) con **interrupción > 20 s** (con < 20 s los contactos caen al branch Error, doc explícita) y el bloque de transferencia propio de queue flows — validar el shape exacto contra `CreateContactFlow` (la API valida el JSON; si no lo acepta, fallback = disculpa breve + Disconnect → `no_answer` → el retry existente redistribuye).

---

## 2. Diseño

### 2.1 Modos de ruteo (campo nuevo `agentRouting`)

| Modo                                      | Ruteo real                                                                                                     | Cuándo usarlo                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `shared` (default, comportamiento de hoy) | Flow → cola compartida; contesta cualquier agente de la cola                                                   | Máxima velocidad de atención            |
| `exclusive`                               | Flow → **cola personal del agente del bucket** (`UpdateContactTargetQueue AgentId`); nadie más puede contestar | Asignación = ruteo; carteras por agente |

Fallback del modo `exclusive` (si el dueño no toma la llamada): **validado contra el flow de muestra de la instancia** — dentro de un customer queue flow NO existe transferencia a otra cola estándar (el "Transfer to queue" de queue flows es solo _callback_; `TransferContactToQueue` no está soportado ahí). El fallback es: silencio interrumpible a los 25 s (`MessageParticipantIteratively` + `InterruptFrequencySeconds:"25"` → branch `MessagesInterrupted`) → disculpa breve → `DisconnectParticipant` → el contacto cae como `no_answer` → retry redistribuye (máquina existente: `maybeScheduleRetry` hace `REMOVE assignedAgentUserId` y el próximo tick reasigna a otro agente). Con auto-accept activo este caso es excepcional (softphone muerto). Aplica igual en `shared`: tope de 25 s de espera muda para el cliente. Futuro: ofrecer callback (`CreateCallbackContact`) en vez de colgar.

Modo `team` (cola dedicada por campaña + routing profiles de los asignados): **fuera de alcance v1**. Ya hay media máquina (`assign-campaign-agents` asocia colas a routing profiles con `queueByUserId`); se documenta como fase futura.

### 2.2 Flujo directo (campo nuevo `directConnect`)

Nuevo contact flow canónico **`ARIA-Outbound-Direct`** (builder en `provision-contact-flows`):

1. Logging + grabación/Contact Lens (igual que ARIA-Outbound — Grabaciones/sentiment dependen de esto).
2. **Sin saludo/bienvenida.**
3. `UpdateContactEventHooks` → CustomerQueue = **`ARIA-Queue-Silent`** (queue flow nuevo: Loop de silencio SSML `<break>` — el cliente no oye música ni "su llamada será transferida"; interrupción ~25 s para el fallback de 2.1).
4. `Compare $.Attributes.ariaRouting`:
   - `"agent"` → `UpdateContactTargetQueue {AgentId: $.Attributes.ariaAgentId}`
   - default → `UpdateContactTargetQueue {QueueId: $.Attributes.ariaQueueId}`; branch Error → cola default del tenant (estática, resuelta al provisionar).
5. `TransferContactToQueue` → Disconnect.

IDs guardados en `configJson.contactFlows.directOutboundId` + `silentQueueFlowId` por tenant. `create/update-campaign` setean `contactFlowId` automáticamente al flow directo cuando `directConnect=true` (el admin no tiene que elegirlo).

**Auto-accept** (campo nuevo `autoAccept`): al iniciar campaña (`control-campaign start`) y al agregar agentes en caliente (`assign-campaign-agents add`) se aplica `UpdateUserPhoneConfig AutoAccept=true` a los asignados; al remover agente / completar / cancelar se revierte (best-effort). La pata del agente conecta sola ⇒ el "directo" se siente directo (queda 1–3 s de silencio inevitable entre el "aló" y el agente; sin auto-accept serían hasta 20 s de timbre).
⚠️ Auto-accept es una config **global del usuario** en Connect (afecta también inbound de otras colas mientras esté activa) — se explica en la UI.
⚠️ Prerequisito operativo: micrófono OK (un agente sin mic + auto-accept = cliente en silencio). Recomendación futura: pre-flight de mic al pasar a Disponible.

### 2.3 Campos nuevos del registro `connectview-campaigns`

```
agentRouting:  "shared" | "exclusive"   (default "shared")
directConnect: boolean                  (default false)
autoAccept:    boolean                  (default false)
```

Editables en caliente vía `update-campaign` FIELD_MAP (el dialer re-lee el registro cada tick — cambio de modo aplica al siguiente marcado (⚠ el wizard ya usa "routingMode" como estado local flow|attribute — por eso el campo backend se llama agentRouting), sin reiniciar campaña).

### 2.4 Dialer (`campaign-dialer`)

En `startOutbound()` agregar atributos por llamada (solo campañas voz):

- `ariaRouting`: `"agent"` si `agentRouting==="exclusive"` y el contacto tiene bucket con dueño; si no `"shared"`.
- `ariaAgentId`: el `assignedAgentUserId` del bucket tal cual (`UpdateContactTargetQueue.AgentId` acepta ID plano o ARN; branch Error del flow → cola compartida).
- `ariaQueueId`: `campaign.campaignQueueId` (cola compartida de la campaña); si falta, el flow cae a la cola default del tenant (estática, horneada al provisionar).
  Guard fail-open: si falta el ARN del agente ⇒ atributos de `shared` (la llamada sale igual).
  El pacing NO cambia: el modo buckets ya marca solo con el dueño idle y sin inFlight.

### 2.5 Control admin en vivo (CampaignDetailPage)

- **Colgar llamada**: en "Monitoreo en vivo", cada llamada viva (con `connectContactId` de `get-campaign-stats`) muestra botón Colgar → `admin-stop-contact` (backend ya existe). Confirmación inline (no window.confirm).
- **Detener todo**: acción nueva `stop-all-calls` en `control-campaign`: lista `dialing/connected` con `connectContactId` y les hace StopContact best-effort. Botón junto a Pausar (pausar + colgar activas = freno de emergencia real; hoy `cancel` no cuelga nada).
- **Escuchar/intervenir**: reusar `admin-monitor-contact` — link al monitoreo existente (no duplicar UI de barge aquí en v1; solo Colgar + acceso).
- **Agentes en caliente**: `AssignedAgentsPanel` editable (agregar/quitar) → `assign-campaign-agents` (existente). Al agregar con `autoAccept` activo se aplica el phone config.
- Gating frontend: `useCan("manage_campaigns")` (Admins) para colgar/detener/editar agentes; backend ya exige Admins/Supervisors por grupos.

### 2.6 Paridad de datos

- `CampaignActivity`: los eventos del feed dejan de ser inmutables — en cada poll, si la fila de un evento `connected` cambió de `agentUsername`, se **re-etiqueta el evento** (match por `rowId`, tipo y ventana de tiempo). Cubre la re-atribución tardía de `CONNECTED_TO_AGENT`.
- Con `routingMode=exclusive` la divergencia desaparece de raíz (bucket = quien contesta).
- Los tiempos del feed son "cuándo lo vio el navegador" (poll 3 s) — se documenta con un tooltip, no se "arregla" (arreglarlo = mover el feed al backend, fuera de alcance).

### 2.7 Multi-tenant / límites conocidos

- `process-contact-event` está clavado a la instancia Novasys (regla EventBridge en `backend.ts:115` + clientes legacy). Para tenants BYO los estados `connected/no_answer/done` NO fluyen — ya es así hoy; los modos nuevos no lo empeoran. Anotado como deuda: regla EventBridge por tenant + reverse-lookup de tenant por instanceArn.
- IAM: `connectview-campaign-lambda-role` necesita `connect:UpdateUserPhoneConfig` (auto-accept) — el rol está lleno (gotcha conocido); si no entra, va en la managed policy de campañas.
- `Loop prompts` con interrupción < 20 s manda contactos al branch Error (doc) → usamos 25 s.
- `CreateContactFlow` valida el JSON del flow → iterar contra la API en el tenant de pruebas antes de generalizar.

## 3. Plan de implementación

1. `provision-contact-flows`: builders `ARIA-Queue-Silent` + `ARIA-Outbound-Direct` + acción `directFlows` (dryRun default) + persistencia de IDs.
2. `create-campaign` / `update-campaign` / `control-campaign` / `assign-campaign-agents`: campos nuevos, auto-set de `contactFlowId`, auto-accept, `stop-all-calls`.
3. `campaign-dialer`: atributos de ruteo.
4. Frontend: selector de modo (wizard + edición), switches flujo directo/auto-accept, AssignedAgentsPanel editable, botones Colgar/Detener todo, fix paridad feed.
5. Deploy lambdas hand-managed (`deploy-lambda.mjs`) + provision de flows en el tenant de pruebas + E2E con agentes reales.

**Fuera de alcance v1** (anotado): modo `team`, pre-flight de micrófono, feed server-side, eventos BYO multi-tenant.

---

## 4. Estado de implementación (2026-07-14, rama `feat/campanas-control-total`)

**HECHO y verificado:**

- Flows provisionados en la instancia de pruebas: `ARIA-Queue-Silent` = `8d9860aa-ed03-4068-8938-d44061f2b400` (CUSTOMER_QUEUE, creado) y `ARIA-Outbound-Direct` = `e07d1e0d-4e83-4750-a4da-863803017b1a` (reutilizado del difunto ARIA-Smart-Test porque la instancia está EN LA CUOTA de flows ~100 — CreateContactFlow tiró LimitExceeded; hay chip de tarea para archivar basura). IDs guardados en `configJson.contactFlows` de `t_3176…` y `default`.
- Lambdas deployadas (hand-managed): provision-contact-flows, campaign-dialer, create-campaign, update-campaign, control-campaign, assign-campaign-agents.
- IAM: `connect:DescribeUser` + `connect:UpdateUserPhoneConfig` agregados al inline `VoxCrmConnectOutbound` de `VoxCrmConnectAccess` (+ managed `connectview-agent-phoneconfig-access` que quedó adjunta al mismo rol). ⚠️ `connectview-campaign-lambda-role` NO los tiene (rol lleno: 10 managed + inline al tope) → el auto-accept NO funciona para campañas legacy (tenantId vacío); todas las campañas recientes llevan tenant real, así que el path vivo está cubierto.
- E2E verificado en browser (QA admin `anedre12345+qaadmin@gmail.com`, creada por CLI): wizard renderiza "Conexión y exclusividad"; al activar exclusivo/directo el selector de flow se reemplaza por el aviso del flow directo; PATCH de la campaña RUNNING `08fc6d16…` persistió `agentRouting=exclusive, directConnect=true` y el backend re-apuntó `contactFlowId` → ARIA-Outbound-Direct. **Esa campaña de pruebas quedó en exclusivo+directo** (a propósito, para que la siguiente llamada de prueba ejercite el flow).
- CI: tsc ✔ · eslint ✔ (1 warning preexistente del feed) · vitest 66/66 ✔ · build ✔.

**Gotcha de verificación**: en el Browser pane sin sesión CCP los diálogos base-ui NO cierran (base-ui espera la transición de salida y las transitions/rAF están muertas — mismo artefacto que congela screenshots). No es bug de la app.

**Pendiente**: prueba con llamadas reales (agentes) del modo exclusivo + conexión directa + auto-accept; merge a master al cierre del batch (un deploy Amplify).
