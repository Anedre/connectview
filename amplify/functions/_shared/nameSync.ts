/**
 * nameSync — mantiene el NOMBRE del cliente consistente entre almacenes cuando se
 * edita desde una superficie que NO es el lead. Caso: el Agent Desktop edita el
 * Customer Profile de Amazon Connect (update-customer-profile) — pero Leads y
 * Grabaciones leen `connectview-leads.name`, y el inbox cachea `customerName` en
 * las conversaciones. Sin propagación, el cambio del Agent Desktop no aparece en
 * esas vistas. Estas funciones empujan el nombre nuevo a esos dos almacenes.
 * Best-effort: nunca rompen el guardado principal. Ver [[reference_initials_and_name_sync]].
 */
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { normalizePhone, samePhone } from "./phone";

/**
 * Actualiza el `name` (+ email opcional) del lead cuyo teléfono matchea `phone`,
 * SI existe. update-if-exists: NO crea un lead nuevo (para no ensuciar el pipeline
 * cuando se edita un cliente que todavía no es lead). Devuelve el leadId
 * actualizado o null. Scan O(n) — como el resto del matching por teléfono del repo.
 */
export async function upsertLeadNameByPhone(
  dynamo: DynamoDBClient,
  leadsTable: string,
  phone: string,
  name: string,
  email?: string,
): Promise<string | null> {
  if (!phone || !name) return null;
  const e164 = normalizePhone(phone)?.e164 || phone;
  let ESK: Record<string, unknown> | undefined;
  try {
    do {
      const r = await dynamo.send(
        new ScanCommand({
          TableName: leadsTable,
          ExclusiveStartKey: ESK as never,
          ProjectionExpression: "leadId, phone",
        }),
      );
      for (const it of r.Items || []) {
        const l = unmarshall(it) as { leadId?: string; phone?: string };
        if (!l.leadId || !l.phone || !samePhone(l.phone, e164)) continue;
        const sets = ["#n = :name", "updatedAt = :now"];
        const vals: Record<string, unknown> = {
          ":name": name,
          ":now": new Date().toISOString(),
        };
        if (email) {
          sets.push("email = :email");
          vals[":email"] = email;
        }
        await dynamo.send(
          new UpdateItemCommand({
            TableName: leadsTable,
            Key: { leadId: { S: l.leadId } },
            UpdateExpression: "SET " + sets.join(", "),
            ExpressionAttributeNames: { "#n": "name" },
            ExpressionAttributeValues: marshall(vals, { removeUndefinedValues: true }),
            ConditionExpression: "attribute_exists(leadId)",
          }),
        );
        return l.leadId;
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
  } catch (e) {
    console.warn("upsertLeadNameByPhone falló", (e as Error).message);
  }
  return null;
}

/**
 * Refresca `customerName` en las conversaciones del inbox vinculadas — por leadId
 * (si se pasó) o por teléfono. La tabla `connectview-conversations` es POOLED
 * (cuenta de la plataforma) → pasar el client legacy. Best-effort.
 */
export async function propagateNameToConversations(
  dynamo: DynamoDBClient,
  convTable: string,
  leadId: string | null,
  phone: string,
  name: string,
): Promise<void> {
  if (!name) return;
  const e164 = normalizePhone(phone)?.e164 || phone;
  const now = new Date().toISOString();
  let ESK: Record<string, unknown> | undefined;
  try {
    do {
      const r = await dynamo.send(
        new ScanCommand({
          TableName: convTable,
          ExclusiveStartKey: ESK as never,
          ProjectionExpression: "conversationId, leadId, phone, customerName",
        }),
      );
      for (const it of r.Items || []) {
        const c = unmarshall(it) as {
          conversationId: string;
          leadId?: string;
          phone?: string;
          customerName?: string;
        };
        const match = (!!leadId && c.leadId === leadId) || (!!c.phone && samePhone(c.phone, e164));
        if (!match || c.customerName === name) continue;
        await dynamo.send(
          new UpdateItemCommand({
            TableName: convTable,
            Key: { conversationId: { S: c.conversationId } },
            UpdateExpression: "SET customerName = :n, updatedAt = :u",
            ExpressionAttributeValues: marshall(
              { ":n": name, ":u": now },
              { removeUndefinedValues: true },
            ),
          }),
        );
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
  } catch (e) {
    console.warn("propagateNameToConversations (nameSync) falló", (e as Error).message);
  }
}
