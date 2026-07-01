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

- **3A — motor headless:** tablas + `journey-runner` (tick) + enrolamiento por trigger +
  nodos send/wait/branch/action/exit + gate de supresión. Verificable: un journey seed
  ("enviar → esperar 2d → si no respondió, encolar dialer → si respondió, mover etapa")
  avanza un lead real end-to-end en ticks forzados. **(XL)**
- **3B — builder visual:** `JourneyBuilder` (react-flow) + CRUD `manage-journeys` (o folded)
  - paleta de nodos + validación. **(L)**
- **3C — entrada + observabilidad + plantillas:** enrolamiento por segmento/score/manual +
  panel de embudo del journey + timeline por-lead + journeys semilla. **(M)**

## Decisiones a confirmar (antes de 3A)

1. **Motor:** ¿`journey-runner` **propio** (recomendado — estado + esperas + ramas son su
   naturaleza; el automation-engine no está hecho para eso) o **extender** automation-engine?
2. **Entrada v1:** ¿arrancamos con **trigger + segmento + manual** (recomendado) y dejamos
   score-threshold para 3C? ¿`reenroll` default **off** (un lead recorre el journey una vez)?
3. **Canales de `send` en v1:** ¿**WhatsApp + email** (los dos senders que ya existen) y SMS
   como follow-up? La voz va como paso **action:enqueueDialer** (reusa el dialer con score).
