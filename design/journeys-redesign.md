# Journeys — robusto y distintivo (rediseño)

> Objetivo del usuario: "vayamos a journeys y hagamos lo mismo [que Automatizaciones]:
> robusto y distintivo". Cada entorno (Bots / Automatizaciones / Journeys) tiene que
> "verse diferente y ser auténtico".

## Estado real (verificado 2026-07-02, no lo que decía el reporte)

Journeys NO está huérfano: la infra está **viva y corriendo**.
- `connectview-journeys` (tabla) — ACTIVE, 0 items (nadie creó uno aún)
- `connectview-journey-enrollments` (tabla) — ACTIVE
- `connectview-journey-runner` (lambda) — desplegada 2026-07-01, nodejs20.x
- `connectview-journey-tick` (EventBridge) — **rate(5 min), ENABLED**
- Runner ejecuta limpio: `enrolled=0 · due=0 advanced=0` en ~120ms, sin errores.
- CRUD (`saveJourney`/`deleteJourney`/`enrollJourney`) vive en manage-leads, desplegado.
- Motor puro `_shared/journeys.ts` `planAdvance()` con 5 tests verdes.

El reporte del Explore concluyó "no deployado" porque miró `backend.ts` — pero en
este repo casi todo es hand-managed (deploy-lambda.mjs), así que "no está en
backend.ts" ≠ "no existe". La infra real en AWS está completa.

## Los 6 nodos actuales (JourneyBuilder.tsx, ReactFlow)
entry · send (WhatsApp/email) · wait (N días | condicional) · branch (reglas → yes/no)
· action (moveStage/webhook/enqueueDialer) · exit.

## Problema 1 — DISTINTIVIDAD (el foco)

Hoy Journeys = **clon visual de Bots**: mismo ReactFlow horizontal, misma paleta
izq + inspector der, y encima usa `--iris` (color de Bots) en el hero y KPIs.
Tres secciones, dos ya con identidad, Journeys sin la suya:
- **Bots** = grafo/árbol de conversación. Canvas libre ReactFlow. Color **iris**.
- **Automatizaciones** = receta vertical CUÁNDO→SI→ENTONCES, instantánea. Color **gold**.
- **Journeys** = ??? (hoy roba la identidad de Bots).

### Identidad nueva: "Línea de vida" temporal · color VERDE
Journeys pasa a ser una **línea de tiempo de engagement** (paradigma Braze /
Customer.io / Iterable), no un canvas de nodos:
- **Color de sección: `--green`** (nurturing / crecimiento / progreso). Libre, sin
  colisión (bots=iris, autos=gold, leads=cyan). Cambiar hero + KPIs + builder a verde.
- **El TIEMPO es el eje.** El recorrido se lee como un riel de "estaciones".
- **Las esperas NO son un nodo más**: son los **tramos** del riel, rotulados con su
  duración ("⏱ 3 días" / "hasta que responda"). Un journey ES sus esperas.
- **Embudo de gente por estación**: cada estación muestra cuántos leads pasaron / están
  ahí ahora / cayeron (drop-off). Un bot no muestra esto; un journey sí. Los datos ya
  los carga el builder (`.stats` byNode).
- **Ramas** parten el riel en dos sub-rieles (sí/no) que corren en paralelo.
- Layout **custom** (flex/grid dirigido por profundidad temporal), NO ReactFlow — así
  se despega del canvas de bots y gana legibilidad guiada. Se pierde pan/zoom libre,
  que un journey lineal-con-ramas no necesita.

## Problema 2 — ROBUSTEZ del motor (brechas, priorizadas)

El motor corre; estas son mejoras de producto/robustez (no bloqueantes):

CRÍTICO
- **`enqueueDialer` está registrado pero sin implementar** (runner línea ~264). Un
  journey que "llama al lead" hoy es no-op. Implementar contra el dialer/callbacks.
- **Nodo META / GOAL con salida por conversión**: si el lead cumple la meta (p.ej.
  pasó a etapa "Matriculado") sale del journey anticipadamente. Hoy `goal` existe en
  el tipo pero no corta el avance. Alto valor para medир conversión del recorrido.
- **Idempotencia del send**: que un tick redelivered no mande 2 veces (dedupe por
  enrollment+nodeId+intento).

ALTO
- **Quiet hours / horario en sends** (no mandar de madrugada) — reutilizar la misma
  pieza que Automatizaciones.
- **Nodo A/B split** (reparte el enrollment en 2+ ramas por %). Clásico de journeys.
- **Reenroll con tope / cooldown** (hoy `reenroll` es booleano; agregar "no re-entrar
  en N días").

MEDIO
- **Más acciones de nodo**: apply_tag / apply_attribute / notify_agent (ya existen en
  Automatizaciones — unificar el catálogo de efectos).
- **Métrica de embudo del journey** (entrados → por estación → metareach %), visible en
  el builder y en la card del listado.

## Puente con Automatizaciones (lo dejado pendiente allá)
La acción **"iniciar Journey"** en Automatizaciones cierra el círculo: una regla puntual
mete al lead en un recorrido. Se implementa DESPUÉS de esta pasada de Journeys.

## Plan de ejecución
1. Doc + memoria (esto). ✅
2. **Distintividad**: reescribir JourneyBuilder a "riel de estaciones temporal" custom
   (verde), esperas como tramos, embudo por estación, ramas en sub-rieles. Repintar
   JourneysPage a verde (hero/KPIs/cards).
3. **Robustez**: implementar enqueueDialer + nodo meta/goal-exit + idempotencia send +
   quiet hours + (A/B split si entra en scope). Redeploy journey-runner (hand-managed).
4. Unificar catálogo de efectos de nodo con Automatizaciones (tag/attribute/notify).
5. QA en vivo: crear un journey, inscribir +51953730189, ver avance en logs.
6. Puente: acción "iniciar Journey" en Automatizaciones.

Color de sección Journeys = **--green**. Test WhatsApp SIEMPRE a +51953730189.
Redeploy runner tras tocar handler o _shared/journeys.ts (bundlea el motor puro).
