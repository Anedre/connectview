/**
 * connectors/salesforce — el adapter de Salesforce sobre la interfaz CrmConnector.
 *
 * NO reescribe nada: delega en las funciones ya probadas en producción
 * (`pushLeadToSalesforce`, `pushDoNotCallToSalesforce`, `describeSObject`), que
 * encapsulan la lógica dura de SF (dedup por VoxLeadId__c→teléfono→email, Leads
 * convertidos, Task, rollup R4, auto-recuperación de INVALID_FIELD). El framework
 * solo orquesta; toda la especificidad de SF vive acá adentro.
 *
 * Ver design/connector-framework.md §4.
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { pushLeadToSalesforce, pushDoNotCallToSalesforce, type LeadInput } from "../leadSync";
import { describeSObject, setActiveTenant } from "../salesforceClient";
import type { CrmConnector, ConnectorCtx, UpsertResult, FieldDescriptor } from "./types";

const sm = new SecretsManagerClient({});
const SF_MASTER_SECRET = process.env.SF_SECRET_NAME || "connectview/salesforce";

/**
 * ¿El tenant tiene Salesforce conectado? Deriva del SECRETO (no de un flag), con
 * el mismo criterio que el GET de manage-connections:
 *   ① per-tenant OAuth web  → connectview/tenant/<id>/salesforce con refreshToken
 *   ② master JWT-bearer (legacy/fundador) → connectview/salesforce con las creds
 */
async function sfIsConnected(tenantId: string): Promise<boolean> {
  try {
    const sec = await sm.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/salesforce` }),
    );
    try {
      if (JSON.parse(sec.SecretString || "{}").refreshToken) return true;
    } catch {
      /* tombstone / malformado → probamos master */
    }
  } catch {
    /* no existe → probamos master */
  }
  try {
    const master = await sm.send(new GetSecretValueCommand({ SecretId: SF_MASTER_SECRET }));
    const p = JSON.parse(master.SecretString || "{}");
    return !!(p.consumerKey && p.username && p.privateKey);
  } catch {
    return false;
  }
}

export const salesforceConnector: CrmConnector = {
  id: "salesforce",
  label: "Salesforce",
  capabilities: {
    contact: true,
    deal: false, // Opportunities: pendiente del objeto Deal (feature P0)
    activity: true,
    suppression: true,
    describe: true,
    inbound: true, // inbound vive en salesforce-inbound-webhook (migración a parseInbound = luego)
  },

  isConnected: sfIsConnected,

  async upsertContact(lead: LeadInput, ctx: ConnectorCtx): Promise<UpsertResult | null> {
    // Contexto SF del tenant (token + org). El adapter lo fija por su cuenta →
    // el framework no acopla con salesforceClient.
    setActiveTenant(ctx.tenantId);
    // ActivityInput → SfPushExtra (la forma que espera pushLeadToSalesforce).
    const extra = ctx.activity
      ? {
          taskSubject: ctx.activity.subject,
          taskDescription: ctx.activity.description,
          taskSubtype: ctx.activity.subtype,
        }
      : undefined;
    const r = await pushLeadToSalesforce(lead, extra, ctx.voxLeadId);
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

  async pushSuppression(phone: string, doNotContact: boolean, ctx: ConnectorCtx): Promise<boolean> {
    setActiveTenant(ctx.tenantId);
    const r = await pushDoNotCallToSalesforce(phone, doNotContact, { voxLeadId: ctx.voxLeadId });
    return r.updated;
  },

  async describeSchema(object: "contact" | "deal", ctx: ConnectorCtx): Promise<FieldDescriptor[]> {
    setActiveTenant(ctx.tenantId);
    // "contact" → Lead (el objeto que ARIA escribe); "deal" → Opportunity.
    return describeSObject(object === "deal" ? "Opportunity" : "Lead");
  },
};
