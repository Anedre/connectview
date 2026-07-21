# Rework: Orquestación (Workflows) y Asistentes (Bot+Agente IA)

**2026-07-21 · spec para decidir orden de implementación.** Lente: _no meter features
por meter — cada cosa se gana su lugar._ Hoy hay 4 features en 2 familias que se pisan:

- **Conversación** (el cliente habla): **Bot** (guion) · **Agente IA** (IA)
- **Orquestación** (backend, sin conversación): **Automatización** (reflejo instantáneo) · **Journey** (secuencia en el tiempo)

Este doc especifica el merge de cada familia + comparación lado a lado.

---

## Rework A — Asistentes (Bot + Agente IA → uno)

### Lo que descubrí en el código (clave)

**Ya están unificados en el backend.** No son dos sistemas:

- `ai_agent` es un **tipo de NODO** dentro del flujo del bot (`botFlow.ts:550`, `bot-runtime:894`).
- Un "Agente IA" **es un bot**: `AgentePage` lo arma como un bot canónico de un solo nodo IA
  (`start → ai_agent → handoff → stop`) y lo persiste vía `manage-bot` con `kind:"agent"`
  (`AgentePage.tsx:38,507`). Misma tabla, mismo runtime (`bot-runtime`), mismo modelo de nodos.
- La diferencia es SOLO de UI: `/bot` = `FlowBuilderPage` (canvas visual, cualquier flujo, 562 L)
  vs `/agente` = `AgentePage` (formulario guiado de UN agente IA, 1692 L). Y un Bot **ya puede**
  llevar nodos `ai_agent` adentro — la frontera es artificial.

### Propuesta

Una sola sección **"Asistentes"** (o "Bots") con **modos de autoría** sobre el MISMO objeto (bot def):

- **Guion** → el flow builder visual (menús, ramas, nodos).
- **IA** → el formulario guiado de `AgentePage` (arma el bot de 1 nodo IA).
- **Híbrido** → un flow con nodos `ai_agent` (ya soportado).

`/agente` pasa a ser un **quick-start / plantilla** dentro de Asistentes, no un feature aparte.
El usuario elige "¿cómo lo armo?" al crear, no "¿cuál de dos features uso?".

### Qué cambia / migración / riesgo

- **Cambia**: navegación (1 entrada en vez de 2) + pantalla de creación con el selector de modo.
  Los dos editores se quedan como "modos". **Cero cambio de backend** (ya comparten tabla/runtime/def).
- **Migración**: ninguna. Los bots existentes (`kind:"agent"` y flujos) conviven sin tocar datos.
- **Riesgo**: BAJO. **Esfuerzo**: BAJO (consolidación de UI/nav). **Valor**: MEDIO-ALTO (mata un
  split artificial y confuso; el runtime ya está hecho).

---

## Rework B — Orquestación (Journey + Automatización → "Workflows")

### Lo que hay hoy

Comparten los **executors** (las acciones están espejadas a propósito) y el puente `start_journey`.
Pero difieren en TODO lo demás:

|         | Automatización                                               | Journey                                                 |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| Gatillo | **evento** (lead_created, wrap-up, score, tag, cita…) — push | **segmento/manual** — auto-enroll por match, poll 5 min |
| Modelo  | reacción **single-shot**, sin estado, cada vez               | **inscripción** por-lead, con estado, una vez           |
| Pasos   | acciones inmediatas + ramas (conditions)                     | send / **wait** / branch / split / **action**           |
| Motor   | `automation-engine` (event-driven)                           | `journey-runner` (poll 5 min)                           |
| Tabla   | `connectview-automation-rules`                               | `connectview-journey-enrollments`                       |
| Builder | espinazo vertical (`AutomationStepperBuilder`)               | canvas Step-Functions arrastrable                       |

**El solapamiento real**: el nodo `action` de Journey ya hace lo mismo que las acciones de
Automatización. Un Journey de 1 paso sin espera ≡ una Automatización. Dos builders + dos motores +
dos modelos mentales para "cuando pasa algo → haz cosas (quizá en el tiempo)".

### Propuesta

Un solo **"Workflows / Flujos"**: **trigger** (por _evento_ instantáneo **o** por _segmento_ en el
tiempo) → **pasos** (acción / espera / rama). Propiedades, no features:

- Sin esperas → se comporta como la Automatización de hoy (reflejo).
- Con esperas → se comporta como un Journey.
- "cada vez" vs "una vez por lead" = un toggle del trigger.

**Fase 1 (fachada):** un builder + una lista + un modelo mental; detrás, se rutea al motor correcto
(event-engine si no hay esperas, journey-runner si las hay). Bajo riesgo, sin tocar los motores.
**Fase 2 (unificación real):** un solo motor/tabla. Mayor obra.

### Qué cambia / migración / riesgo

- **Cambia**: un builder unificado + una entrada de nav. Los dos motores pueden quedarse detrás de
  la fachada al inicio.
- **Migración**: las reglas de hoy = workflows sin-espera; los journeys = workflows con-espera. Mapea
  1:1 conceptualmente, pero son 2 tablas → hay trabajo de UI para leer/escribir ambas.
- **Riesgo**: MEDIO-ALTO (toca ejecución de mensajería/nurture en vivo). **Esfuerzo**: ALTO
  (2 motores + 2 tablas + 2 builders → 1 fachada, luego 1 motor). **Valor**: ALTO (el mayor golpe al
  "¿cuál uso?").

---

## Comparación lado a lado

|                      | **A · Asistentes** (Bot+Agente)  | **B · Workflows** (Journey+Automatización) |
| -------------------- | -------------------------------- | ------------------------------------------ |
| Backend ya unificado | **Sí** (mismo runtime/tabla/def) | No (2 motores, 2 tablas)                   |
| Esfuerzo             | **Bajo** (UI/nav)                | Alto (fachada → motor único)               |
| Riesgo               | **Bajo**                         | Medio-alto (ejecución en vivo)             |
| Valor (claridad)     | Medio-alto                       | Alto                                       |
| Migración de datos   | Ninguna                          | Mapeo 1:1 pero 2 tablas                    |
| Reversibilidad       | Alta                             | Media                                      |

## Recomendación de orden

1. **Primero A (Asistentes)** — quick win: el backend ya está unificado, es casi todo consolidación de
   UI, riesgo bajo, y limpia un split artificial. Sirve de "prueba de concepto" del criterio.
2. **Después B (Workflows)** — la obra grande, con su propio spec de detalle (modelo de trigger
   unificado, fachada vs motor único, migración de las 2 tablas) antes de tocar código.

Empezar por A demuestra el patrón (unificar UI sobre backend compartido) y baja el riesgo antes de
meterse con B, que sí toca ejecución en vivo.
