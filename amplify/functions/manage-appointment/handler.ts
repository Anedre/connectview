import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveDynamo } from "../_shared/tenantConnect";
import { getIdentity } from "../_shared/cognitoAuth";
import { fireAutomation } from "../_shared/automationHook";

/**
 * manage-appointment — native appointment scheduling (roadmap #26). Agents
 * (or the Coach via a CTA) book a future appointment with a customer; it
 * shows in the agent's list and can later sync to Google Calendar. Stored en
 * connectview-appointments (en la cuenta del CLIENTE si activó BYO Data
 * Plane #46; si no, en la pooled de Vox como fallback).
 *
 * GET                  → list (optionally ?agent= / ?phone= / upcoming only)
 * POST { customerPhone, customerName?, whenISO, durationMin?, agent?, notes?, channel? } → create
 * POST { action:"status", apptId, status } → set scheduled|done|cancelled|no_show
 * DELETE ?apptId=ID
 */
const legacyDynamo = new DynamoDBClient({});
const TABLE = process.env.APPTS_TABLE || "connectview-appointments";
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ error: e }) });

interface Appt {
  apptId: string;
  customerPhone: string;
  customerName?: string;
  title?: string;
  whenISO: string;
  durationMin?: number;
  agent?: string;
  notes?: string;
  channel?: string;
  status: string;
  createdAt?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  const params = event.queryStringParameters || {};

  // BYO Data Plane (#46): si el tenant aplicó el template y tiene tablas en
  // SU cuenta, `dynamo` pega a la tabla del cliente vía assume-role. Si no,
  // cae al cliente legacy → tabla pooled de Vox. La feature es opt-in y
  // per-tenant: cero migración de datos al flip.
  const { dynamo } = await resolveDynamo(event?.headers, legacyDynamo);

  try {
    if (method === "GET") {
      const out: Appt[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const res = await dynamo.send(
          new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never })
        );
        for (const it of res.Items || []) out.push(unmarshall(it) as Appt);
        lastKey = res.LastEvaluatedKey;
      } while (lastKey);
      let appts = out;
      if (params.agent) appts = appts.filter((a) => a.agent === params.agent);
      if (params.phone) appts = appts.filter((a) => a.customerPhone === params.phone);
      if (params.upcoming === "true") {
        const now = new Date().toISOString();
        appts = appts.filter((a) => a.whenISO >= now && a.status === "scheduled");
      }
      appts.sort((a, b) => (a.whenISO || "").localeCompare(b.whenISO || ""));
      return ok({ appointments: appts });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");

      if (body.action === "status") {
        if (!body.apptId || !body.status) return bad(400, "apptId and status required");
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { apptId: { S: body.apptId } },
            UpdateExpression: "SET #s = :s",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":s": { S: String(body.status) } },
          })
        );
        return ok({ updated: true, apptId: body.apptId, status: body.status });
      }

      // Reschedule (drag-to-move / resize on the calendar): update whenISO and
      // optionally durationMin. Keeps everything else intact.
      if (body.action === "reschedule") {
        if (!body.apptId || !body.whenISO) return bad(400, "apptId and whenISO required");
        const values: Record<string, { S?: string; N?: string }> = { ":w": { S: String(body.whenISO) } };
        let expr = "SET whenISO = :w";
        if (typeof body.durationMin === "number") {
          expr += ", durationMin = :d";
          values[":d"] = { N: String(body.durationMin) };
        }
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { apptId: { S: String(body.apptId) } },
            UpdateExpression: expr,
            ExpressionAttributeValues: values,
          })
        );
        return ok({ updated: true, apptId: body.apptId, whenISO: body.whenISO });
      }

      // Edit fields in place (asunto/título, notas, nombre) without moving the slot.
      if (body.action === "update") {
        if (!body.apptId) return bad(400, "apptId required");
        const names: Record<string, string> = {};
        const values: Record<string, { S: string }> = {};
        const sets: string[] = [];
        const set = (field: string, val: unknown) => {
          if (typeof val !== "string") return;
          names[`#${field}`] = field;
          values[`:${field}`] = { S: val };
          sets.push(`#${field} = :${field}`);
        };
        set("title", body.title);
        set("notes", body.notes);
        set("customerName", body.customerName);
        if (!sets.length) return bad(400, "nothing to update");
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { apptId: { S: String(body.apptId) } },
            UpdateExpression: `SET ${sets.join(", ")}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          })
        );
        return ok({ updated: true, apptId: body.apptId });
      }

      if (!body.customerPhone || !body.whenISO) {
        return bad(400, "customerPhone and whenISO required");
      }
      const appt: Appt = {
        apptId: randomUUID(),
        customerPhone: String(body.customerPhone),
        customerName: body.customerName,
        title: body.title,
        whenISO: String(body.whenISO),
        durationMin: typeof body.durationMin === "number" ? body.durationMin : 30,
        agent: body.agent,
        notes: body.notes,
        channel: body.channel,
        status: "scheduled",
        createdAt: new Date().toISOString(),
      };
      await dynamo.send(
        new PutItemCommand({ TableName: TABLE, Item: marshall(appt, { removeUndefinedValues: true }) })
      );
      // Automatizaciones (#15): agendar una cita es un trigger. Best-effort — el
      // tenantId sale del JWT; si no hay (CTA server-to-server sin token), se
      // omite el disparo (fireAutomation es no-op sin tenantId). Fire-and-forget.
      try {
        const id = await getIdentity(event.headers);
        if (id?.tenantId) {
          await fireAutomation({
            type: "appointment_scheduled",
            tenantId: id.tenantId,
            lead: { phone: appt.customerPhone, name: appt.customerName },
          });
        }
      } catch {
        /* sin identidad → no disparamos (aditivo, no rompe el agendado) */
      }
      return ok({ appointment: appt, created: true });
    }

    if (method === "DELETE") {
      if (!params.apptId) return bad(400, "apptId required");
      await dynamo.send(
        new DeleteItemCommand({ TableName: TABLE, Key: { apptId: { S: params.apptId } } })
      );
      return ok({ deleted: true, apptId: params.apptId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-appointment error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
