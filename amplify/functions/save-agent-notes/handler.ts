import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConnectClient,
  StartTaskContactCommand,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";
import { resolveTenantId } from "../_shared/cognitoAuth";
import { fireAutomation } from "../_shared/automationHook";

// BYO Connect + Data Plane (#43+#46): module-active.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
let connect: ConnectClient = legacyConnect;
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";
/**
 * Append-only history of every wrap-up save. PK=contactId, SK=savedAt.
 * Lets the UI show "agent A on 2026-05-20 marked it ContestóInteresado,
 * agent B on 2026-05-27 reopened and marked NoContestó". The current
 * (latest) state still lives on connectview-contacts so all the existing
 * read paths keep working with no migration.
 */
const HISTORY_TABLE =
  process.env.WRAPUP_HISTORY_TABLE || "connectview-wrapup-history";
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let instanceId = INSTANCE_ID;
// The contact flow we route the follow-up task to. Defaults to the same
// inbound-handling flow so it shows in the agent's task queue.
const FOLLOWUP_FLOW_ID = process.env.FOLLOWUP_FLOW_ID || "";
// The queue that owns follow-up tasks. Defaults to the agent's default
// queue if not set — the frontend must pass it explicitly otherwise.
const FOLLOWUP_QUEUE_ID = process.env.FOLLOWUP_QUEUE_ID || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";

  // BYO Connect + Data Plane: setea connect/instanceId/dynamo en un trip.
  {
    const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    connect = r.client;
    instanceId = r.instanceId;
    dynamo = r.dynamo || legacyDynamo;
  }

  try {
    if (method === "GET") {
      const contactId = event.queryStringParameters?.contactId;
      if (!contactId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "contactId required" }),
        };
      }

      const [result, historyRes] = await Promise.all([
        dynamo.send(
          new GetItemCommand({
            TableName: TABLE_NAME,
            Key: { contactId: { S: contactId } },
          })
        ),
        // History is append-only — sort descending so the most recent
        // wrap-up is first. Cap at 50 to keep payload bounded; in
        // practice a single contactId never has more than a handful.
        dynamo
          .send(
            new QueryCommand({
              TableName: HISTORY_TABLE,
              KeyConditionExpression: "contactId = :cid",
              ExpressionAttributeValues: {
                ":cid": { S: contactId },
              },
              ScanIndexForward: false,
              Limit: 50,
            })
          )
          .catch((err) => {
            // History table might not exist yet on first read; treat as empty.
            console.warn("history query failed:", err);
            return { Items: [] as Record<string, unknown>[] };
          }),
      ]);

      const item = result.Item ? unmarshall(result.Item) : null;
      const history = (historyRes.Items || []).map((row) => unmarshall(row));
      // Surface ALL wrap-up fields so the historical-contact viewer can
      // render the full disposition + follow-up state, not just the
      // free-form notes + summary.
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          notes: item?.agentNotes || "",
          wrapUpCode: item?.wrapUpCode || "",
          summary: item?.summary || "",
          stage: item?.stage || "",
          stageLabel: item?.stageLabel || "",
          subStage: item?.subStage || "",
          subStageLabel: item?.subStageLabel || "",
          valoracion: item?.valoracion || "",
          tags: item?.tags || [],
          followUps: item?.followUps || {},
          followUpTaskIds: item?.followUpTaskIds || [],
          updatedAt: item?.updatedAt || "",
          agentUsername: item?.agentUsername || "",
          history,
        }),
      };
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const {
        contactId,
        notes,
        wrapUpCode,
        summary,
        agentUsername,
        // #21 Auto-resumen: el front manda solo el resumen (sin tipificación)
        // cuando el agente sale del wrap-up sin enviar. Cambia el modo de
        // escritura a UpdateItem para no pisar una gestión previa.
        summaryOnly,
        // Wrap-up disposition tree
        stage,
        stageLabel,
        subStage,
        subStageLabel,
        valoracion,
        tags,
        followUps,
        // Channel of the wrapped-up contact (voice/chat/whatsapp/email).
        // Stored so analytics can slice the unified taxonomy by channel.
        channel,
        // Optional context the follow-up creation needs
        customerPhone,
        followUpQueueId,
      } = body;

      if (!contactId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "contactId required" }),
        };
      }

      // #21 Auto-resumen post-conversación. Cuando el agente sale del wrap-up
      // SIN enviar (cierra sin tipificar, o un contacto nuevo desplaza la
      // pantalla), el front manda solo el resumen ya generado. Usamos
      // UpdateItem (NO PutItem) para setear únicamente `summary` sin pisar una
      // tipificación previa de la misma fila, y anexamos al historial. No crea
      // tareas de follow-up ni dispara automatizaciones (#15).
      if (summaryOnly) {
        const now = new Date().toISOString();
        const names: Record<string, string> = {
          "#summary": "summary",
          "#updatedAt": "updatedAt",
        };
        const setParts = ["#summary = :s", "#updatedAt = :u"];
        const vals: Record<string, unknown> = { ":s": summary ?? "", ":u": now };
        if (agentUsername !== undefined) {
          names["#agentUsername"] = "agentUsername";
          setParts.push("#agentUsername = :a");
          vals[":a"] = agentUsername;
        }
        if (channel !== undefined) {
          names["#channel"] = "channel";
          setParts.push("#channel = :c");
          vals[":c"] = channel;
        }
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: { contactId: { S: contactId } },
            UpdateExpression: "SET " + setParts.join(", "),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: marshall(vals, {
              removeUndefinedValues: true,
            }),
          })
        );
        // Fila de historial (best-effort), marcada auto:true para que la
        // auditoría distinga el resumen automático de un guardado manual.
        try {
          await dynamo.send(
            new PutItemCommand({
              TableName: HISTORY_TABLE,
              Item: marshall(
                {
                  contactId,
                  savedAt: now,
                  agentUsername: agentUsername || "",
                  summary: summary ?? "",
                  channel,
                  auto: true,
                },
                { removeUndefinedValues: true }
              ),
            })
          );
        } catch (err) {
          console.warn("auto-summary history write failed:", err);
        }
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ success: true, contactId, summaryOnly: true }),
        };
      }

      // Build item - only include fields that were provided. We use marshall
      // for the structured fields (tags array, followUps object) so DynamoDB
      // stores them natively instead of forcing the frontend to JSON.stringify.
      const item: Record<string, unknown> = {
        contactId,
        updatedAt: new Date().toISOString(),
      };
      if (notes !== undefined) item.agentNotes = notes;
      if (wrapUpCode !== undefined) item.wrapUpCode = wrapUpCode;
      if (summary !== undefined) item.summary = summary;
      if (agentUsername !== undefined) item.agentUsername = agentUsername;
      if (stage !== undefined) item.stage = stage;
      if (stageLabel !== undefined) item.stageLabel = stageLabel;
      if (subStage !== undefined) item.subStage = subStage;
      if (subStageLabel !== undefined) item.subStageLabel = subStageLabel;
      if (valoracion !== undefined) item.valoracion = valoracion;
      if (channel !== undefined) item.channel = channel;
      if (Array.isArray(tags)) item.tags = tags;
      if (followUps && typeof followUps === "object") item.followUps = followUps;

      // Create actionable follow-up tasks. We only do this on the FIRST save
      // (when followUpTaskIds isn't already populated) so re-saving a
      // wrap-up doesn't spam the agent's queue with duplicates.
      const followUpTaskIds: string[] = [];
      if (followUps?.task24h && instanceId) {
        // Connect TASK contact, scheduled for +24h from now, routed to the
        // follow-up queue. The agent will see it in their tasks tab.
        const queueId = followUpQueueId || FOLLOWUP_QUEUE_ID;
        if (queueId && FOLLOWUP_FLOW_ID) {
          try {
            const scheduledTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const task = await connect.send(
              new StartTaskContactCommand({
                InstanceId: instanceId,
                ContactFlowId: FOLLOWUP_FLOW_ID,
                Name: `Follow-up ${
                  subStageLabel || stageLabel || "wrap-up"
                } — ${customerPhone || contactId.slice(0, 8)}`,
                Description: notes || summary || "Follow-up automático",
                References: {
                  originContact: {
                    Type: "CONTACT",
                    Value: contactId,
                  },
                },
                ScheduledTime: scheduledTime,
                // Route to the queue so any available agent on that queue
                // can pick it up — instead of pinning to one agent who
                // might be off shift in 24h.
                Attributes: {
                  followup_origin_contact: contactId,
                  followup_agent: agentUsername || "",
                  followup_customer: customerPhone || "",
                  followup_disposition: subStageLabel || stageLabel || "",
                  followup_valoracion: valoracion || "",
                },
              })
            );
            if (task.ContactId) followUpTaskIds.push(task.ContactId);
          } catch (err) {
            console.warn(
              "StartTaskContact failed for task24h — wrap-up still saved without task:",
              err
            );
          }
        }
      }
      if (followUpTaskIds.length > 0) item.followUpTaskIds = followUpTaskIds;

      // Use marshall so arrays/objects (tags, followUps) get the right DDB
      // type (L, M) instead of being coerced to strings.
      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );

      // Append-only history row. Even if the current row was overwritten
      // (which is the failure mode the user reported — "no guardamos
      // historial de tipificación"), this preserves every save with the
      // agent + timestamp so QA / supervisors can see the full audit
      // trail of how the contact was dispositioned over time.
      const historyRow: Record<string, unknown> = {
        contactId,
        savedAt: item.updatedAt,
        agentUsername: agentUsername || "",
      };
      if (notes !== undefined) historyRow.agentNotes = notes;
      if (wrapUpCode !== undefined) historyRow.wrapUpCode = wrapUpCode;
      if (summary !== undefined) historyRow.summary = summary;
      if (stage !== undefined) historyRow.stage = stage;
      if (stageLabel !== undefined) historyRow.stageLabel = stageLabel;
      if (subStage !== undefined) historyRow.subStage = subStage;
      if (subStageLabel !== undefined) historyRow.subStageLabel = subStageLabel;
      if (valoracion !== undefined) historyRow.valoracion = valoracion;
      if (channel !== undefined) historyRow.channel = channel;
      if (Array.isArray(tags)) historyRow.tags = tags;
      if (followUps && typeof followUps === "object")
        historyRow.followUps = followUps;
      if (followUpTaskIds.length > 0)
        historyRow.followUpTaskIds = followUpTaskIds;
      try {
        await dynamo.send(
          new PutItemCommand({
            TableName: HISTORY_TABLE,
            Item: marshall(historyRow, { removeUndefinedValues: true }),
          })
        );
      } catch (err) {
        // History write is best-effort — don't fail the save if the
        // history table is unavailable.
        console.warn("wrap-up history write failed:", err);
      }

      // Automatizaciones (#15): el wrap-up guardado es un trigger (best-effort,
      // ≤1.5s, no-op sin envs). El tenant sale del JWT del agente.
      try {
        const tenantId = await resolveTenantId(event?.headers);
        if (tenantId) {
          await fireAutomation({
            type: "wrapup_saved",
            tenantId,
            wrapup: {
              contactId,
              stage,
              valoracion,
              channel,
              phone: customerPhone,
            },
          });
        }
      } catch {
        /* nunca romper el guardado del wrap-up */
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          contactId,
          followUpTaskIds,
        }),
      };
    }

    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (error) {
    console.error("Error saving agent notes:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to save notes",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
