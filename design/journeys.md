# Fase 3 — Motor de Journeys / Engagement Studio · Diseño

> La pieza más grande que falta para reemplazar Pardot: **secuencias drip omnicanal
> multi-paso** con esperas y ramas. Hoy `automation-engine` es _trigger → acciones_
> (sin orden ni espera); un journey es _entrar → paso → esperar → ramificar → paso →
> …→ salir_, con estado por-lead. Cierra el Pardot P1 del audit. Ver [[project_roadmap_v2]].

## Qué ya existe y se reutiliza (verificado)

- **Triggers + hook:** `_shared/automationHook.ts` `fireAutomation` + `automation-engine`
  con 5 tipos (`lead_created`, `lead_stage_changed`, `lead_inactive`, `wrapup_saved`,
  `whatsapp_flow_completed`) y un **tick EventBridge rate(5 min)** (`processTick`).
- **Acciones (executors):** `actSendTemplate` (WhatsApp), `actMoveStage`, `actScheduleCallback`
  (encola al dialer/callbacks), `actWebhook`. Se reusan como "tipos de paso".
- **Supresión:** `_shared/suppression.ts` `evaluateSend` — todo paso de envío pasa por acá
  (ya integrado en los senders). Un journey NO re-dispara a un opt-out/convertido.
- **Segmentos (Fase 2 · 2C):** `_shared/leadFilter.ts` + `manage-leads ?segment=` — la
  **entrada** y las **ramas** de un journey se expresan con el mismo predicado.
- **Scoring (Fase 2 · 2A):** `lead.score`/`grade` — ramas por temperatura.
- **Patrón de runner por tick:** `campaign-dialer` / `program-tick` / automation-engine tick.
- **Builder visual:** `FlowBuilder.tsx` (react-flow, Pilar 8) — molde del `JourneyBuilder`.

## Modelo de datos

- **`connectview-journeys`** (PK=tenantId, SK=journeyId) — la DEFINICIÓN:
  `{ name, status: draft|active|paused, entry: {trigger|segmentId|manual}, reenroll: bool,
nodes: JourneyNode[], edges: JourneyEdge[], goal?: {segmentId|stageId}, stats… }`.
  - `JourneyNode` = `{ id, kind, params }`. Kinds: **send** (channel: whatsapp|email + template),
    **wait** (`{days}` ó `{untilRule}`), **branch** (`{rules, match}` → yes/no edges),
    **action** (moveStage | task | webhook | enqueueDialer), **exit**.
  - `JourneyEdge` = `{ from, to, on?: "yes"|"no" }`.
- **`connectview-journey-enrollments`** (PK=journeyId, SK=leadId) — el ESTADO por-lead:
  `{ currentNodeId, status: active|done|exited, enteredAt, nextRunAt, history: [{node, at}] }`.
  GSI `byNextRunAt` (status+nextRunAt) para que el runner tome solo los que "vencieron".

## Motor (`journey-runner`, EventBridge tick)

1. **Enrolar:** al firar un trigger (`fireAutomation`) o al entrar un lead a un segmento
   (evaluado en el tick) o `lead_score_changed` (Fase 2 dispara el trigger) → crea enrollment
   en el nodo de entrada con `nextRunAt=now` (idempotente por (journeyId, leadId); `reenroll`
   controla si un lead ya-salido puede re-entrar).
2. **Avanzar (tick):** el runner toma los enrollments con `nextRunAt <= now` (GSI) y ejecuta
   su nodo actual:
   - **send** → `evaluateSend` (gate supresión) → sender existente → avanza al `to`.
   - **wait `{days}`** → setea `nextRunAt = now + days` y sale (lo retoma el próximo tick que
     venza). **wait `{untilRule}`** → re-evalúa el predicado cada tick hasta cumplirse.
   - **branch** → evalúa `leadFilter` sobre el lead fresco → sigue la edge `yes`/`no`.
   - **action** → reusa el executor del automation-engine.
   - **exit / sin salida** → `status=done`.
3. **Idempotencia:** el avance de un nodo marca `currentNodeId`+`nextRunAt` atómico; el tick
   es reentrante (si dos ticks se solapan, el condicional evita doble-ejecución).
4. **Cadencia:** rate(5 min) (como automation-engine) → resolución de esperas ~5 min, suficiente
   para drips a escala de días/horas.

## Entrada, supresión y observabilidad

- **Entrada:** por trigger, por segmento (2C), por score-threshold (2A), o manual (botón
  "Inscribir en journey" desde Leads/segmento). Gate de supresión en cada send.
- **Observabilidad:** por-journey → inscritos, en-cada-nodo, conversión (llegó al `goal`),
  drop-off; por-lead → su recorrido (timeline). Estrena datos que el reporte de atribución
  (Pilar 2) ya sabe leer.
- **Plantillas semilla:** bienvenida-admisión, reactivación-7d omnicanal, carrito-abandonado,
  nurturing-por-programa — convierten los `automation-engine` de una-espera en journeys reales.

## Plan por sub-fases

- **3A — motor headless: ✅ HECHO (commit `e40b6c3`).** Tablas + `journey-runner` (tick 5min) +
  `_shared/journeys.ts` (`planAdvance` puro) + nodos send/wait/branch/action/exit + gate de
  supresión. CRUD + enrol manual **folded en `manage-leads`** (no Lambda nueva). Verificado E2E:
  entry→send→wait2d→branch(score≥70)→moveStage avanza un lead real en ticks forzados. 5 tests.
- **3B — builder visual: ✅ HECHO.** `JourneyBuilder.tsx` (react-flow, molde del FlowBuilder):
  lienzo con auto-layout L→R, paleta (Enviar/Esperar/Ramificar/Acción/Fin), inspector por-tipo
  (canal+plantilla/asunto, días o condición, reglas+match, tipo de acción, config de Entrada:
  trigger/segmento/manual+reenroll), ramas con salidas **Sí/No**, y validación en vivo. Hook
  `useJourneys` + página `/journeys` (lista + KPIs + activar/pausar) + nav "Journeys". CRUD via
  `manage-leads` (folded — sin backend nuevo). Verificado E2E en Browser 1: crear→guardar→listar
  →reabrir round-trip exacto (posiciones + params + ramas Sí/No persisten).
- **3C — entrada + observabilidad + plantillas: ✅ HECHO (A+B+C+D).**
  - **3C-A auto-enroll:** el `journey-runner` inscribe en cada tick los leads que matchean la
    entrada de cada journey activo — por **segmento** (evalúa el predicado sobre los leads) o por
    trigger **`new_lead`** (marca de agua `lastEnrollAt`, no inscribe histórico). Cap 200/journey,
    idempotente. La inscripción manual ya venía de 3A.
  - **3C-B send REAL:** el efecto `send` ahora envía de verdad — **WhatsApp** por
    `send-whatsapp-template` (mismo transporte que actSendTemplate; el sender ya aplica el gate de
    supresión + ruta BYO) y **email** por SES (SESv2, gate channel-scoped). Sin IAM nueva.
  - **3C-C observabilidad:** `manage-leads ?journeyStats=<id>` (Query por journeyId) → embudo por
    nodo + estado + timeline; `?journeys=1` agrega inscritos por journey. El builder pinta el
    conteo en cada nodo + un panel de Actividad (activos/completados + timeline) + chips en la lista.
  - **3C-D plantillas:** "Nuevo journey" abre un picker con 4 semillas (En blanco / Bienvenida /
    Nutrición drip / Reactivación por score).
  - **Verificado E2E (tenant real):** lead+segmento+journey → tick auto-enrolla (enrolled=1) y
    avanza; email = `send:email:sent:<MessageId SES real>`, WhatsApp hello_world =
    `send:whatsapp:sent` (Meta aceptó a +51953730189); observabilidad muestra el embudo (1 en Fin) +
    timeline; picker abre el builder con el flujo de la plantilla. Datos de prueba limpiados.
  - **Sigue (post-Fase 3):** multi-tenant del runner con assume-role (hoy pooled); `new_lead`
    inline speed-to-lead (hoy hasta 5 min); email tracking pixel = Fase 4.

## Decisiones a confirmar (antes de 3A)

1. **Motor:** ¿`journey-runner` **propio** (recomendado — estado + esperas + ramas son su
   naturaleza; el automation-engine no está hecho para eso) o **extender** automation-engine?
2. **Entrada v1:** ¿arrancamos con **trigger + segmento + manual** (recomendado) y dejamos
   score-threshold para 3C? ¿`reenroll` default **off** (un lead recorre el journey una vez)?
3. **Canales de `send` en v1:** ¿**WhatsApp + email** (los dos senders que ya existen) y SMS
   como follow-up? La voz va como paso **action:enqueueDialer** (reusa el dialer con score).
