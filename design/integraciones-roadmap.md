# ARIA — Roadmap de integraciones y paridad de funciones

**Plataformas objetivo:** HubSpot · Oracle CX · Zendesk · Jira / JSM
**Producto:** ARIA by Novasys (codename Vox/Connectview) · **Fecha:** 2026-07-16
**Estado:** documento de estrategia (fuente de verdad). No es plan de implementación aprobado.

**Diseños técnicos derivados (profundizan este roadmap hasta esqueleto de código):**

- [`connector-framework.md`](connector-framework.md) — el framework de conectores (C0). Extrae el patrón Salesforce a interfaz + registry + plan de refactor por PRs.
- [`case-primitiva.md`](case-primitiva.md) — la primitiva `Case`/Ticket con SLA (eje C, feature P1). Habilita Zendesk/Jira.

> Continúa la línea de [`zapier-pardot-analysis.md`](zapier-pardot-analysis.md) y [`pilar-10-salesforce.md`](pilar-10-salesforce.md): ahí probamos el patrón "absorber una integración" con Salesforce/Meta; acá lo generalizamos a un ecosistema de conectores.

---

## 0. TL;DR

1. **No partimos de cero.** El hub canónico de leads (`propagateLead` / `LeadInput`), el patrón de conexiones (`manage-connections` + secretos por servicio) y el **field-mapping schema-aware** (Pilar 10) ya son el 70 % de un framework de integración. Salesforce ya es bidireccional real.
2. **Tu lista son 3 tipos de sistema distintos, no uno.** Fuente de leads (inbound), CRM system-of-record (bidireccional), y ticketing/casos. HubSpot y Oracle van al eje CRM; Zendesk y Jira al eje casos — y el eje casos **necesita una primitiva que ARIA no tiene: el "Caso/Ticket" con SLA**.
3. **La integración NO va en journeys/automatizaciones — pero las acciones cross-sistema SÍ.** El sync de datos es infraestructura (connector framework). Journeys/automatizaciones son donde se consumen las capacidades: "crear ticket en Zendesk", "mover deal en HubSpot" = nodos/acciones nuevos; "deal ganado" = trigger nuevo.
4. **Arquitectura propuesta:** extraer el patrón Salesforce a un **Connector Framework** (interfaz común + registry por tenant). SF pasa a ser "el primer conector", no un caso especial. HubSpot valida el framework; Oracle entra sobre él; el eje casos es su propio diseño.
5. **Secuencia:** Fase 0 framework → Fase 1 HubSpot → Fase 2 Oracle CX → Fase 3 eje casos (Zendesk/Jira) → transversal: features de paridad (deals/forecast, CSAT, KB) como roadmap de producto propio.

---

## 1. El encuadre: 3 ejes de integración + 1 de producto

El error a evitar es tratar "HubSpot, Oracle, Zendesk, Jira" como una sola cola de trabajo. Son **contratos de integración diferentes**:

| Eje                                         | Apps                                             | Qué significa integrar                                              | Estado ARIA                     | Objeto canónico                  |
| ------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------- | -------------------------------- |
| **A. Fuente de leads** (inbound)            | Meta, ML, forms · y HubSpot/Oracle _como origen_ | Payload externo → `LeadInput` → `propagateLead`                     | ✅ Patrón probado               | `LeadInput` (existe)             |
| **B. CRM system-of-record** (bidireccional) | Salesforce · **HubSpot** · **Oracle CX Sales**   | Leer **y escribir** contactos, **deals/oportunidades**, actividades | 🟡 Solo SF; hay que generalizar | `LeadInput` + **`Deal`** (falta) |
| **C. Ticketing / casos**                    | **Zendesk** · **Jira / JSM**                     | Crear/sincronizar **casos con SLA**, colas, prioridad, resolución   | 🔴 Falta la primitiva           | **`Case`** (no existe)           |

Y un cuarto eje que **no es integración**:

- **D. Paridad de funciones** — construir dentro de ARIA features que estas plataformas tienen y nosotros no (deals con forecast, CSAT/NPS, knowledge base, cadencias, etc.). Es roadmap de producto propio. Compite por el mismo tiempo de ingeniería, así que conviene separarlo explícitamente y no colgarlo de ningún conector.

**Insight central:** integrar Zendesk/Jira sin tener el objeto `Case` en ARIA sería un cascarón (solo abrir la app externa por deep-link, que es lo que hoy hace [`CasesPanel.tsx`](../src/components/workspace/CasesPanel.tsx) con Amazon Connect Cases). El valor real (SLA, colas, escalamiento, medición) exige la primitiva. Por eso el eje C es a la vez integración **y** feature.

---

## 2. Inventario de capacidades de ARIA (la base)

Lo que sigue **ya existe** en el repo — el framework se monta encima, no lo reemplaza. Verificado en código.

| Capacidad                            | Implementación                                                                                                                                                                                                          | Rol para integraciones                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hub de leads / dedup**             | [`_shared/leadSync.ts`](../amplify/functions/_shared/leadSync.ts) — `propagateLead`, `LeadInput`, `bulkUpsertVoxLeads`                                                                                                  | El punto de fan-out canónico. Toda fuente entra por acá.                                                                                                                        |
| **Conexiones por tenant**            | [`manage-connections`](../amplify/functions/manage-connections/handler.ts) — `configJson` por servicio + secretos en Secrets Manager (`connectview/tenant/<id>/<servicio>`)                                             | El registry embrionario. Cada integración es un bloque de config + su secreto.                                                                                                  |
| **Field-mapping schema-aware**       | Pilar 10 — `describeSObject` + `fieldMapping` por tenant + auto-recuperación de `INVALID_FIELD`                                                                                                                         | Resuelve el problema más difícil de CRMs de terceros: cada org tiene su schema. **Reusable para cualquier conector.**                                                           |
| **Conector SF bidireccional**        | [`salesforce-sync`](../amplify/functions/salesforce-sync/handler.ts) + [`salesforce-inbound-webhook`](../amplify/functions/salesforce-inbound-webhook/handler.ts)                                                       | La implementación de referencia a extraer como interfaz.                                                                                                                        |
| **Motor de automatización**          | [`automation-engine`](../amplify/functions/automation-engine/handler.ts) + `connectview-automation-rules`                                                                                                               | Triggers→acciones. Donde se consumen capacidades cross-sistema.                                                                                                                 |
| **Journeys (drip omnicanal)**        | [`journey-runner`](../amplify/functions/journey-runner/handler.ts) + [`_shared/journeys.ts`](../amplify/functions/_shared/journeys.ts) — nodos `send`/`wait`/`branch`/`action(moveStage\|task\|webhook\|enqueueDialer)` | Los `action` kinds son el punto de extensión para acciones cross-sistema.                                                                                                       |
| **Bus de eventos**                   | [`_shared/automationHook.ts`](../amplify/functions/_shared/automationHook.ts) `fireAutomation()`                                                                                                                        | Triggers `lead_created`, `lead_stage_changed`, `lead_inactive`, `wrapup_saved`, `whatsapp_flow_completed`, `message_inbound`, `tag_applied`. Se extiende con triggers externos. |
| **Webhooks salientes durables**      | acción `webhook` → SQS → dispatcher (`connectview-webhook-deliveries`), backoff multi-día                                                                                                                               | El fallback genérico para cualquier API sin conector nativo.                                                                                                                    |
| **Scoring / grading**                | [`_shared/scoring.ts`](../amplify/functions/_shared/scoring.ts)                                                                                                                                                         | Enriquecimiento del lead, agnóstico de origen.                                                                                                                                  |
| **Segmentos dinámicos**              | `connectview-segments` + [`_shared/leadFilter.ts`](../amplify/functions/_shared/leadFilter.ts)                                                                                                                          | Audiencias reutilizables.                                                                                                                                                       |
| **Cliente 360**                      | AWS Customer Profiles (`upsertProfile` en leadSync)                                                                                                                                                                     | Superficie de identidad unificada.                                                                                                                                              |
| **Supresión / DNC · Deliverability** | [`_shared/suppression.ts`](../amplify/functions/_shared/suppression.ts) · [`get-whatsapp-health`](../amplify/functions/get-whatsapp-health/handler.ts)                                                                  | Guardas previas a cualquier envío.                                                                                                                                              |
| **Multi-tenant BYO**                 | [`_shared/tenantConnect.ts`](../amplify/functions/_shared/tenantConnect.ts) — `getTenantConnect`, `setActiveDynamo/Profiles/Tenant`                                                                                     | Cada conector corre en la cuenta/credenciales del tenant.                                                                                                                       |

**Modelo de datos:** las entidades son tablas DynamoDB `connectview-*` (definidas en `infra/cfn/data-plane.yaml` + `scripts/create-*.mjs`), no un schema `amplify/data`. Objetos nuevos (`Deal`, `Case`) = tablas nuevas con el mismo patrón.

---

## 3. Arquitectura: el Connector Framework

### 3.1 El seam actual

Hoy `propagateLead` habla con Salesforce **hardcodeado**: abanica a tabla de leads + Customer Profile + SF. El mapeo ya es dinámico (Pilar 10), pero el _destino_ es uno solo y fijo. Generalizar = convertir "Salesforce" en "el conjunto de conectores habilitados del tenant".

### 3.2 La interfaz de conector destino

Extraer de `salesforceClient` + `pushLeadToSalesforce` una interfaz común que cada CRM implemente:

```ts
interface CrmConnector {
  id: "salesforce" | "hubspot" | "oracle-cx";
  // Identidad / registro
  upsertContact(lead: LeadInput, mapping: FieldMapping): Promise<ExternalRef>;
  upsertDeal?(deal: DealInput, mapping: FieldMapping): Promise<ExternalRef>; // eje B (opcional)
  // Actividad / tipificación
  pushActivity(ref: ExternalRef, activity: Activity): Promise<void>; // ≈ SF Task
  pushStatus(ref: ExternalRef, status: string): Promise<void>;
  pushSuppression(phone: string, doNotContact: boolean): Promise<void>; // ≈ DoNotCall
  // Schema
  describeSchema(object: "contact" | "deal"): Promise<FieldDescriptor[]>; // alimenta el mapper de la UI
  // Anti-loop
  originTag: string; // "hubspot" → propagateLead no lo re-empuja a HubSpot
}

interface CaseConnector {
  // eje C (Zendesk/Jira)
  id: "zendesk" | "jira";
  createCase(c: CaseInput): Promise<ExternalRef>;
  updateCase(ref: ExternalRef, patch: Partial<CaseInput>): Promise<void>;
  onInboundCaseEvent(payload: unknown): CaseInput | null; // webhook → canónico
}
```

Salesforce ya implementa `CrmConnector` **de facto** — es refactor, no green-field. Las claves que ya resolviste y hay que preservar en la interfaz: **dedup determinístico** (External Id → teléfono E.164 → email), **auto-recuperación de campo inexistente**, **anti-eco por `origin`/`originTag`**, y el manejo de "registro ya convertido" (SF Lead→Contact; el equivalente en otros CRMs varía).

### 3.3 El registry por tenant

`config.connections[]` en `connectview-connections` (hoy ya viven ahí `config.salesforce`, `config.meta`, etc.):

```
propagateLead(lead)
  ├─ tabla connectview-leads        (siempre)
  ├─ Customer Profile 360           (siempre)
  └─ para cada conector habilitado del tenant:   ← el cambio
       connector.upsertContact(lead, tenant.mapping[connector.id])
```

Un tenant puede tener 0..N conectores CRM activos (p.ej. SF + HubSpot en paralelo durante una migración). El anti-loop se generaliza: un lead con `origin="hubspot"` no se re-empuja a HubSpot, pero sí a los demás destinos.

### 3.4 Ingesta (inbound)

Sin cambio de patrón: **un webhook por sistema** (como [`meta-lead-ads-webhook`](../amplify/functions/meta-lead-ads-webhook/handler.ts) y `salesforce-inbound-webhook`). Cada uno: verifica firma/token → resuelve tenant → `setActiveTenant/Dynamo/Profiles` → mapea payload→canónico → `propagateLead(..., {origin})` → `fireAutomation()`. HubSpot y Zendesk tienen webhooks nativos; Oracle suele ir por Oracle Integration Cloud o polling.

### 3.5 Secretos y OAuth

El patrón `connectview/tenant/<id>/<servicio>` ya está. Cada conector añade su secreto (OAuth refresh token / API key). El flujo OAuth de SF ([`salesforce-oauth-start/callback`](../amplify/functions/salesforce-oauth-start/handler.ts)) es el molde para HubSpot (OAuth estándar) y Zendesk (OAuth/API token). Oracle: credenciales de servicio.

### 3.6 Diagrama

```
                          ┌──────────────────────── ARIA ────────────────────────┐
 Fuentes  ───webhook───►  ingesta (1 Lambda/sistema) ─► propagateLead ─┬─► connectview-leads
 (Meta, HubSpot,          mapea payload → LeadInput                     ├─► Customer Profile 360
  Zendesk, forms…)                    │                                 └─► Connector Registry (por tenant)
                                      │                                       ├─ SalesforceConnector
                                      │                                       ├─ HubSpotConnector
                                      │                                       └─ OracleCxConnector
                                      └─► fireAutomation(evento)
                                             │
                                             ▼
                                    automation-engine / journey-runner
                                       └─ acciones cross-sistema:
                                          crear_ticket(Zendesk/Jira), mover_deal(HubSpot)…
                          └───────────────────────────────────────────────────────┘
```

---

## 4. Journeys vs Automatizaciones — la regla de diseño

Tu pregunta: _"¿eso con journey o automatizaciones se podría hacer?"_. Respuesta precisa:

- **La sincronización de datos NO va ahí.** Es infraestructura (connector framework). Meter el sync de un CRM dentro de un journey lo haría frágil, no idempotente y sin observabilidad.
- **Las acciones cross-sistema SÍ van ahí**, como extensión natural de lo que ya existe:
  - **Nuevos `action` kinds en journeys** ([`_shared/journeys.ts`](../amplify/functions/_shared/journeys.ts) ya tiene `moveStage|task|webhook|enqueueDialer`): `createTicket`, `updateDeal`, `pushToOracle`…
  - **Nuevas acciones en automation-engine**: mismas capacidades disparadas por evento.
  - **Nuevos triggers** (`AutomationEvent`): `deal_won`, `ticket_resolved`, `case_sla_breach` — emitidos por los webhooks inbound de cada sistema vía `fireAutomation`.

| Capa                    | Responsabilidad                        | Ejemplo                                                                   |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| **Connector framework** | Mover datos, dedup, mapping, anti-loop | Un lead entra → aparece en HubSpot y SF                                   |
| **Automatizaciones**    | Reacción puntual a un evento           | "deal pasó a Ganado" → mandar WhatsApp de bienvenida                      |
| **Journeys**            | Secuencia multi-paso con esperas/ramas | Día 0 crear ticket Zendesk → esperar 2d → si sin resolver, escalar a Jira |

Regla mnemónica: **el connector expone capacidades; journeys/automatizaciones las orquestan.** El "cuándo" y el "qué" son de negocio (journey); el "cómo se escribe en el CRM" es de infra (connector).

---

## 5. Las 4 plataformas — análisis y matriz

Leyenda de cobertura ARIA: ✅ cubierto · 🟡 parcial · 🆕 gap. Recomendación: **Integrar** (traer el dato/capacidad vía conector) · **Construir** (feature propia en ARIA) · **Dejar** (que lo siga haciendo la otra app).

> ⚠️ Naming: Oracle y HubSpot renombran productos seguido. Las capacidades son estables; validar nombres/endpoints exactos contra los developer docs (§11) al implementar cada conector.

### 5.1 HubSpot — _CRM competidor directo · eje B (+ A)_

**Qué es:** "Smart CRM" con Hubs (Marketing, Sales, Service, Operations, CMS). Modelo de datos: `contacts`, `companies`, `deals`, `tickets`, custom objects; con _associations_ y _properties_ (campos custom). API REST muy amable + Webhooks + OAuth. El mejor candidato para el 2º conector: mismo modelo lead/deal que SF.

| Función HubSpot                                    | ARIA             | Dónde / nota                                                          | Recomendación                       |
| -------------------------------------------------- | ---------------- | --------------------------------------------------------------------- | ----------------------------------- |
| Contactos + companies + properties                 | ✅               | `LeadInput` + `attributes`; mapping schema-aware (Pilar 10)           | **Integrar** (conector)             |
| **Deals / pipelines** con amount, stage, closeDate | 🟡               | Solo `montoEstimado` + ponderado por prob-de-etapa; sin objeto `Deal` | **Construir** `Deal` + **Integrar** |
| **Sequences** (cadencia 1:1 del rep)               | 🆕               | Journeys/Automations son automatizados/masivos, no cola rep-owned     | **Construir** (ver §6)              |
| Workflows (automatización visual)                  | ✅               | automation-engine + journeys                                          | —                                   |
| Lists estáticas/dinámicas                          | ✅               | `connectview-segments` + leadFilter                                   | —                                   |
| Lead scoring                                       | ✅               | `_shared/scoring.ts`                                                  | —                                   |
| **Tickets / Service Hub**                          | 🆕               | (eje C)                                                               | **Construir** `Case`                |
| **Knowledge base**                                 | 🆕               | Solo FAQ del bot RAG (`manage-knowledge`)                             | **Construir** (ver §6)              |
| **Feedback surveys (CSAT/NPS/CES)**                | 🆕               | Solo mocks + proxy de sentimiento                                     | **Construir** (ver §6)              |
| Quotes                                             | 🆕               | Solo Catálogos genéricos (`manage-catalog`)                           | Backlog                             |
| Meetings scheduler                                 | 🆕               | `connectview-appointments` existe; sin scheduler público              | Backlog                             |
| Marketing email masivo / landing pages             | 🆕 (a propósito) | ARIA hace email 1:1 + campañas WA/voz                                 | **Dejar** (como Pardot)             |
| Data sync (Operations Hub)                         | ✅ **mejor**     | Es literalmente lo que hace el connector framework                    | **Integrar**                        |

### 5.2 Oracle CX — _suite enterprise · eje B (+ C)_

**Qué es:** conjunto de pilares, no un producto: **Oracle Sales** (Fusion Sales), **Oracle CPQ**, **Oracle Service**, **Oracle Marketing** (Eloqua B2B, Responsys B2C, **Unity CDP**). Enterprise, muy configurable, API más pesada (a menudo vía Oracle Integration Cloud). Entra sobre el framework ya probado con HubSpot.

| Función Oracle CX                                      | ARIA             | Dónde / nota                                              | Recomendación                             |
| ------------------------------------------------------ | ---------------- | --------------------------------------------------------- | ----------------------------------------- |
| Accounts / Contacts / Leads                            | ✅               | `LeadInput` + mapping                                     | **Integrar**                              |
| **Opportunities + forecasting + territorios**          | 🟡 / 🆕          | Sin objeto deal ni forecast; sin territory mgmt           | **Construir** `Deal` + **Integrar**       |
| **CPQ** (configure-price-quote)                        | 🆕               | Producto estrella de Oracle; ARIA no tiene quotes/pricing | **Dejar** (integrar si el cliente lo usa) |
| Sales orchestration (cadencias)                        | 🆕               | = sequences                                               | **Construir**                             |
| **Unity CDP**                                          | 🟡               | Customer Profile 360 se le parece (identidad unificada)   | **Integrar** / coexistir                  |
| Eloqua (nurturing B2B) / Responsys (B2C)               | 🆕 (a propósito) | Email masivo                                              | **Dejar** (como Pardot)                   |
| Oracle Service (omnichannel, knowledge, field service) | 🆕               | (eje C)                                                   | **Construir** `Case` + **Integrar**       |
| Incentive Compensation (ICM)                           | 🆕               | Fuera de scope de ARIA                                    | **Dejar**                                 |

**Nota estratégica:** Oracle CX rara vez se reemplaza; se _coexiste_. El valor de ARIA frente a Oracle es el mismo que frente a SF: conversacional (WA/voz), speed-to-lead, dialer y atribución omnicanal. Punto de encuentro = Oracle Sales como system-of-record; ARIA escribe contactos/actividad y mide la conversión real.

### 5.3 Zendesk — _customer service · eje C_

**Qué es:** suite de soporte: **Support** (ticketing omnicanal), **Guide** (knowledge base/help center), **Chat/Messaging**, **Talk** (voz), **Explore** (analytics), **Sell** (CRM chico), **Sunshine** (custom objects). No es CRM de leads — es **casos**.

| Función Zendesk                        | ARIA | Dónde / nota                                                                               | Recomendación                       |
| -------------------------------------- | ---- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| **Ticketing omnicanal**                | 🆕   | No hay objeto `Case`; inbox tiene conversaciones, no tickets                               | **Construir** `Case` + **Integrar** |
| **SLA policies**                       | 🆕   | Solo SLA de primera respuesta del inbox ([`inbox/sla.ts`](../src/components/inbox/sla.ts)) | **Construir**                       |
| Macros / triggers / automations        | ✅   | ≈ automation-engine                                                                        | —                                   |
| **Omnichannel / skills-based routing** | 🟡   | Ruteo en Connect (voz); no routing de casos                                                | **Construir** (routing de `Case`)   |
| **CSAT surveys**                       | 🆕   | Solo mocks                                                                                 | **Construir**                       |
| **Guide (knowledge base público)**     | 🆕   | Solo FAQ del bot RAG                                                                       | **Construir**                       |
| Answer bot / AI agents                 | ✅   | Agente IA (Pilar 8, bot-runtime RAG)                                                       | —                                   |
| Messaging / live chat                  | ✅   | Inbox omnicanal (Pilar 6: WA/IG/Messenger/ML/email)                                        | —                                   |
| Talk (voz)                             | ✅   | Amazon Connect (softphone, grabaciones, sentiment)                                         | —                                   |
| Explore (reporting)                    | ✅   | Pilar 9 (reportes por programa)                                                            | —                                   |

**Lectura:** Zendesk expone exactamente lo que le falta a ARIA en el eje C (Case + SLA + CSAT + KB). Es el mejor _espejo de features_ para construir la primitiva de casos bien.

### 5.4 Jira / JSM — _issue tracking + service management · eje C_

**Qué es:** **Jira Software** (dev: issues, boards, sprints, **workflows** con estados/transiciones custom, **JQL**, automation rules) + **Jira Service Management** (request types, **queues**, **SLAs**, approvals, incident/problem/change, **CMDB/assets**, portal). El diferenciador es el **workflow engine** (transiciones con condiciones/validadores/post-functions).

| Función Jira/JSM                                  | ARIA | Dónde / nota                                                                              | Recomendación                                          |
| ------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Issues / request types                            | 🆕   | = `Case`                                                                                  | **Construir** + **Integrar**                           |
| **Workflow engine** (estados+transiciones custom) | 🆕   | Taxonomía = etapas sin reglas de transición; automation-engine ≠ transiciones con guardas | **Construir** (ligero) / **Integrar** (delegar a Jira) |
| **Queues + SLAs**                                 | 🆕   | —                                                                                         | **Construir**                                          |
| Automation rules (no-code)                        | ✅   | automation-engine                                                                         | —                                                      |
| JQL (query language)                              | 🟡   | Segmentos + leadFilter (predicados)                                                       | **Construir** (extender a `Case`)                      |
| Approvals                                         | 🆕   | —                                                                                         | Backlog                                                |
| Incident / problem / change mgmt                  | 🆕   | —                                                                                         | **Dejar** (ops interno del cliente)                    |
| **CMDB / asset management**                       | 🆕   | Irrelevante para el mercado de ARIA                                                       | **Dejar**                                              |
| KB (Confluence)                                   | 🆕   | Solo FAQ RAG                                                                              | **Construir** (KB propia)                              |

**Lectura:** Jira aporta el **caso de uso B2B/interno** del eje C (issues de proyecto/soporte técnico con workflow). Integrarlo como _destino de escalamiento_ ("un caso ARIA no resuelto se abre como issue en Jira del equipo técnico") es más valioso que replicar su workflow engine. Recomendación: **Case ligero propio + acción `createJiraIssue`** en journeys/automatizaciones, no reconstruir Jira.

---

## 6. Gap de FEATURES priorizado (construir en ARIA — eje D)

Orden = valor × cercanía a lo existente. Esfuerzo: S / M / L / XL. Cada uno habilita paridad con ≥1 plataforma.

### P0 — Objeto **`Deal` / Oportunidad** · Esfuerzo **L** · habilita HubSpot + Oracle

Hoy solo hay `montoEstimado` en el lead y un pipeline ponderado por probabilidad-**de-etapa** ([`LeadsPage.tsx`](../src/pages/LeadsPage.tsx)). Falta el objeto con `amount`, `closeDate`, `probability` por-deal, `pipeline`/`stage`, y **forecasting** (suma ponderada por período). Tabla `connectview-deals`, asociada a lead/programa. Es la base para ser un CRM de ventas "de verdad" y para mapear deals↔HubSpot/Oracle.

### P1 — Primitiva **`Case` / Ticket + SLA** · Esfuerzo **XL** · habilita Zendesk + Jira + HubSpot Service

El gap estructural más grande. Objeto `connectview-cases`: `subject`, `priority`, `status`/`resolution`, `queue`, `assignee`, `slaPolicy` (first-response + resolution con reloj y breach), `channel`, ligado a conversación/lead. Reutiliza inbox (Pilar 6), routing y el bus de eventos (`case_created`, `case_sla_breach`, `case_resolved`). Ya hay dos puentes: el deep-link a [Connect Cases](../src/components/workspace/CasesPanel.tsx) y el [SLA de primera respuesta](../src/components/inbox/sla.ts) del inbox. **Es feature + integración a la vez** (habilita todo el eje C).

### P2 — **CSAT / NPS** post-interacción · Esfuerzo **M** · habilita Zendesk + HubSpot Service

Envío de encuesta (WA/email) al cerrar conversación/caso, captura de rating, almacenamiento y reporte. Hoy solo hay mocks y el proxy de sentimiento de Contact Lens ([`get-agent-leaderboard`](../amplify/functions/get-agent-leaderboard/handler.ts)). Encaja con el cierre de conversaciones ya existente y con Reportes (Pilar 9).

### P3 — **Knowledge base** propia · Esfuerzo **M-L** · habilita Zendesk Guide + HubSpot KB

Extender [`manage-knowledge`](../amplify/functions/manage-knowledge/handler.ts) (hoy FAQ Q&A para el bot RAG) a artículos con categorías + portal self-service. Doble valor: contenido público **y** mejor RAG para el Agente IA (misma fuente).

### P4 — **Sequences / cadencias 1:1** · Esfuerzo **M** · habilita HubSpot Sales + Oracle

Cola personal del rep (paso llamar→esperar→email→task), distinta de journeys (automatizados) y campañas (masivas). Se puede modelar como un "journey rep-owned" con pasos manuales sobre el motor existente + una vista de cola del agente.

### P5 — **Workflow ligero sobre `Case`** · Esfuerzo **M** · habilita Jira/JSM

Estados + transiciones con condiciones sobre el objeto `Case` (no un engine genérico tipo Jira). Suficiente para SLA/escalamiento; el caso complejo se delega a Jira por conector.

> Backlog (no priorizado): CPQ/quotes, meeting scheduler público, custom objects definibles por el cliente, CMDB.

---

## 7. Gap de CONECTORES priorizado (integrar — ejes A/B/C)

### C0 — **Connector Framework** · Esfuerzo **L** · base de todo

Extraer la interfaz `CrmConnector` de `salesforceClient`/`pushLeadToSalesforce` + registry por tenant en `propagateLead`. Sin esto, cada CRM es copy-paste de ~1500 líneas. **Refactor, no green-field:** SF ya lo implementa de facto.

### C1 — **HubSpot** (CRM) · Esfuerzo **M** (sobre C0) · eje B

El 2º conector, valida el framework. OAuth estándar + CRM API (contacts/deals) + Webhooks para inbound. Modelo casi 1:1 con lo que ya hace SF. Empareja con P0 (`Deal`).

### C2 — **Oracle CX Sales** · Esfuerzo **L** · eje B

Sobre el framework probado. API más pesada (posible Oracle Integration Cloud / polling en vez de webhook nativo). Contacts + Opportunities.

### C3 — **Eje casos: Zendesk + Jira** · Esfuerzo **L** (depende de P1 `Case`) · eje C

Conectores `CaseConnector`: crear/actualizar caso en Zendesk, abrir issue en Jira como escalamiento. Webhooks inbound para `ticket_resolved`/`case_updated`. **Bloqueado por P1** (sin objeto `Case` no hay qué sincronizar).

### C-transversal — **Fuente de leads** (eje A)

Cualquiera de las 4 como _origen_ de leads entra por el patrón de ingesta existente (webhook → `propagateLead`), sin esperar al framework. Barato; se puede hacer oportunísticamente si un cliente lo pide.

---

## 8. Plan por fases (secuencia recomendada)

```
Fase 0  ─ Connector Framework (C0)                          [base]
          + objeto Deal (P0)                                 ─┐ en paralelo
Fase 1  ─ HubSpot CRM (C1)  ── valida framework + Deal        │
Fase 2  ─ Oracle CX Sales (C2)                                │
Fase 3  ─ Primitiva Case + SLA (P1)  ── el eje C entero      ─┘ dependencia dura
          + Zendesk/Jira conectores (C3)
          + CSAT/NPS (P2)
Transversal ─ KB propia (P3) · Sequences (P4) · Workflow Case (P5)
              como roadmap de producto, sin bloquear conectores
```

**Dependencias duras:** C1/C2 necesitan C0. C3 necesita P1. P2 se apoya en el cierre de conversaciones (existe). Todo lo demás es paralelizable.

**Criterio de arranque sugerido:** Fase 0 + Fase 1 juntas — construir el framework _con_ HubSpot como primer cliente del framework evita diseñar la interfaz en abstracto (el error clásico: abstraer con un solo caso de uso). SF + HubSpot = dos implementaciones que fuerzan una interfaz honesta.

---

## 9. Riesgos y decisiones abiertas

1. **¿Reemplazar o coexistir?** Con SF/Oracle la respuesta es coexistir (son system-of-record del cliente). Con HubSpot puede ser reemplazo (competimos). La postura comercial cambia el diseño del conector (¿bidireccional pleno o solo escritura?).
2. **Objeto `Case`: ¿propio o delegado?** Construir `Case` propio (P1) es XL pero desbloquea todo el eje C y es diferenciador. Alternativa barata: solo deep-link + sync de estado (como hoy con Connect Cases). Decisión de producto, no técnica.
3. **Oracle = esfuerzo real alto.** API/modelo pesados y frecuentemente detrás de Oracle Integration Cloud. No comprometer Oracle sin un cliente concreto que lo pida.
4. **Multiplicidad de mapeos.** Con N conectores por tenant, el field-mapping (Pilar 10) se multiplica por conector. La UI de configuración (`IntegrationsManager`) necesita escalar a "un mapper por conector".
5. **Anti-loop con N destinos.** Con SF era 1:1; con N conectores hay que garantizar que un lead que entra por HubSpot y se propaga a SF no rebote. El `origin`/`originTag` por conector lo cubre, pero hay que probarlo con 2+ destinos activos.
6. **Naming/verificación de APIs.** Este doc usa conocimiento de plataforma; los endpoints/nombres exactos se validan contra los developer docs (§11) al implementar cada conector.

---

## 10. Qué NO hacer (anti-scope)

- **No reconstruir el workflow engine de Jira** ni el CPQ de Oracle. Delegar por conector; construir solo lo ligero sobre `Case`.
- **No asumir email marketing masivo** (Marketing Hub / Eloqua / Responsys / Pardot). Mismo argumento que en [`zapier-pardot-analysis.md`](zapier-pardot-analysis.md) §5: deliverability a escala es un dominio propio.
- **No meter el sync de datos en journeys/automatizaciones.** Infra abajo, orquestación arriba (§4).
- **No integrar Oracle "porque suena grande"** sin un cliente que lo use.

---

## 11. Fuentes (developer docs oficiales — validar features/endpoints al implementar)

- **HubSpot:** `developers.hubspot.com` — CRM API (objects, associations, properties, search), Webhooks API, OAuth.
- **Oracle CX:** `docs.oracle.com/en/cloud/saas/` — Fusion Sales REST API, Oracle CPQ, B2C/Fusion Service, Eloqua/Responsys/Unity (Oracle Marketing), Oracle Integration Cloud.
- **Zendesk:** `developer.zendesk.com` — Support API (tickets, SLA, triggers), Sunshine (custom objects), Webhooks, Guide/Help Center API.
- **Jira / JSM:** `developer.atlassian.com/cloud/jira` — Jira Cloud REST v3, JSM API (request types, SLAs, queues), Webhooks, JQL, Forge/Connect.
- Internas: [`zapier-pardot-analysis.md`](zapier-pardot-analysis.md) · [`pilar-10-salesforce.md`](pilar-10-salesforce.md) · [`pilar-5-ingesta.md`](pilar-5-ingesta.md) · [`journeys.md`](journeys.md).
