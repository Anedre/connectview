/**
 * connectors/fieldMapping — carga el mapeo de campos ARIA→remoto de un conector,
 * por tenant, desde connectview-connections. Generalización de `loadActiveSfConn`
 * (leadSync.ts, Pilar 10): antes solo Salesforce; ahora cualquier conector.
 *
 * Lee `config.connections[<id>].fieldMapping`, con fallback al bloque legacy
 * `config.<id>.fieldMapping` (así Salesforce, que guarda en `config.salesforce`,
 * sigue funcionando sin migración). Cacheado 5 min (igual que la taxonomía).
 */
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import type { FieldMapping } from "./types";

const ddb = new DynamoDBClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { mapping: FieldMapping; at: number }>();

interface ConnBlock {
  fieldMapping?: FieldMapping;
}

/** Mapeo del conector para el tenant. `{}` si no hay (el conector cae a sus
 *  defaults). Cacheado por (tenant, connector) 5 min. */
export async function loadConnectorMapping(
  connectorId: string,
  tenantId: string,
): Promise<FieldMapping> {
  if (!tenantId) return {};
  const key = `${tenantId}#${connectorId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.mapping;

  let mapping: FieldMapping = {};
  try {
    const r = await ddb.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    const json = r.Item?.configJson?.S;
    if (json) {
      const cfg = JSON.parse(json) as {
        connections?: Record<string, ConnBlock>;
        [k: string]: unknown;
      };
      const fromNew = cfg.connections?.[connectorId]?.fieldMapping;
      const fromLegacy = (cfg[connectorId] as ConnBlock | undefined)?.fieldMapping;
      mapping = fromNew || fromLegacy || {};
    }
  } catch {
    /* sin config / sin acceso → defaults */
  }
  cache.set(key, { mapping, at: Date.now() });
  return mapping;
}

/** Invalida el cache (obligatorio al cambiar de tenant en un contenedor caliente,
 *  igual que resetTaxonomyCache en el loop multi-tenant del automation-engine). */
export function resetConnectorMappingCache(): void {
  cache.clear();
}
