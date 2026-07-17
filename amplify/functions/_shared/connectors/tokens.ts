/**
 * connectors/tokens — lectura del secreto de un conector para el tenant.
 *
 * Convención de secretos (ya usada por WhatsApp/Meta/Salesforce):
 *   connectview/tenant/<tenantId>/<connectorId>
 * El refresh de OAuth es específico de cada proveedor (endpoints distintos), así
 * que vive en el adapter de cada conector; acá solo se LEE el secreto guardado
 * (refresh token / API key / credenciales) que ese refresh consume.
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});

/** Nombre del secreto de un conector para un tenant. */
export function connectorSecretName(connectorId: string, tenantId: string): string {
  return `connectview/tenant/${tenantId}/${connectorId}`;
}

/** Lee el secreto JSON de un conector para el tenant. `null` si no existe o está
 *  vacío/malformado (el caller lo trata como "no conectado"). */
export async function readConnectorSecret<T = Record<string, unknown>>(
  connectorId: string,
  tenantId: string,
): Promise<T | null> {
  try {
    const r = await sm.send(
      new GetSecretValueCommand({ SecretId: connectorSecretName(connectorId, tenantId) }),
    );
    if (!r.SecretString) return null;
    return JSON.parse(r.SecretString) as T;
  } catch {
    return null;
  }
}
