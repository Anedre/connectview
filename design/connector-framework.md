# Diseño técnico — Connector Framework (A)

**Producto:** ARIA by Novasys (Vox/Connectview) · **Fecha:** 2026-07-16
**Contexto:** parte del [roadmap de integraciones](integraciones-roadmap.md) §3/§7. Este doc profundiza C0 (el framework) hasta esqueleto de código.
**Precede a:** el diseño de la primitiva `Case` (B) y a la implementación de HubSpot (C1).

## Decisiones tomadas

1. **HubSpot = conector bidireccional, postura de coexistencia.** El framework soporta bidireccional igual (SF ya lo es). "Reemplazo" es una postura comercial que NO cambia el conector. Diseñamos el superset.
2. **SF no es un caso especial: es el primer conector.** El framework se valida extrayendo SF a la interfaz y luego montando HubSpot como segundo. Dos implementaciones reales fuerzan una interfaz honesta (evita abstraer con un solo caso).
3. **Refactor aditivo, en PRs chicos que pasan CI.** Nada de reescribir `leadSync`/`salesforceClient` de un saque — hay sesiones concurrentes ([[project_concurrent_sessions]]) y el [CI gate](../.github/workflows) (tsc→eslint→vitest→build). Cada paso deja SF funcionando idéntico.

---

## 1. El seam actual (qué se generaliza)

Hoy [`propagateLead`](../amplify/functions/_shared/leadSync.ts) abanica a 3 superficies; la 3ª tiene Salesforce **hardcodeado**:

```
propagateLead(lead, {origin})
  1. tabla connectview-leads   (+ membership de programa)   ← agnóstico
  2. Customer Profile 360                                    ← agnóstico
  3. if (origin !== "salesforce") pushLeadToSalesforce(...)  ← UN destino fijo
```

El objetivo del framework es que el paso 3 sea **"para cada conector habilitado del tenant, upsert"**. Los pasos 1–2 no cambian.

Piezas reutilizables que YA existen (no se reescriben, se envuelven o se generalizan):

| Pieza actual                                                    | Archivo                   | Se convierte en                                       |
| --------------------------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| `sfFetch` (timeout 8s + retry-401 + base URL)                   | `salesforceClient.ts:219` | `restClient.ts` genérico (base URL + auth por header) |
| `getToken` (2 modos: OAuth per-tenant / JWT legacy + cache)     | `salesforceClient.ts:158` | `TokenProvider` por conector                          |
| `setActiveTenant` / `getActiveTenantId` (contexto module-scope) | `salesforceClient.ts:101` | patrón intacto — el framework lo respeta              |
| `describeSObject` (schema para el mapper)                       | `salesforceClient.ts:347` | `connector.describeSchema()`                          |
| `loadActiveSfConn` (fieldMapping por tenant, cache 5min)        | `leadSync.ts:106`         | `loadConnectorMapping(connectorId)` genérico          |
| `pushLeadToSalesforce` (dedup + converted + Task + rollup)      | `leadSync.ts:655`         | queda como el **cuerpo del adapter SF**               |
| anti-loop por `origin` ("vox"/"salesforce")                     | `propagateLead`           | `origin = connectorId` (o "vox")                      |

**Clave:** toda la lógica dura de SF (dedup por `VoxLeadId__c`→teléfono→email, Leads convertidos, `Task`, rollup R4, `DoNotCall`, auto-recuperación de `INVALID_FIELD`) es **SF-específica** y se queda encapsulada en el adapter SF. El framework solo orquesta: registry + iterar + aislar errores + resolver mapping + anti-loop.

---

## 2. Los tipos canónicos

```ts
// amplify/functions/_shared/connectors/types.ts

/** Referencia a un registro en un sistema externo (idempotencia). */
export interface ExternalRef {
  connectorId: string; // "salesforce" | "hubspot" | "oracle-cx"
  objectType: string; // "Lead" | "Contact" | "contact" | "deal" | ...
  id: string; // id nativo del sistema externo
}

export interface UpsertResult {
  ref: ExternalRef;
  action: "created" | "updated" | "skipped";
}

/** Gestión/actividad a registrar contra un registro externo (≈ SF Task). */
export interface ActivityInput {
  subject: string;
  description?: string;
  channel?: string; // voice|email|whatsapp|chat → cada conector lo mapea
  subtype?: string; // Call|Email|Task (SF) / note|call (HubSpot)
  status?: "completed" | "open";
  occurredAt?: string;
}

/** Campo escribible del objeto remoto — alimenta el mapper de la UI.
 *  Idéntico en forma a SfDescribeField (salesforceClient.ts:330), ahora agnóstico. */
export interface FieldDescriptor {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  createable: boolean;
  updateable: boolean;
  nillable: boolean;
  picklistValues?: { label: string; value: string }[];
}

/** Qué sabe hacer un conector (para la UI y para saltar métodos no soportados). */
export interface ConnectorCapabilities {
  contact: boolean; // upsertContact
  deal: boolean; // upsertDeal (eje B, cuando exista el objeto Deal)
  activity: boolean; // pushActivity
  suppression: boolean; // pushSuppression (DNC)
  describe: boolean; // describeSchema (mapper schema-aware)
  inbound: boolean; // parseInbound (webhook → canónico)
  cases?: boolean; // eje C — lo cubre CaseConnector (doc B)
}

/** Contexto que el FRAMEWORK arma y pasa al conector en cada llamada:
 *  el tenant, el mapping resuelto para ESE conector, y el cliente REST ya
 *  autenticado. El conector no resuelve secretos ni mapping por su cuenta. */
export interface ConnectorCtx {
  tenantId: string;
  mapping: FieldMapping; // { ariaField: remoteFieldName }; "" = no escribir
  rest: RestClient; // base URL + auth ya inyectada
  voxLeadId?: string; // External Id de ARIA (dedup determinístico)
  sfExtra?: ActivityInput; // gestión opcional a registrar junto al upsert
}

export type FieldMapping = Partial<Record<string, string>>;
```

## 3. La interfaz de conector

```ts
// amplify/functions/_shared/connectors/types.ts (cont.)
import type { LeadInput } from "../leadSync";

/** El contrato de un conector CRM (eje B). Solo `id/label/capabilities/
 *  isConnected/upsertContact` son obligatorios; el resto es opcional según
 *  capabilities → un conector "solo fuente de leads" implementa el mínimo. */
export interface CrmConnector {
  readonly id: string; // "salesforce" — TAMBIÉN el origin tag anti-loop
  readonly label: string; // "Salesforce" (UI)
  readonly capabilities: ConnectorCapabilities;

  /** ¿Conectado y utilizable para el tenant? Deriva del SECRETO (no de un flag),
   *  igual que hoy hace el GET de manage-connections para SF. */
  isConnected(tenantId: string): Promise<boolean>;

  /** Upsert de la persona (lead/contact). El conector encapsula SU dedup y SU
   *  modelo de objetos. Devuelve la ref externa para idempotencia futura. */
  upsertContact(lead: LeadInput, ctx: ConnectorCtx): Promise<UpsertResult | null>;

  pushActivity?(ref: ExternalRef, act: ActivityInput, ctx: ConnectorCtx): Promise<string | null>;
  pushSuppression?(phone: string, doNotContact: boolean, ctx: ConnectorCtx): Promise<boolean>;
  upsertDeal?(deal: DealInput, ctx: ConnectorCtx): Promise<UpsertResult | null>;
  describeSchema?(object: "contact" | "deal", ctx: ConnectorCtx): Promise<FieldDescriptor[]>;

  /** Webhook inbound → forma canónica + el origin para el anti-loop. */
  parseInbound?(payload: unknown, headers: Record<string, string>): InboundParse | null;
}

export interface InboundParse {
  lead: LeadInput;
  origin: string; // = connector.id → propagateLead no lo re-empuja acá
  externalRef?: ExternalRef;
}

/** DealInput — depende del objeto Deal (doc: features P0). Placeholder acá. */
export interface DealInput {
  leadId?: string;
  name?: string;
  amount?: number;
  currency?: string;
  stage?: string;
  probability?: number;
  closeDate?: string;
  attributes?: Record<string, string>;
}
```

## 4. El adapter de Salesforce (envuelve lo existente, no lo reescribe)

Demuestra que el refactor es **aditivo**: el adapter delega en las funciones que ya funcionan y están probadas en producción.

```ts
// amplify/functions/_shared/connectors/salesforce.ts
import { pushLeadToSalesforce, pushDoNotCallToSalesforce } from "../leadSync";
import { describeSObject, setActiveTenant } from "../salesforceClient";
import type { CrmConnector } from "./types";

export const salesforceConnector: CrmConnector = {
  id: "salesforce",
  label: "Salesforce",
  capabilities: {
    contact: true,
    deal: false,
    activity: true,
    suppression: true,
    describe: true,
    inbound: true,
  },

  async isConnected(tenantId) {
    return sfIsConnected(tenantId); // el mismo check del GET de manage-connections
  },

  async upsertContact(lead, ctx) {
    // El framework ya llamó setActiveTenant(ctx.tenantId) en buildCtx.
    const r = await pushLeadToSalesforce(lead, ctx.sfExtra, ctx.voxLeadId); // TAL CUAL hoy
    if (!r) return null;
    return {
      ref: {
        connectorId: "salesforce",
        objectType: r.kind === "lead" ? "Lead" : "Contact",
        id: r.leadId,
      },
      action: r.action,
    };
  },

  async pushSuppression(phone, dnc, ctx) {
    const r = await pushDoNotCallToSalesforce(phone, dnc, { voxLeadId: ctx.voxLeadId });
    return r.updated;
  },

  async describeSchema(object) {
    return describeSObject(object === "deal" ? "Opportunity" : "Lead");
  },

  // parseInbound: envuelve el mapeo que hoy vive en salesforce-inbound-webhook.
};
```

Nota: `pushActivity` de SF hoy va **dentro** de `pushLeadToSalesforce` (el `sfExtra` con Task). En la interfaz se pasa por `ctx.sfExtra` para no cambiar ese comportamiento en el paso 1. Una limpieza posterior puede separarlo, pero no es necesaria para el framework.

## 5. El REST client + TokenProvider genéricos

Extraídos de `sfFetch` + `getToken` sin cambiar su comportamiento; SF pasa a construirse sobre ellos (o se deja como está y solo los conectores nuevos los usan — lo segundo es más seguro para el PR1).

```ts
// amplify/functions/_shared/connectors/restClient.ts

export interface RestClient {
  call(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<RestResponse>;
}
export interface RestResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/** fetch con timeout duro (AbortController, patrón de salesforceClient.ts:41) +
 *  retry-on-401 con refresh de token. `token()` lo provee el conector. */
export function makeRestClient(opts: {
  baseUrl: string;
  token: (force?: boolean) => Promise<string>;
  timeoutMs?: number;
}): RestClient {
  /* ...igual que sfFetch pero parametrizado... */
}
```

```ts
// amplify/functions/_shared/connectors/tokens.ts

/** Resuelve+cachea el access token de un conector para el tenant, leyendo el
 *  secreto connectview/tenant/<id>/<connectorId> (patrón ya usado por WhatsApp/
 *  Meta/SF). OAuth refresh para HubSpot/Zendesk; credenciales para Oracle. */
export function tokenProviderFor(connectorId: string, tenantId: string): (force?: boolean) => Promise<string> { ... }
```

Secretos: convención existente `connectview/tenant/<id>/<servicio>` — cada conector añade el suyo. OAuth flow por conector reusa el molde de [`salesforce-oauth-start/callback`](../amplify/functions/salesforce-oauth-start/handler.ts).

## 6. El registry + resolución por tenant

```ts
// amplify/functions/_shared/connectors/registry.ts
import { salesforceConnector } from "./salesforce";
import { hubspotConnector } from "./hubspot";
import type { CrmConnector, ConnectorCtx } from "./types";

const REGISTRY: Record<string, CrmConnector> = {
  salesforce: salesforceConnector,
  hubspot: hubspotConnector,
  // "oracle-cx": oracleCxConnector,
};

/** Conectores HABILITADOS del tenant: lee connectview-connections[tenantId].
 *  config.connections[] (o los bloques legacy config.salesforce/…) + confirma
 *  isConnected (deriva del secreto). Cacheado 5 min, igual que el fieldMapping. */
export async function enabledConnectors(tenantId: string): Promise<CrmConnector[]> { ... }

/** Arma el ConnectorCtx: setActiveTenant + carga el mapping del conector +
 *  construye el RestClient autenticado. Un solo lugar donde vive el "setup". */
export async function buildCtx(tenantId: string, c: CrmConnector, extra?: Partial<ConnectorCtx>): Promise<ConnectorCtx> { ... }
```

## 7. `propagateLead` — el único cambio en el hub

El paso 3 pasa de "un destino fijo" a "iterar el registry". Aislamiento de errores: un conector que falla **no** tumba a los otros ni al guardado local (idéntica garantía que hoy da el `try/catch` alrededor de SF).

```ts
// leadSync.ts — propagateLead, paso 3 (reemplaza el bloque pushToSf actual)
const origin = opts.origin || "vox";
const connectors = await enabledConnectors(tenantId);
result.connectors = {};
for (const c of connectors) {
  if (c.id === origin) continue; // anti-loop: no rebota al origen
  try {
    const ctx = await buildCtx(tenantId, c, { voxLeadId: stored?.leadId, sfExtra: opts.sfExtra });
    const up = await c.upsertContact({ ...lead, programId: resolvedProgramId }, ctx);
    result.connectors[c.id] = up ?? null;
    // idempotencia: guardar la ref externa en el lead (como hoy setSfLeadId)
    if (up && stored) await saveExternalRef(stored.leadId, up.ref);
  } catch (err) {
    console.error(`propagateLead → ${c.id} push failed:`, err);
    result.connectors[c.id] = null; // aislado
  }
}
```

`sfLeadId` (campo suelto en el lead) se generaliza a `externalRefs: ExternalRef[]` (o un mapa `{connectorId: id}`). Retrocompat: `sfLeadId` se lee/escribe como `externalRefs.salesforce` durante la transición.

**Anti-loop con N destinos:** un lead que entra por el webhook de HubSpot llega con `origin="hubspot"` → se propaga a SF y a la tabla local, pero NO vuelve a HubSpot. Cada conector inbound debe además marcar su escritura para que su propio webhook no genere eco (SF usa `LeadSource="Vox"`; HubSpot: una property `aria_synced` o filtrar la subscription — ver §9).

## 8. Ingesta (inbound) — sin cambio de patrón

Un webhook por sistema, como [`meta-lead-ads-webhook`](../amplify/functions/meta-lead-ads-webhook/handler.ts) / `salesforce-inbound-webhook`. El handler genérico:

```
1. verificar firma/token del sistema           (HMAC HubSpot, token SF, …)
2. resolver tenant                              (por accountId/pageId/token)
3. setActiveTenant + setActiveDynamo/Profiles   (BYO data plane)
4. connector.parseInbound(payload) → {lead, origin}
5. propagateLead(lead, { origin })              (el registry hace el resto)
6. fireAutomation(evento)                       (speed-to-lead / triggers)
```

## 9. HubSpot como primer conector nuevo (valida la interfaz)

Mapeo concreto de la interfaz a la API real de HubSpot (v3) — prueba que el contrato aguanta un CRM distinto a SF:

| Método de la interfaz  | HubSpot                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isConnected`          | existe refresh token en `connectview/tenant/<id>/hubspot`                                                                                               |
| auth (`TokenProvider`) | OAuth2 refresh → `POST api.hubapi.com/oauth/v1/token`                                                                                                   |
| `upsertContact`        | `POST /crm/v3/objects/contacts` con dedup por `email` (o search por `phone`); properties `firstname/lastname/phone/email/lifecyclestage/hs_lead_status` |
| `pushActivity`         | `POST /crm/v3/objects/notes` (o `/tasks`) + association al contacto                                                                                     |
| `upsertDeal`           | `POST /crm/v3/objects/deals` (`dealname/amount/dealstage/pipeline/closedate`) + association                                                             |
| `describeSchema`       | `GET /crm/v3/properties/contacts` (o `/deals`) → map a `FieldDescriptor`                                                                                |
| `parseInbound`         | Webhooks API (`contact.creation`, `deal.propertyChange`); firma `X-HubSpot-Signature-v3`                                                                |
| anti-eco               | property custom `aria_origin` marcada al escribir + condición en la subscription                                                                        |

Diferencias con SF que la interfaz absorbe sin fricción: HubSpot no tiene "Lead vs Contact convertido" (un solo `contact`), el dedup nativo es por email (no un External Id custom obligatorio), y las asociaciones son explícitas (contact↔deal↔note). Todo eso queda **dentro** del adapter `hubspot.ts`; el framework no se entera.

## 10. Estructura de archivos

```
amplify/functions/_shared/connectors/
  types.ts          — tipos canónicos + interfaces CrmConnector / CaseConnector
  restClient.ts     — fetch timeout+retry+base (de sfFetch)
  tokens.ts         — TokenProvider por conector (de getToken)
  fieldMapping.ts   — loadConnectorMapping (de loadActiveSfConn, genérico)
  registry.ts       — REGISTRY + enabledConnectors + buildCtx
  salesforce.ts     — adapter (envuelve salesforceClient + pushLeadToSalesforce)
  hubspot.ts        — nuevo conector (C1)
  oracle-cx.ts      — (C2, después)
amplify/functions/hubspot-oauth-start/     — molde de salesforce-oauth-start
amplify/functions/hubspot-oauth-callback/
amplify/functions/hubspot-inbound-webhook/ — molde de meta-lead-ads-webhook
```

## 11. Plan de refactor incremental (cada paso pasa CI y deja SF idéntico)

- **PR1 — andamiaje, sin cambio de comportamiento.** Crear `connectors/types.ts` + `restClient.ts` + `tokens.ts` + `salesforce.ts` (adapter que delega en lo existente) + `registry.ts` con SOLO salesforce. Nadie lo importa aún → SF sigue por su camino actual. Tests unitarios del adapter contra `pushLeadToSalesforce` mockeado.
- **PR2 — enchufar el hub.** `propagateLead` paso 3 pasa a iterar `enabledConnectors` (que hoy devuelve solo SF). Comportamiento observable idéntico; verificar E2E que un lead sigue cayendo en SF igual. Introduce `externalRefs` con retrocompat a `sfLeadId`.
- **PR3 — HubSpot escritura.** `hubspot.ts` + OAuth (`hubspot-oauth-*`) + bloque `config.connections.hubspot` + card en `IntegrationsManager` con su `describeSchema` mapper. Habilitar por tenant; un tenant con SF+HubSpot escribe a ambos.
- **PR4 — HubSpot inbound.** `hubspot-inbound-webhook` + `parseInbound` + anti-eco. Cierra el bidireccional.
- **PR5+** — Oracle (C2), luego los `CaseConnector` (C3, tras el doc B).

## 12. Riesgos y notas

1. **`externalRefs` vs `sfLeadId`.** Migrar el campo suelto a un mapa toca varios call-sites (`setSfLeadId`, el push, los reads). Mantener el alias `sfLeadId = externalRefs.salesforce` evita un big-bang.
2. **`enabledConnectors` = otro scan/read por lead.** Cachear por tenant (5 min, como el fieldMapping) para no pegarle a `connectview-connections` en cada `propagateLead`.
3. **Anti-eco por conector.** Cada CRM lo resuelve distinto (SF: LeadSource; HubSpot: property/subscription). Es responsabilidad del adapter, y hay que probarlo con 2 destinos activos a la vez (el caso que SF solo nunca ejercitó).
4. **`buildCtx` y el contexto module-scope.** `setActiveTenant`/`setActiveDynamo` son globals por-contenedor. Con varios conectores en un loop, `buildCtx` debe re-setear el contexto correcto antes de CADA conector (no asumir que el anterior lo dejó bien). Igual que `resetTaxonomyCache` en el loop multi-tenant del automation-engine.
5. **Timeouts.** Con N conectores en serie dentro de un webhook que debe responder rápido (Meta exige 200 veloz), sumar 8s×N es peligroso. Opciones: paralelizar los upserts (`Promise.allSettled`) o mover el fan-out a conectores a una cola async (SQS) para los inbound sensibles a latencia. Decisión al implementar PR2.

> **Siguiente:** diseño de la primitiva `Case` (doc B) — habilita el `CaseConnector` (eje C) y las features de casos.
