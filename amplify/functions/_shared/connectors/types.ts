/**
 * connectors/types — tipos canónicos + interfaces del Connector Framework (C0).
 *
 * El framework generaliza el patrón Salesforce (salesforceClient + leadSync
 * pushLeadToSalesforce) a un conjunto de conectores por tenant. Cada CRM/ticketing
 * implementa una interfaz común; `propagateLead` (leadSync) abanica a los conectores
 * habilitados en vez de a Salesforce hardcodeado.
 *
 * Ver design/connector-framework.md (A) y design/integraciones-roadmap.md.
 *
 * PR1 (este): solo tipos + adapter Salesforce + registry con SF. Nadie lo importa
 * todavía → cero cambio de comportamiento. `propagateLead` se enchufa en PR2.
 */
import type { LeadInput } from "../leadSync";

/** Referencia a un registro en un sistema externo (idempotencia del sync). */
export interface ExternalRef {
  connectorId: string; // "salesforce" | "hubspot" | "oracle-cx" | "zendesk" | "jira"
  objectType: string; // "Lead" | "Contact" | "contact" | "deal" | "ticket" | ...
  id: string; // id nativo del sistema externo
}

export interface UpsertResult {
  ref: ExternalRef;
  action: "created" | "updated" | "skipped";
}

/** Gestión/actividad a registrar contra un registro externo (≈ SF Task). El
 *  conector la traduce a su modelo (SF Task, HubSpot note/engagement, …). */
export interface ActivityInput {
  subject: string;
  description?: string;
  channel?: string; // voice|email|whatsapp|chat → el conector lo mapea
  subtype?: string; // Call|Email|Task (SF) / note|call (HubSpot)
  status?: "completed" | "open";
  occurredAt?: string;
}

/** Campo escribible del objeto remoto — alimenta el mapper schema-aware de la UI.
 *  Misma forma que SfDescribeField (salesforceClient.ts), ahora agnóstico. */
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
  deal: boolean; // upsertDeal (eje B; requiere el objeto Deal, feature P0)
  activity: boolean; // pushActivity
  suppression: boolean; // pushSuppression (DNC)
  describe: boolean; // describeSchema (mapper schema-aware)
  inbound: boolean; // el sistema tiene webhook inbound (parseInbound / webhook propio)
  cases?: boolean; // eje C — lo cubre CaseConnector
}

/** Mapa campo-ARIA → campo-remoto. "" (o "-") = no escribir ese campo (R24). */
export type FieldMapping = Partial<Record<string, string>>;

export interface RestResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Cliente REST autenticado (base URL + token inyectados). Ver restClient.ts. */
export interface RestClient {
  call(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<RestResponse>;
}

/** Contexto que el FRAMEWORK arma y pasa al conector en cada llamada: el tenant,
 *  el mapping resuelto para ESE conector, y (opcional) una actividad a registrar
 *  junto al upsert. El RestClient lo construye cada conector con su token; el
 *  adapter Salesforce usa su client interno (salesforceClient) y no necesita `rest`. */
export interface ConnectorCtx {
  tenantId: string;
  mapping: FieldMapping;
  rest?: RestClient;
  /** External Id de ARIA (el leadId de Vox) → dedup determinístico en el CRM. */
  voxLeadId?: string;
  /** Gestión opcional a registrar junto al contacto (≈ SF Task). */
  activity?: ActivityInput;
}

/** Oportunidad/deal canónica (eje B). Depende del objeto Deal (feature P0); acá
 *  se declara la forma para que los conectores tipen `upsertDeal`. */
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

/** Resultado de traducir un webhook inbound a la forma canónica de lead. */
export interface InboundParse {
  lead: LeadInput;
  origin: string; // = connector.id → propagateLead NO lo re-empuja a este conector
  externalRef?: ExternalRef;
}

/**
 * El contrato de un conector CRM (eje B). Obligatorios:
 * id/label/capabilities/isConnected/upsertContact. El resto es opcional según
 * `capabilities` → un conector "solo fuente de leads" implementa el mínimo.
 */
export interface CrmConnector {
  readonly id: string; // "salesforce" — TAMBIÉN el origin tag anti-loop
  readonly label: string; // "Salesforce" (UI)
  readonly capabilities: ConnectorCapabilities;

  /** ¿Conectado y utilizable para el tenant? Deriva del SECRETO, no de un flag. */
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

// ─────────────────────────── Eje C — casos/tickets ──────────────────────────
// El objeto Case canónico vive en _shared/cases.ts (design/case-primitiva.md).
// Para no acoplar el framework al objeto Case todavía, el CaseConnector tipa con
// un shape mínimo estructural (`CaseLike`). Cuando cases.ts exista, su `Case`
// satisface `CaseLike` sin cambios en el framework.

export interface CaseLike {
  caseId: string;
  tenantId: string;
  subject: string;
  status: string;
  priority: string;
  description?: string;
  phone?: string;
  externalRefs?: ExternalRef[];
}

export interface CaseInboundParse {
  externalRef: ExternalRef;
  patch: Record<string, unknown>; // estado/prioridad/comentario que cambió afuera
  event?: "created" | "updated" | "resolved";
}

export interface CaseConnector {
  readonly id: string; // "zendesk" | "jira"
  readonly label: string;
  isConnected(tenantId: string): Promise<boolean>;
  createCase(c: CaseLike, ctx: ConnectorCtx): Promise<ExternalRef>;
  updateCase(ref: ExternalRef, patch: Partial<CaseLike>, ctx: ConnectorCtx): Promise<void>;
  parseInbound?(payload: unknown, headers: Record<string, string>): CaseInboundParse | null;
}
