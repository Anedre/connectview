# Plan de refactor de `CCPContext` (god-context) — por fases, sin romper la telefonía

`src/context/CCPContext.tsx` es la integración **en vivo** con Amazon Connect Streams
(softphone + monitor de supervisor + estado de agente + cola). Auditoría de flujos 2026-07-09:
**1366 → ~1250 líneas** tras la fase 1. Es un "god-context": mezcla concerns, re-renders amplios,
difícil de testear. **NO se reescribe a ciegas** — un bug aquí tumba las llamadas en producción.
Este es el plan seguro y verificable, fase por fase.

## Fase 1 — Extraer tipos ✅ (HECHO)

Los tipos públicos (`ConnectAgentState`, `MonitorSession`, `QuickConnectEntry`) → `context/ccp/types.ts`.
Se borran en runtime → **cero riesgo**. `CCPContext` los re-exporta (consumidores intactos).
`CCPContextValue` queda local por ahora (referencia a los tipos importados).

## Fase 2 — Extraer helpers PUROS (bajo riesgo)

Mover funciones sin estado (mapeos de estado de Streams → `AgentState`, formateo de endpoints de
Quick Connects, derivación de disponibilidad) a `context/ccp/streamsMap.ts`. Son puras → testeables
con unit tests, sin tocar refs ni efectos. Criterio de aceptación: `vitest` verde + softphone sin
cambios de comportamiento.

## Fase 3 — Aislar el concern de MONITOR (supervisor) en un hook

El monitor (`monitorContactRef`, `monitorSession`, `setMonitorState`, `endMonitor`, `refreshMonitor`)
es el concern **más separable**. Extraer a `useMonitorSession()` que `CCPProvider` compone. Es el
primer corte con estado → hacerlo **detrás de banco de pruebas**: un escenario de monitoreo real
(silent → barge → salir) validado en vivo (Browser 1) antes y después.

## Fase 4 — Modelar el ciclo del CONTACTO con XState

El corazón riesgoso: `connecting → connected → onHold → ACW → ended → destroyed` + transfer/conference.
Introducir XState **solo** cuando exista un **harness de llamada de prueba** (un flujo de Connect de
QA + un checklist de: entrante, saliente, hold, mute, transfer a cola, conferencia, DTMF, colgar,
wrap-up). Migrar la máquina de estados a un `contactMachine` y dejar los handlers de Streams como
`send(event)` finos. Aceptación: el checklist pasa idéntico antes/después.

## Fase 5 — Partir el CONTEXT VALUE en sub-contextos

Separar `CCPSoftphoneContext` (llamada activa) de `CCPAgentContext` (estado/disponibilidad) de
`CCPMonitorContext` (supervisor). Reduce re-renders (los consumidores se suscriben solo a lo suyo).
Riesgo = tocar los ~N call-sites de `useCCP()`; hacer con codemod + un `useCCP()` de compat que
delegue, y migrar consumidores incrementalmente.

## Reglas transversales

- Cada fase: **PR chico + `tsc`/`eslint`/`vitest` verdes + prueba en vivo del softphone** (no solo build).
- Nunca dos fases en el mismo PR. Nunca la fase 4/5 sin harness de llamada.
- El **bus de eventos** (`lib/contactEvents.ts`, ya hecho) es el sustituto correcto del acoplamiento:
  el resto de la app reacciona a `contact:ended`/`lead:updated`, no lee `CCPContext` directo.
