# Pilar 7 — Orquestación del dialer (no FIFO) · Diseño técnico

> Cubre **R7**: correr campañas simultáneas con **prioridad + peso + pacing** y decidir a quién marcar primero, en vez de FIFO por orden de creación. Ver `REQUERIMIENTOS-UDEP-MEJORAS.md` (Pilar 7). Esfuerzo L.

## 0. Qué pidió el cliente

Correr campañas **a la vez** con un peso (ej. **80% contactados / 20% gestionados**) y que el dialer decida a quién marcar primero. Hoy es un hack: el orden lo da la **fecha de creación**.

## 1. Estado actual (mapeo — `campaign-dialer/handler.ts`)

- **Trigger:** EventBridge rate(1min) → un Lambda → `dialCycle()` corre ~4 sub-ticks (15s) dentro de una invocación de ~50s.
- **Multi-campaña:** `listRunningCampaigns()` (index `status-createdAt`) → **orden de creación (más vieja primero)**; se procesan **EN SERIE** (la vieja agota su cupo, la siguiente espera). **Sin prioridad/peso.**
- **Concurrencia:** cada campaña tiene `concurrency` como tope **independiente** (3×10 = hasta 30, sin tope global). Se cuenta por contactos en estado `dialing` (`countDialingForCampaign`).
- **Pacing:** estático. Solo `dialMode:"power"` = ×2. **Sin pacing adaptativo, sin tope de abandono.**
- **Orden de contactos:** FIFO por `createdAt` (solo en bucket-mode; legacy sin orden).
- **Stop:** `maybeCompleteCampaign` → COMPLETED cuando `pending+dialing+connected == 0`. **Sin metas/budget.**
- **Canales:** voz (`StartOutboundVoiceContact`) + WhatsApp (plantillas). Email no.
- **Multi-tenant:** `getTenantConnect(campaign.tenantId)` por campaña (ya funciona).
- **Ya existe:** `PacingControlCard` (slider de concurrencia en vivo) + acción `set-concurrency` en `control-campaign` (tuning sin pausar) → base a reusar.

## 2. Decisiones tomadas ✅ (2026-06-30, confirmadas con el usuario)

1. **Peso = % del pool, prioridad desempata.** El `weight` define el % del pool global (el 80/20); la `priority` decide quién se sirve primero cuando el pool no alcanza (la de mayor prioridad nunca se queda sin cupo).
2. **Pacing progresivo por agentes (seguro).** El pool global ≈ agentes disponibles; el supervisor pone/ajusta el tope. Sin marcación predictiva (cero riesgo de abandono/compliance para el piloto). Predictivo = follow-up opt-in.
3. **Metas por campaña → auto-completar.** El supervisor pone meta = N **contactados** (conectados con agente) o N **conversiones**; al alcanzarla la campaña pasa a COMPLETED sola.
4. (Marco) **Blend manual primero**; el scoring-auto (priorizar por lead score, del `zapier-pardot-analysis.md` P2) queda como follow-up.

## 3. Modelo

### Schema `connectview-campaigns` +=

- `priority?: number` (1–10, default 5) — mayor = se sirve primero.
- `weight?: number` (default 1) — peso relativo para el % del pool.
- `goalType?: "none" | "contacts" | "conversions"` (default none).
- `goalTarget?: number`.
- `conversionsCount?: number` — contador para la meta de conversiones (lo incrementa el wrap-up de cierre de un contacto de campaña).

### Pool global (por tenant)

- `connections.configJson.orchestration.maxConcurrentDials` (supervisor). **Default si no está: suma de las `concurrency` activas** (= comportamiento de hoy, sin regresión). Cuando el supervisor lo baja a ~Nº de agentes → aparece la contención y el 80/20 tiene efecto. La UI sugiere el valor = agentes disponibles ("progresivo").

### Orquestación en `dialCycle` (el corazón)

Por cada **grupo de tenant** de campañas activas (en ventana):

1. `globalCap` = orchestration.maxConcurrentDials || Σ concurrency.
2. `inFlight` = Σ dialing del grupo; `globalSlots = max(0, globalCap − inFlight)`.
3. Orden por **priority DESC**.
4. Reparto por **peso** en orden de prioridad: `alloc_i = min(headroom_i, round(slotsRestantes × weight_i / ΣpesoRestante))`; descontar. Si los slots se agotan, las de menor prioridad reciben 0 ese ciclo. `headroom_i = concurrency_i − dialing_i`.
5. Cada campaña marca hasta `alloc_i` (se pasa `slotOverride` a `processCampaignWithBuckets`/`Legacy`).

### Metas (en `maybeCompleteCampaign` o antes de marcar)

- `contacts`: COMPLETED cuando `connectedCount >= goalTarget`.
- `conversions`: COMPLETED cuando `conversionsCount >= goalTarget`.
- Auto-completa (status → COMPLETED, no se marca más).

## 4. Control + API

- `control-campaign` += `set-blend` `{priority, weight}` (en vivo, sin pausar) — espejo de `set-concurrency`.
- Pool global: `set-pool` `{poolMax}` (tenant-level) → escribe `orchestration.maxConcurrentDials` en connections.
- `create-campaign`/`update-campaign` += priority/weight/goalType/goalTarget.
- `get-campaign-stats` += devuelve priority/weight/goal/conversionsCount + `allocated` (slots asignados este ciclo, para el % del pool) + ETA.

## 5. UI — blend del supervisor

- **CampaignCreatePage**: en "Personalización avanzada" → sub-sección Orquestación: prioridad (1–10), peso, meta (tipo + target).
- **CampaignDetailPage**: `OrchestrationCard` — prioridad/peso (sliders `set-blend`), % asignado del pool, avance de meta + ETA.
- **Tablero blend** (`CampaignsPage` o ruta nueva): fila por campaña activa con sliders de peso/prioridad + % asignado + control del pool global (sugerido = agentes) + ETA. Reusa el patrón de `PacingControlCard` + poll de `get-campaign-stats`.
- ETA = contactos restantes / ritmo reciente.

## 6. Plan por fases

- **Fase A (núcleo):** schema + orquestación en `dialCycle` (pool + peso + prioridad) + meta `contacts` + `set-blend`/`set-pool` + UI blend mínima (OrchestrationCard + pool). Verificable: 2 campañas activas con pesos 80/20 → el dialer reparte los slots 80/20; bajar el pool → contención visible.
- **Fase B:** meta `conversions` (hook wrap-up→campaña) + ETA/proyección + tablero blend completo.
- **Follow-up:** pacing predictivo opt-in (tope de abandono); scoring-auto (prioridad por lead score, del zapier-pardot doc P2).

---

> **🎯 PILAR 7 · FASE A — HECHA (commit `0479534`) + FASE B blend (commit `2ef9605`).** Orquestación (pool/peso/prioridad) + meta `contacts` + `set-blend`/`set-pool` + `CampaignOrchestrationCard` + `CampaignBlendBoard`. Verificado en vivo (math 80/20, set-pool E2E, tablero).

> **🎯 PILAR 7 · META DE CONVERSIONES — HECHA y verificada en vivo (2026-06-30, LE3).** Cierra el último hueco de la Fase B: el `goalReached("conversions")` del dialer ya existía pero NADA incrementaba `conversionsCount`. Ahora `save-agent-notes`, al guardar un wrap-up con `valoracion:"cierre"`, llama `incrementCampaignConversion(contactId)`: busca la fila de campaña por `connectContactId` (GSI `connectContactId-index`, ya existía) y suma 1 al `conversionsCount` de su campaña, **idempotente por contacto** (marca `convertedCounted` en la fila vía update condicional → re-guardar no recuenta). Best-effort (no rompe el save) + no-op si el contacto no es de campaña. El front (`CampaignOrchestrationCard` selector de meta + avance `conversionsCount/goalTarget`) ya estaba; se corrigió el type `UpdateCampaignInput` (le faltaban `goalType/goalTarget/priority/weight` que `update-campaign` ya persistía → build rojo). **Verificado (Browser 1 + DDB):** campaña de prueba meta=conversions/target=1 → `save-agent-notes valoracion:"cierre"` → `conversionsCount` 0→1 + `convertedCounted:true`; re-POST → sigue en 1 (idempotente). Datos de prueba limpiados. 🔑 El contador vive en la tabla pooled del tenant (para `t_3176` = Novasys-pooled); el `dynamo` que resuelve `save-agent-notes` es el del tenant (mismo que el dialer) → mismas tablas/perms.
