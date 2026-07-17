/**
 * connectors/registry — el registro de conectores CRM y su resolución por tenant.
 *
 * `propagateLead` (leadSync) usará `enabledConnectors(tenantId)` para abanicar el
 * lead a los conectores habilitados+conectados del tenant, en vez de a Salesforce
 * hardcodeado (ese cambio = PR2). PR1 solo provee el registro y las utilidades.
 *
 * "Habilitado" = el admin lo activó en config (config.connections[<id>].enabled,
 * o el bloque legacy config.<id> para Salesforce). "Conectado" = el secreto está
 * presente (connector.isConnected). Ambos por tenant.
 *
 * Ver design/connector-framework.md §6.
 */
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { salesforceConnector } from "./salesforce";
import { loadConnectorMapping } from "./fieldMapping";
import type { CrmConnector, ConnectorCtx } from "./types";

const ddb = new DynamoDBClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const TTL_MS = 5 * 60 * 1000;

/** Todos los conectores CRM conocidos. PR1: solo Salesforce; HubSpot/Oracle luego. */
export const CRM_CONNECTORS: Record<string, CrmConnector> = {
  salesforce: salesforceConnector,
};

const enabledCache = new Map<string, { ids: string[]; at: number }>();

interface ConnEnableBlock {
  enabled?: boolean;
}

/**
 * Ids de conectores que el admin ACTIVÓ para el tenant. Habilitado si:
 *   · config.connections[<id>].enabled !== false, o
 *   · existe el bloque legacy config.<id> (retrocompat: Salesforce siempre así).
 * NO confirma isConnected acá — solo lo declarado. Cacheado 5 min.
 */
async function enabledConnectorIds(tenantId: string): Promise<string[]> {
  if (!tenantId) return [];
  const hit = enabledCache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;

  const ids: string[] = [];
  try {
    const r = await ddb.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    const json = r.Item?.configJson?.S;
    if (json) {
      const cfg = JSON.parse(json) as {
        connections?: Record<string, ConnEnableBlock>;
        [k: string]: unknown;
      };
      for (const id of Object.keys(CRM_CONNECTORS)) {
        const fromNew = cfg.connections?.[id];
        const hasLegacy = !!cfg[id];
        if (fromNew ? fromNew.enabled !== false : hasLegacy) ids.push(id);
      }
    }
  } catch {
    /* sin config / sin acceso → [] */
  }
  enabledCache.set(tenantId, { ids, at: Date.now() });
  return ids;
}

/** Conectores CRM habilitados Y conectados (secreto presente) del tenant. */
export async function enabledConnectors(tenantId: string): Promise<CrmConnector[]> {
  const ids = await enabledConnectorIds(tenantId);
  const out: CrmConnector[] = [];
  for (const id of ids) {
    const c = CRM_CONNECTORS[id];
    if (!c) continue;
    try {
      if (await c.isConnected(tenantId)) out.push(c);
    } catch {
      /* isConnected falló (transitorio) → lo salteamos este tick */
    }
  }
  return out;
}

/**
 * Arma el ConnectorCtx: carga el mapping del conector para el tenant + adjunta el
 * `extra` (voxLeadId, activity). Cada conector fija su propio contexto de auth en
 * sus métodos (el adapter Salesforce llama setActiveTenant), así que buildCtx no
 * acopla con ningún cliente concreto.
 */
export async function buildCtx(
  tenantId: string,
  connector: CrmConnector,
  extra?: Partial<ConnectorCtx>,
): Promise<ConnectorCtx> {
  const mapping = await loadConnectorMapping(connector.id, tenantId);
  return { tenantId, mapping, ...extra };
}

/** Invalida el cache de habilitados (al cambiar de tenant en un contenedor caliente). */
export function resetConnectorRegistryCache(): void {
  enabledCache.clear();
}
