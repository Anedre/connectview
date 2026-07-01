# Fase 2 — Primitivas de datos (Scoring · Grading · Segmentos · Reportes)

> Construye lo que el motor de Journeys (Fase 3) y el dialer necesitan para dejar de ser FIFO: **puntaje de comportamiento**, **grado de fit**, **segmentos reutilizables** y **paridad de reportes**. Sigue [[project_roadmap_v2]] / `ROADMAP-V2-5-FASES.md`. Grounding verificado en el código (2026-07-01).

## Terreno (verificado)

- **Lead** = `connectview-leads`, PK=`leadId`, **sin GSIs**, campos: phone, name, email, company, stageId, source, sfLeadId, attributes, history[], montoEstimado, assignedAgent. **No hay `score`/`grade`.**
- **Ledger (Pilar 2):** `summarizeGolpes(history, currentStageId)` → `{ total, byChannel, firstTouchAt, lastTouchAt, converted, touchesToClose, daysToClose }`. `GOLPE_TYPES` = gestion/interaccion/whatsapp_out/whatsapp_in/email_out/call. `appendLeadHistory(leadId, ev)` en `leadSync.ts:~1096` es el **único embudo** por donde pasan los 8 golpes de 6 fuentes.
- **Filtro de leads:** predicado **inline** `passesFilters` en `LeadsPage.tsx:1132` (8 campos: texto, source, agent, stage, montoEstimado, stale, syncedSF, período). NO reutilizable. `manage-leads` no filtra server-side (scan-all + `?programId`).
- **Export:** `scheduled-export-runner` = 8 columnas, **sin filtro** (siempre todo).
- **Dialer:** `computeSlotBudget` reparte por `priority`+`weight` de la CAMPAÑA; dentro del bucket del agente marca **FIFO por `createdAt`** (`campaign-dialer.ts:991`). El `CampaignContact` **no tiene leadId ni score** (vive en `customAttributes` JSON).

---

## F2.1 · Lead scoring (comportamiento) — L

- **Modelo:** puntaje 0-100 **configurable por tenant** (patrón `connectview-suppression-rules`): tabla `connectview-scoring-rules` con pesos por señal + un **DEFAULT sensato** out-of-the-box. Señales (del ledger, sin datos nuevos): #golpes, recencia del último toque, conversión, touchesToClose, canal, source.
- **Recompute (punto único):** enganchar en `appendLeadHistory` (`leadSync.ts:~1116`), después del `UpdateItem` del evento: si `isGolpe(ev)` o `stage_change` → `GetItem` lead → `summarizeGolpes` → `computeScore(summary, rules)` → `UpdateItem { score, grade, scoreInputs, scoreComputedAt }`. **Idempotente, best-effort** (si falla, el golpe ya está guardado), NO dispara nuevos eventos (evita loops).
- **Trigger nuevo:** `lead_score_changed` (cruza umbral) vía `fireAutomation` → alimenta Journeys/automatizaciones.
- **Storage:** campos nuevos en el lead (`score`, `grade`, `scoreInputs` audit, `scoreComputedAt`). Sin tabla nueva de leads.

## F2.2 · Grading (fit demográfico) — M

- **Modelo Pardot-true: DOS ejes independientes.** `score` = comportamiento (F2.1); `grade` A-F = **fit demográfico** (qué tan "ideal" es el lead independiente de su actividad): reglas sobre programa/source/attributes (p.ej. programa objetivo=+, source referral=+, sin email=−). Config en las mismas `scoring-rules` (sección `grading`).
- **Uso combinado:** matriz score×grade (A-caliente = prioridad máxima del dialer; F-frío = nurturing lento). Se computa junto al score en el mismo hook.

## F2.3 · Segmentos dinámicos — M-L

- **Extraer el predicado:** mover la lógica de `passesFilters` a un **predicado serializable** compartido `_shared/leadFilter.ts` (`{field, op, value}[]`) + evaluarlo tanto en el front (vista Leads) como en el back (`manage-leads ?segment=`). Suma los campos nuevos: `score`, `grade`, `#golpes`, stage, programa.
- **Objeto reutilizable:** `connectview-segments` (definición del predicado por tenant) + `manage-segments` CRUD + `SegmentBuilder.tsx` (reusa el UI de filtros de Leads). Consumible como **audiencia** de campaña, **entrada** de journey (Fase 3) y **filtro** de export (F2.3b: `scheduled-export-runner` acepta `segmentId`).

## F2.4 · Dialer priorizando por score — S

- **Estampar** `score`/`grade` en `customAttributes` del contacto al importar la campaña (`csvParser`/create-campaign) desde el lead ya scoreado.
- **Re-rankear** el bucket del agente: en `campaign-dialer.ts:991` reemplazar el sort FIFO por **score DESC → createdAt ASC** (fallback). Cambio mínimo, sin tocar el reparto de slots (Pilar 7 sigue por peso/prioridad de campaña). Cierra el "scoring-auto" que quedó como follow-up del Pilar 7.

## F2.5 · 7 reportes de Chattigo (paridad literal) — M

- Empaquetar las 6 vistas actuales + nombrar/añadir las que faltan ("Resumen de chats", "Detalles", "Sesiones", "Chat CRM") en `ReportsPage`. Mayormente re-packaging de datos existentes (get-hsm-report, conversations, contact history) + 1-2 agregaciones. Se cierra al final de la fase (independiente de scoring).

---

## Decisiones a confirmar (antes de codear)

1. **Modelo de scoring:** ¿reglas **configurables por tenant** con buenos defaults (recomendado — transparente, cada programa pesa distinto) o una **fórmula fija v1** (más rápido, menos flexible)?
2. **Grado A-F:** ¿**fit demográfico independiente** del score (modelo Pardot real: 2 ejes) o **buckets del score** (grade = tramos de score, más simple)?
3. **Alcance del primer slice:** ¿vertical **scoring→Leads→dialer** primero (F2.1+F2.2+F2.4, se ve y prioriza ya) y luego segmentos+reportes (F2.3+F2.5)? ¿o todo junto?

## Plan por sub-fases (propuesto)

- **2A:** scoring + grading (motor + hook en appendLeadHistory + defaults) + mostrar score/grade en la card/detalle de Leads. Verificable: un golpe recomputa el score en vivo.
- **2B:** dialer por score (estampar + re-rank). Verificable: 2 leads de distinto score → el caliente se marca primero.
- **2C:** segmentos (predicado compartido + manage-segments + SegmentBuilder + audiencia en campaña/export).
- **2D:** 7 reportes Chattigo.
- Cada sub-fase: deploy + verificar en vivo (Browser 1) + memoria + commit.
