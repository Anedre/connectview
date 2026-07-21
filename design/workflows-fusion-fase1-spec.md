# Flujos · Fusión de motores — Spec de Fase 1 (fachada)

**2026-07-21.** Fase 0 (UI: un hub "Flujos" + picker de modo) ya está en prod (`5c6441b`).
Esto especifica la **Fase 1**: UN modelo + UN builder que, al guardar, **rutea al motor
correcto** — sin reescribir los motores todavía. Riesgo acotado a la capa de mapeo/persistencia
(no a la ejecución), con un plan de verificación antes de prod.

## El modelo unificado `Workflow`

```ts
interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger:
    | { kind: "event"; type: TriggerType; params?: Record<string, unknown> }   // 9 eventos de Automatización
    | { kind: "segment"; filter: SegmentFilter };                               // match de leads (enrollment de Journey)
  steps: WorkflowStep[];   // secuencia
}
type WorkflowStep =
  | { kind: "action"; type: ActionType; params: Record<string, unknown>; conditions?: RuleCondition[] }
  | { kind: "wait"; ...delay/business/weekday/event }
  | { kind: "branch"; ... };
```

Ambos mundos ya son SUBCONJUNTOS de esto:

- Una **Automatización** = `trigger.kind:"event"` + `steps` que son solo `action` (sin `wait`).
- Un **Journey** = `trigger.kind:"segment"` (o event, ver abajo) + `steps` con `wait`/`branch`.
- Las **acciones son las mismas** (executors espejados a propósito) → el catálogo de `action` es común.

## Ruteo al guardar (la fachada — el corazón de la Fase 1)

`saveWorkflow(w)` decide el motor por la **forma** del workflow:

| Forma                                                   | → Persiste como                                                                            | Motor                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------- |
| `trigger=event` **y** sin `wait`                        | **regla** (`connectview-automation-rules`)                                                 | automation-engine (instantáneo) |
| tiene `wait`/`branch` temporal, **o** `trigger=segment` | **journey def**                                                                            | journey-runner (poll 5min)      |
| `trigger=event` **con** `wait`                          | **split**: una regla `evento → start_journey(J)` + un journey `J` con los pasos con espera | ambos (el puente que ya existe) |

El tercer caso es la clave: "reaccioná a un evento y después esperá" = lo que hoy se arma a mano
con `start_journey`. La fachada lo **auto-arma**: crea el journey de los pasos-con-espera y una regla
que lo dispara. Reversible: al abrir un workflow así, se re-ensambla desde los dos registros.

## El builder unificado

Reusar el **canvas de Journey** (ya hace `action`/`wait`/`branch`) como EL builder de Flujos, +
permitir que el nodo de entrada sea un **evento** (no solo segmento). Sin builder nuevo desde cero.
El picker de modo de la Fase 0 sigue: "Reflejo" arranca sin waits, "Recorrido" con la paleta completa
— pero es el mismo lienzo, y podés agregar un `wait` a un reflejo (se convierte en recorrido solo).

## Lectura (el hub lista ambos como Workflows)

`listWorkflows()` = leer `connectview-automation-rules` (reglas) + los journeys, mapear cada uno al
tipo `Workflow`, y mostrarlos en UNA lista con badge por forma. Editar → cargar por id del motor
correcto → re-ensamblar → abrir el builder.

## Migración

**Ninguna de datos.** Las reglas siguen siendo reglas, los journeys siguen siendo journeys en sus
tablas/motores. `Workflow` es una **vista/adaptador** sobre ambos. Se puede apagar (volver a Fase 0)
sin tocar datos.

## Riesgo y plan de verificación (antes de prod)

- **Riesgo**: el MAPEO (Workflow ↔ regla / journey def). Un mapeo malo = regla/journey malformado que
  el motor ejecuta mal (mensaje duplicado / nurture roto).
- **Mitigación**: la fachada NO cambia los motores — solo produce los MISMOS formatos que hoy generan
  los builders actuales. Tests de ida-y-vuelta (`Workflow → rule → Workflow` y `→ journey →`) que
  garanticen idempotencia del mapeo. Y una prueba E2E con un lead de test por cada forma (evento-instant,
  segmento-timed, evento-con-espera) confirmando 1 sola ejecución antes de habilitarlo.
- **Rollout**: detrás de un flag; el hub Fase 0 sigue siendo el fallback.

## Fase 2 (después, opcional)

Un solo motor/tabla `connectview-workflows` que ejecute el modelo unificado nativamente (con
enrollment por evento Y por segmento), y deprecar los 2 motores. Solo vale la pena si la fachada
demuestra que el modelo unificado cubre todo. NO es requisito para el valor de producto (la Fase 1 ya
da "un solo Flujos, un solo builder").

## Alcance de la Fase 1 (para estimar)

1. `Workflow` type + `toRule/fromRule` + `toJourney/fromJourney` + `splitEventWithWait` (lib pura, testeable).
2. `listWorkflows` (merge de 2 fuentes) + `saveWorkflow` (ruteo) en el hub.
3. Builder: extender el canvas de Journey con entrada-por-evento + guardar vía `saveWorkflow`.
4. Tests de mapeo ida-y-vuelta + E2E por forma.
5. Flag + rollout.

**El código de esto es un build enfocado, no una cola de sesión** — pero ya está diseñado y de-riesgado.
