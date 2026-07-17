# Diseño técnico — Primitiva `Case` / Ticket (B)

**Producto:** ARIA by Novasys (Vox/Connectview) · **Fecha:** 2026-07-16
**Contexto:** el eje C del [roadmap de integraciones](integraciones-roadmap.md) (Zendesk/Jira) + las features P1/P2/P5. Se apoya en el [Connector Framework](connector-framework.md) (A) para el sync externo.
**Tesis:** ARIA no tiene una unidad de trabajo con SLA. Tiene _conversaciones_ (Pilar 6), _leads_ (embudo) y _callbacks/tasks_, pero nada con prioridad, cola, estado de resolución y reloj de SLA. Esa primitiva —el `Case`— es el gap estructural que habilita todo el eje C y varias features de paridad.

## Decisiones tomadas

1. **Primitiva propia (`connectview-cases`), no deep-link.** Objeto canónico agnóstico, igual que se hizo con leads (objeto propio + sync a SF). El [deep-link a Amazon Connect Cases](../src/components/workspace/CasesPanel.tsx) actual se mantiene como opción para quien ya lo use, pero NO es el backend del eje Zendesk/Jira.
2. **Incremental.** MVP (objeto + estados + SLA + UI) → eventos/reaper → CSAT → conectores Zendesk/Jira. Cada fase entrega valor sola.
3. **Estados calcados de Zendesk** (`new/open/pending/on_hold/solved/closed`) a propósito: hacen el mapeo Zendesk casi 1:1 y son un modelo de soporte probado.

---

## 1. Qué es un `Case` y qué NO es

- **Un `Case` NO reemplaza el inbox.** El inbox (Pilar 6, [`conversations.ts`](../amplify/functions/_shared/conversations.ts)) sigue siendo el hilo por (canal, remitente). El `Case` es una **capa de trabajo con SLA** que _referencia_ 1+ conversaciones y un lead. No todo mensaje abre un caso.
- **Un `Case` es la unidad que se rutea, se prioriza, se mide y se escala.** Es lo que Zendesk llama ticket y Jira issue.
- **Se abre** de 4 formas: manual (el agente lo crea desde una conversación), automático (regla: `wantsHuman` detecta escalamiento — ya existe en [`conversations.ts:91`](../amplify/functions/_shared/conversations.ts)), desde journeys/automatizaciones (acción `createCase`), o inbound (un ticket creado en Zendesk/Jira entra por el `CaseConnector`).

Relación con lo existente:

```
Lead (embudo, connectview-leads) ──┐
Conversación (inbox, Pilar 6) ─────┼──► Case (connectview-cases)  ──sync──► Zendesk ticket / Jira issue
Contact de Connect (contactId) ────┘        SLA · cola · prioridad · resolución · CSAT
```

---

## 2. El modelo `Case`

```ts
// amplify/functions/_shared/cases.ts   (espejo de conversations.ts)
export type CaseStatus = "new" | "open" | "pending" | "on_hold" | "solved" | "closed";
export type CasePriority = "low" | "normal" | "high" | "urgent";

export interface Case {
  caseId: string; // uuid
  tenantId: string;
  number: number; // correlativo legible por tenant (#1042), como Zendesk/Jira
  subject: string;
  description?: string;
  status: CaseStatus;
  priority: CasePriority;

  // Ruteo / propiedad (reusa el patrón ownerAgentId de conversations.ts:174)
  queueId?: string;
  assigneeAgentId?: string; // EMAIL/id del agente dueño
  assigneeAgentName?: string;

  // Vínculos con lo existente
  leadId?: string;
  phone?: string;
  conversationIds?: string[]; // hilos del inbox que pertenecen al caso
  contactId?: string; // Connect (para el deep-link/telefonía)
  channel?: string; // origen (voice/whatsapp/email/…)
  programId?: string; // scope por programa (Pilar 1) → RBAC + reportes

  // SLA (ver §3)
  sla?: CaseSla;

  // Trazabilidad (append-only, como el history del lead)
  history?: CaseEvent[];

  // Sync externo (eje C) — mismo ExternalRef del connector framework (doc A §2)
  externalRefs?: { connectorId: string; objectType: string; id: string }[];

  // CSAT (P2)
  csat?: { score?: number; comment?: string; sentAt?: string; respondedAt?: string };

  createdAt: string;
  updatedAt: string;
  closedReason?: "solved" | "duplicate" | "not_reproducible" | "manual";
}

export interface CaseEvent {
  ts: string;
  type:
    | "created"
    | "status_change"
    | "assign"
    | "note"
    | "sla_breach"
    | "csat"
    | "linked"
    | "external_sync";
  from?: string;
  to?: string; // status_change / assign
  agent?: string;
  note?: string;
  meta?: Record<string, string>;
}
```

**Correlativo `number`:** contador atómico por tenant (item `counter#cases` en la tabla, `UpdateItem ... ADD n :1 RETURN_VALUES UPDATED_NEW`). Legible y esperado por los usuarios de soporte.

---

## 3. SLA con reloj (formaliza lo que hoy es heurística de front)

Hoy el SLA vive solo en el **frontend** como heurística de primera respuesta ([`src/components/inbox/sla.ts`](../src/components/inbox/sla.ts)): `unread>0` + minutos desde `lastMessageAt`, umbrales 5/15 min. El `Case` lo formaliza en el **backend** con dos relojes y políticas configurables:

```ts
export interface CaseSla {
  policyId?: string;
  firstResponseDueAt?: string; // creado → agente responde
  resolutionDueAt?: string; // creado → estado solved
  firstRespondedAt?: string;
  resolvedAt?: string;
  breached?: { firstResponse?: boolean; resolution?: boolean };
  pausedMs?: number; // acumulado en pending/on_hold (reloj pausado)
  clockStartedAt?: string; // para recalcular al reanudar
}

/** Política por tenant + prioridad (connectview-connections.cases.slaPolicies). */
export interface SlaPolicy {
  id: string;
  priority: CasePriority;
  firstResponseMins: number; // p.ej. urgent=15, high=60, normal=240, low=480
  resolutionMins: number;
  businessHours?: boolean; // v2: calendario laboral; MVP = 24/7
}
```

- **Pausa del reloj:** en `pending` (esperando al cliente) y `on_hold` (esperando a un tercero) el reloj de resolución se pausa — se acumula en `pausedMs`. Es el comportamiento estándar de Zendesk/JSM.
- **Breach:** un **reaper** (cron EventBridge, calcado de [`scanOpenConversations`](../amplify/functions/_shared/conversations.ts:575) + el reaper de inactividad) escanea casos abiertos, detecta `dueAt` vencido, marca `breached` y emite `case_sla_breach` al bus.
- **MVP simplificación:** SLA 24/7 (sin calendario laboral). `businessHours` es v2.

---

## 4. Estados y transiciones (workflow ligero — feature P5)

No es el workflow engine de Jira (sin post-functions/validadores custom). Es una máquina de estados fija con guardas simples:

```
        ┌─────────────── reopen (inbound del cliente) ──────────────┐
        ▼                                                            │
new ──► open ──► pending ⇄ on_hold ──► solved ──► closed ────────────┘
  │       └──────────────────────────────► solved (resuelto directo)
  └── assign → open
```

- `new` → sin asignar (recién creado / recién llegado de cola).
- `open` → asignado y en trabajo (arranca reloj de primera respuesta al primer `out`).
- `pending` → esperando al cliente (pausa reloj de resolución).
- `on_hold` → esperando a un tercero.
- `solved` → resuelto (dispara CSAT + `case_resolved`); reabrible por inbound del cliente (mismo patrón que `closeConversation`/`reopenedAt`).
- `closed` → terminal (tras N días en solved, por el reaper).

Cada transición escribe un `CaseEvent` (`status_change`, from→to). Guardas: p.ej. no `solved` sin `assigneeAgentId`. Configurable por tenant en v2; MVP con la máquina fija de arriba.

---

## 5. Colas y ruteo

Reusa el patrón de propiedad por agente del inbox (`ownerAgentId`/`ownerAgentName`, [`conversations.ts:174`](../amplify/functions/_shared/conversations.ts)) y el scope por programa (Pilar 1).

- **Cola** = filtro guardado (programa + canal + prioridad) + agentes elegibles. Config por tenant (`connectview-connections.cases.queues`).
- **MVP:** cola compartida + asignación manual ("tomar caso", como el ownership del inbox) + round-robin opcional.
- **v2:** skills-based routing (reusa el concepto del dialer, Pilar 7) y auto-asignación por carga.
- **RBAC:** los casos se filtran por programa igual que el resto ([[project_rbac_sidebar_permissions]]); un agente ve su cola, admin/supervisor ven todo.

---

## 6. Eventos al bus (integra con automatizaciones/journeys)

Nuevos `AutomationEvent` (extienden [`automation-engine`](../amplify/functions/automation-engine/handler.ts) y `fireAutomation`):

| Evento                | Cuándo                     | Uso típico                                       |
| --------------------- | -------------------------- | ------------------------------------------------ |
| `case_created`        | al crear (cualquier vía)   | auto-asignar, WhatsApp "recibimos tu caso #1042" |
| `case_status_changed` | transición                 | notificar, mover etapa del lead                  |
| `case_sla_breach`     | reaper detecta vencimiento | escalar a supervisor, abrir Jira                 |
| `case_resolved`       | → solved                   | disparar CSAT (P2)                               |

Y nuevas **acciones** (en automation-engine y como `action` kind de [journeys](../amplify/functions/_shared/journeys.ts), que ya tiene `moveStage|task|webhook|enqueueDialer`):

- `createCase` — abrir un caso desde una regla/journey (p.ej. `wantsHuman` en una conversación).
- `updateCase` — cambiar estado/prioridad/asignar.
- `escalateCase` — subir prioridad + reasignar + (opcional) `createJiraIssue`.

Esto materializa la regla del roadmap §4: **el sync es infra (framework); las acciones cross-sistema son nodos de journey/automatización.**

---

## 7. El `CaseConnector` (eje C — sobre el Connector Framework)

Vive en `_shared/connectors/` (doc A §10), mismo registry/ctx/tokens/restClient:

```ts
// amplify/functions/_shared/connectors/types.ts (cont. del doc A)
export interface CaseConnector {
  readonly id: string; // "zendesk" | "jira"
  readonly label: string;
  isConnected(tenantId: string): Promise<boolean>;
  createCase(c: Case, ctx: ConnectorCtx): Promise<ExternalRef>;
  updateCase(ref: ExternalRef, patch: Partial<Case>, ctx: ConnectorCtx): Promise<void>;
  parseInbound?(payload: unknown, headers: Record<string, string>): CaseInboundParse | null;
}
export interface CaseInboundParse {
  externalRef: ExternalRef;
  patch: Partial<Case>; // estado/prioridad/comentario que cambió afuera
  event?: "created" | "updated" | "resolved";
}
```

### Mapeo Zendesk (casi 1:1 — por eso calcamos sus estados)

| `Case`   | Zendesk Support API                                                   |
| -------- | --------------------------------------------------------------------- |
| create   | `POST /api/v2/tickets` `{subject, comment.body, priority, requester}` |
| update   | `PUT /api/v2/tickets/{id}`                                            |
| status   | `new/open/pending/hold/solved/closed` → **idéntico**                  |
| priority | `low/normal/high/urgent` → **idéntico**                               |
| inbound  | Webhooks (`ticket.updated`) + firma; `parseInbound` → patch           |
| SLA      | nativo de Zendesk; ARIA mantiene su propio reloj y reconcilia         |
| auth     | OAuth / API token en `connectview/tenant/<id>/zendesk`                |

### Mapeo Jira / JSM (escalamiento, no espejo)

| `Case`  | Jira Cloud REST v3 / JSM                                                                        |
| ------- | ----------------------------------------------------------------------------------------------- |
| create  | `POST /rest/api/3/issue` `{project, issuetype, summary, description, priority}` (o JSM request) |
| update  | `PUT /rest/api/3/issue/{id}`                                                                    |
| status  | vía `POST /issue/{id}/transitions` → mapear a estados del workflow del proyecto (no fijo)       |
| inbound | Webhooks (`jira:issue_updated`)                                                                 |
| auth    | OAuth 2.0 (3LO) / API token en `connectview/tenant/<id>/jira`                                   |

**Uso recomendado de Jira:** _escalamiento_, no soporte primario. "Un caso ARIA que el reaper marca `sla_breach` (o un agente escala) abre un issue en el Jira del equipo técnico" = acción `createJiraIssue` disparada por `case_sla_breach`. Es más valioso que replicar el workflow engine de Jira.

**Anti-loop:** igual que en el framework CRM — un caso que entra por el webhook de Zendesk lleva `origin="zendesk"` y no se re-sincroniza a Zendesk; se marca la escritura para que su propio webhook no genere eco.

---

## 8. CSAT / NPS al cierre (feature P2, enganchada acá)

Al pasar a `solved`/`closed`, `fireAutomation("case_resolved")` → una automatización manda la encuesta:

- Envío por WA/email con un token de tracking (reusa [`emailTracking.ts`](../amplify/functions/_shared/emailTracking.ts) / el patrón HSM).
- Respuesta entra por un endpoint público (`case-csat-webhook`, molde de los webhooks) → setea `case.csat` + escribe `CaseEvent{type:"csat"}`.
- Reporte: alimenta Pilar 9 (reportes por programa) y el leaderboard de agentes (que hoy usa el proxy de sentimiento — ahora tendría CSAT real).

---

## 9. Infraestructura (patrón de `create-segments.mjs`)

```
connectview-cases          PK=tenantId, SK=caseId           (Query por tenant; + item counter#cases)
                           GSI opcional byStatus (para el reaper sin scan completo)
IAM connectview-cases-access  (dynamodb CRUD+Query) → adjuntar a los roles que lo tocan
```

Lambdas nuevas (⚠️ [[reference_new_lambda_iam]]: rol propio o managed policy — NO al `campaign-lambda-role` que está lleno):

- **`manage-cases`** — Function URL: CRUD + transiciones + list (por cola/estado/programa) + asignación. Auth Cognito Bearer, RBAC por programa.
- **`case-sla-reaper`** — cron EventBridge (como el reaper de inactividad de conversaciones): detecta breaches, marca `breached`, emite `case_sla_breach`; y cierra `solved`→`closed` tras N días.
- Conectores en `_shared/connectors/{zendesk,jira}.ts` + webhooks inbound `{zendesk,jira}-inbound-webhook` (molde de meta-lead-ads-webhook).

Frontend: [`CasesPanel.tsx`](../src/components/workspace/CasesPanel.tsx) se expande de "deep-link a Connect Cases" a la vista de casos propia (lista + cola + detalle con SLA + timeline). El SLA de front ([`inbox/sla.ts`](../src/components/inbox/sla.ts)) se reusa para el chip de vencimiento, ahora leyendo `sla.resolutionDueAt` real en vez de la heurística.

---

## 10. Plan incremental (cada fase entrega valor y pasa CI)

- **B1 — Objeto + CRUD + UI.** `_shared/cases.ts` + tabla + `manage-cases` + `CasesPanel` propio: crear caso desde una conversación, listar, cambiar estado/prioridad, asignar. SLA mostrado (reloj de resolución básico, 24/7). **Valor solo:** gestión de casos con prioridad y estado, sin depender de nada externo.
- **B2 — SLA + eventos.** Políticas por tenant + `case-sla-reaper` + `case_created/status_changed/sla_breach/resolved` al bus + acciones `createCase/updateCase/escalateCase` en automation-engine y journeys.
- **B3 — CSAT (P2).** Encuesta al cierre + `case-csat-webhook` + reporte.
- **B4 — Zendesk connector.** `CaseConnector` bidireccional (create/update + webhook inbound). Requiere A (framework) desplegado.
- **B5 — Jira connector.** Escalamiento (`createJiraIssue` en `case_sla_breach`).
- **B6 — Colas + routing + workflow config (P5).** Skills-based routing y transiciones configurables por tenant.

**Dependencias:** B4/B5 necesitan el Connector Framework (doc A) en producción. B1–B3 son independientes del framework → se pueden empezar en paralelo a A.

---

## 11. Riesgos y decisiones abiertas

1. **Alcance del MVP.** B1 solo (casos propios, sin sync) ya es un producto útil y desbloquea CSAT. ¿Arrancamos por ahí y el sync Zendesk/Jira viene después? (recomendado: sí).
2. **Conversación↔Caso: ¿1:1 o N:1?** Propuse N:1 (un caso agrupa varias conversaciones). Más flexible pero más UI. MVP podría ser 1:1 (un caso = una conversación) y evolucionar.
3. **Reloj SLA sin business hours.** MVP 24/7 puede reportar breaches "de noche". Aceptable para arrancar; calendario laboral es v2 (no trivial: feriados, zonas horarias por programa).
4. **`connectview-cases` scan del reaper.** Con volumen alto, el scan por tenant escala mal. GSI `byStatus`/`bySlaDue` desde el inicio si se anticipa volumen.
5. **Solapamiento con callbacks/tasks.** El canal `task` de `connectview-callbacks` ([[project_agent_tasks_followups]]) es pariente del caso. Decidir si un "task" es un `Case` liviano o quedan como objetos distintos (propongo: distintos — task = recordatorio del agente; case = unidad con SLA).

> **Cierra el eje C.** Con A (framework) + B (Case), Zendesk y Jira entran como `CaseConnector`, y las features de casos (SLA, CSAT, colas) son propias de ARIA — no dependen de la app externa.
