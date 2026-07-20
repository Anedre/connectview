# Auditoría de bugs sistémicos — concurrencia, idempotencia y truncamiento

**Fecha:** 2026-07-20 · **Disparador:** el bug del loop de cierre por inactividad (fix `5709a19`) — se auditó todo `amplify/functions/` buscando la misma familia y clases vecinas, con 4 lentes en paralelo. Cada hallazgo fue citado con archivo:línea por el auditor; los P0 fueron re-verificados a mano.

**Veredicto general:** el patrón *exacto* del reaper (escritura condicional invalidada por el propio flujo) **no se repite** — el resto de escrituras condicionales del backend están bien construidas (CAS con literales, claims atómicos, ranks monótonos). Pero la auditoría encontró **~30 hallazgos** de clases vecinas. Lo crítico se concentra en el **camino de WhatsApp** (duplicados visibles al cliente y bot que no atiende) y en **efectos-antes-de-marca** en los crons.

---

## P0 — Lo que el cliente VE (arreglar ya)

| # | Bug | Dónde | Efecto visible |
|---|-----|-------|----------------|
| 1 | **Inbound de WhatsApp sin dedup por `wamid`** | `whatsapp-meta-webhook/handler.ts:743-764` | Meta reintenta si el handler tarda (scan + assume-role + LLM por mensaje) → el cliente recibe **doble respuesta del bot**, mensaje duplicado en el inbox, automatización disparada 2×. |
| 2 | **`automation-engine`: efecto ANTES del marcador `autoFired`** | `automation-engine/handler.ts:1426-1432` | El patrón del reaper: si el marcador no persiste, el próximo tick **re-envía el WhatsApp/email/llamada cada hora**. `lead_inactive` con acciones que no tocan `updatedAt` = re-envío garantizado. |
| 3 | **`pickBotId`: scan sin paginar de la tabla de bots** | `whatsapp-meta-webhook/handler.ts:200` | La tabla co-almacena logs `conv#`; con tráfico el bot publicado puede caer fuera de la 1ª página → `""` → **la conversación va a agente humano en vez del Agente IA**, sin error. |
| 4 | **Dedup de leads: carrera scan→put** | `_shared/leadSync.ts:853-911` (via `meta-lead-ads-webhook:188-199`) | Dos entregas del mismo leadgen (retry de Meta o doble ruta) → **lead duplicado + doble HSM de bienvenida** (speed-to-lead 2×). |
| 5 | **`journey-runner`: send antes de persistir `enr.sent`** | `journey-runner/handler.ts:886-907` | Si `markEnrollment` falla tras el envío → **doble mensaje del journey** al lead en el próximo tick. |
| 6 | **Import masivo: contadores mienten** | `_shared/leadSync.ts:1161-1185` | `created++` antes del write; el PutItem tiene `.catch(() => {})`. El wizard dice "N importados" aunque persistan menos; con deadline, filas contadas doble (creadas Y dropped). **Toca el import de bases UDEP.** |

## P1 — Integridad de datos y compliance

| # | Bug | Dónde | Efecto |
|---|-----|-------|--------|
| 7 | **Conversaciones: RMW de item completo sin versión** | `_shared/conversations.ts:250-257` y todos los mutadores | 2 webhooks concurrentes (2 mensajes seguidos, inbound × respuesta del bot, recibo × inbound) → last-writer-wins → **mensaje que desaparece del chat**, `unread` mal, `assignee` revertido. |
| 8 | **Opt-out confirma sin verificar persistencia** | `whatsapp-meta-webhook:339-370` (helper `suppression.ts:649-651`) | STOP falla en silencio → cliente recibe "Listo ✅ no volverás a recibir mensajes" pero **sigue recibiendo campañas** (compliance Meta). |
| 9 | **Webhook por lotes: 1 error descarta el resto con 200** | `whatsapp-meta-webhook:738-778` | Un throttle a mitad de lote → statuses/mensajes restantes perdidos; **HSM queda "sent" para siempre**, número inválido sin cuarentena. Igual en `meta-lead-ads-webhook:398` (leads perdidos). |
| 10 | **STOP/ALTA e IG/Messenger sin dedup** | `whatsapp-meta-webhook:329-391`, `meta-messaging-webhook:207-281` | Retry → doble confirmación al cliente; comentario redelivered **resetea `dmSent`** → doble private-reply. |
| 11 | **`upsertVoxLead` pisa el history** | `leadSync.ts:859-910` | Golpe agregado durante la ventana scan→put se pierde → timeline/score/rollup SF incompletos. |
| 12 | **Casos: RMW sin condición** | `_shared/cases.ts:361-476` | Dos usuarios sobre el mismo caso → cambio de uno **se revierte** (asignación perdida, historia perdida). |
| 13 | **Export programado: email antes de persistir** | `scheduled-export-runner:264-267` | Muerte entre SendEmail y persist → **reporte duplicado** a destinatarios. |
| 14 | **`webhook-dispatcher`: POST antes de record, sin claim** | `webhook-dispatcher:223-224` | SQS at-least-once → **doble POST al endpoint del cliente**. |

## P2 — Truncamientos silenciosos (duelen con volumen)

- **Campañas**: `get-campaign-stats:147` (COUNT trunca a 5 páginas → dashboard suma de menos); `control-campaign:75` (lanzar >~20k contactos solo procesa 20 páginas); `clone-campaign:40` (clon incompleto); `get-campaign-contacts:85` (sin paginación hacia el caller, tope `limit`).
- **Destructivo**: `assign-campaign-agents:116` — chequeo "¿la cola sigue en uso?" truncado a 10 páginas → puede **desasociar una cola en uso** y romper ruteo.
- **Reportes**: `get-churn-risk:55` y `get-agent-leaderboard:71` (FilterExpression + tope de páginas = suman de menos); `get-cost-report:275` (filtro de fecha client-side, escanea todo y trunca a 50MB).
- **Auditoría**: `audit-log:96` y `admin-list-audit:21` — muestran un subconjunto **arbitrario** (orden de hash), no los eventos más recientes. Impacto de seguridad/compliance.
- **Config de 1 página** (baja hasta que crezcan): `manage-catalog:96`, `manage-knowledge:85`, `manage-taxonomy:182`, `manage-programs:231/276`, `bot-runtime:210`, `get-live-queue:793` (tope 300 contactos), `list-campaigns:18` (10 páginas).

## P3 — Contadores/estructural (menor)

- `callback-dispatcher:229` (`dispatched` cuenta fallos), `agent-channel-adapter:244-262` (`sentCount` cuenta fallos), `hsmStatus.ts:119-120` (error transitorio pierde `isPermanentFailure` → salta cuarentena), `updateCampaignCounters` (ADD puede inflarse en reentrega), SF Task sin idempotency key (doble Task en re-submit), `suppression.ts:470-496` (worker pool sin catch por ítem → preview de audiencia se cae entero por 1 teléfono), `get-contact-history:192` (Promise.all sin catch interno), journey `markEnrollment` clobber de `history`/`sent` (journey-runner:918-957), `lead_inactive` mide con `updatedAt` que el propio sistema toca (automation-engine:1407).
- **Estructural**: ningún cron tiene reserved-concurrency → ticks solapados posibles (habilita los dobles de P0-2/5); `Promise.allSettled` no se usa en todo el backend; la ventana de dedup de HSM (`send-whatsapp-template:252-284`) es check-before-record sobre un GSI eventualmente consistente → no frena dobles concurrentes.

## Lo que está BIEN (patrones de referencia para los fixes)

`callback-dispatcher` (claim condicional ANTES del efecto + `ClientToken` idempotente de Connect), `campaign-dialer` voz (claim atómico + reaper de filas colgadas), `hsmStatus.updateHsmStatus` (rank monótono condicional), `process-contact-event` (todo condicional), `appendLeadHistory` (`list_append` atómico), `upsertCustomerProfileFromCsv` (contadores sobre el resultado confirmado). **Los fixes deben copiar estos patrones.**

## Plan propuesto

1. **Fase A (P0)**: dedup por `wamid`/`leadgen_id` (tabla o atributo condicional), invertir efecto↔marca en automation-engine y journey-runner (claim del marcador ANTES, patrón callback-dispatcher), paginar `pickBotId`, contadores honestos del import.
2. **Fase B (P1)**: versión/`ConditionExpression` en `put()` de conversaciones (optimistic locking + retry), gate del opt-out sobre el retorno, try/catch por ítem en los webhooks por lotes, claim en webhook-dispatcher y scheduled-export.
3. **Fase C (P2)**: paginación completa en los 12 endpoints listados (patrón `do…while LastEvaluatedKey` del dialer).
4. **Fase D (P3)**: contadores, allSettled, reserved-concurrency en crons.
