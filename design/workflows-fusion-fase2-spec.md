# Flujos · Fusión de motores — Fase 2 (motor único) + plan de switchover

**2026-07-21.** La Fase 1 (fachada: un builder + una lista que rutea a los 2
motores, detrás del flag `flujosFusion`) está en master. Esto documenta la
**Fase 2**: UN solo motor/tabla que ejecuta el modelo unificado nativamente.

## Estado actual: BUILD-AHEAD INERTE (hecho)

El motor unificado está **construido, desplegado e INERTE**, validado por dry-run
en AWS real. Nada en vivo cambió.

- **`amplify/functions/_shared/workflowEngine.ts`** — cerebro puro. `matchTrigger`
  (espejo del automation-engine), `shouldEnroll` (idempotencia), y `runFromStart`,
  que reutiliza `planAdvance`: el MISMO motor ejecuta las 3 formas (reflejo termina,
  recorrido descansa, el "split" desaparece). 10 tests.
- **`amplify/functions/workflow-engine/handler.ts`** → Lambda `connectview-workflow-engine`.
  Orquestación completa (match → enroll idempotente → planAdvance → persiste estado).
  **INERTE**: sin Function URL, sin tick de EventBridge, `DRY_RUN=true`, ningún
  producer lo conoce. Los senders reales son un **fail-safe** (aborta si
  `DRY_RUN=false` sin cablearlos).
- **Tablas** `connectview-workflows` (PK tenantId, SK workflowId) +
  `connectview-workflow-enrollments` (PK workflowId, SK leadId). Rol PROPIO
  `connectview-workflow-engine-role` (el `campaign-lambda-role` está lleno).
  Provisión idempotente: `scripts/create-workflow-engine.mjs`.
- **Prueba**: `scripts/dryrun-workflow-engine.mjs` → 6/6 (reflejo termina, recorrido
  inscribe 1, re-disparo NO re-inscribe = anti-doble, todo `[dry]`, limpia solo).

## El switchover (GATEADO — no hacer sin verificar la Fase 1 E2E)

Prerequisito del spec: la fachada (Fase 1) debe demostrarse E2E (activar el flag,
probar las 3 formas con leads de test). Hoy pendiente. Recién entonces:

### Paso 1 · Migración (copia, reversible)

Poblar `connectview-workflows` desde `connectview-automation-rules` (reglas) +
`connectview-journeys` (journeys), con el mapeo de `src/lib/workflows.ts`
(portado a `_shared`). NO borra los originales. Un `scripts/migrate-to-workflows.mjs`.

### Paso 2 · Cablear los senders reales

Refactorizar `runEffect` + los senders (`sendWhatsApp`/`sendEmail`/`enqueueDialer`/…)
del `journey-runner` a `_shared/leadEffects.ts`; el `workflow-engine` los importa y
se quita el fail-safe de `executeEffect`. El journey-runner pasa a importarlos del
mismo módulo (sin cambiar su lógica). Redeploy de ambos.

### Paso 3 · Shadow traffic (comparar sin doble envío)

En `_shared/automationHook.ts`, `fireAutomation()` hace un POST **adicional**
best-effort al `workflow-engine` en dry-run. Con tráfico REAL se comparan sus
traces contra el motor viejo — sin enviar nada por el motor nuevo. Redeploy de los
10 producers (cambio no-op sin el env `WORKFLOW_ENGINE_URL`).

### Paso 4 · Activar el motor nuevo

`create-function-url-config` + tick EventBridge `rate(5 min)` + `DRY_RUN=false`.
Redirigir los producers: `AUTOMATION_ENGINE_URL` → la URL del `workflow-engine`
(un solo punto: `automationHook.ts`). Empezar por 1 producer de bajo volumen.

### Paso 5 · Apagar los 2 motores viejos

Pausar los ticks `connectview-automation-tick` + `connectview-journey-tick`.
Monitorear. Deprecar `automation-engine` + `journey-runner` cuando el nuevo
demuestre paridad.

## Pendiente de paridad (para el switchover)

- `new_lead` con marca de agua (el build-ahead cubre segmento; falta el watermark).
- Scan de `lead_inactive` / `score_threshold` con claim marker (portar el
  `processTick` del automation-engine).
- Horario de silencio (quiet hours) del journey-runner.
- Multi-tenant BYO (assume-role `VoxCrmConnectAccess` — hoy el rol nuevo es pooled).

## Rollback

Cada paso es reversible: la migración es copia (los originales siguen ejecutando),
el shadow es dry-run, y hasta el Paso 4 los motores viejos mandan. Si el nuevo
falla, se revierte el env de los producers y se re-activan los ticks viejos.
