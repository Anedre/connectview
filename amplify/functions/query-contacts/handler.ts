import type { APIGatewayProxyHandler } from "aws-lambda";
import { DynamoDBClient, ScanCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";

// BYO Data Plane (#46): tenant primero, fallback Vox pooled.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";

/** Tope DURO de filas devueltas. Los KPIs de Reportes se calculan sobre estas
 *  filas, así que hay que traer el PERÍODO completo — pero un scan sin tope en
 *  una tabla enorme reventaría el payload/timeout. 5000 cubre un mes activo. */
const HARD_MAX = 5000;
/** Tope de páginas escaneadas: el FilterExpression por fecha no reduce lo que
 *  DynamoDB escanea (solo lo devuelto), así que en tablas grandes hay que acotar
 *  las páginas para no exceder el budget de la Lambda. ~40 MB escaneados máx. */
const MAX_PAGES = 40;

type DdbCommand = ScanCommand | QueryCommand;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // BYO Data Plane (#46): tenant primero, fallback Vox.
    ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
    const params = event.queryStringParameters || {};
    const { startDate, endDate, agentUsername, queueName, sentiment, limit } = params;
    // `limit` explícito = tope pedido por el front (p.ej. una tabla que quiere N);
    // sin `limit` = traer TODO el período (hasta HARD_MAX), para que los KPIs no
    // se calculen sobre una muestra de 50 como antes.
    const cap = limit ? Math.min(Math.max(parseInt(limit) || HARD_MAX, 1), HARD_MAX) : HARD_MAX;

    const makeCommand = (lastKey?: Record<string, unknown>): DdbCommand => {
      if (agentUsername) {
        return new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: "agentUsername-initiationTimestamp-index",
          KeyConditionExpression:
            "agentUsername = :agent" +
            (startDate && endDate ? " AND initiationTimestamp BETWEEN :start AND :end" : ""),
          ExpressionAttributeValues: {
            ":agent": { S: agentUsername },
            ...(startDate && endDate ? { ":start": { S: startDate }, ":end": { S: endDate } } : {}),
          },
          ScanIndexForward: false,
          ExclusiveStartKey: lastKey as never,
        });
      }
      if (queueName) {
        return new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: "queueName-initiationTimestamp-index",
          KeyConditionExpression:
            "queueName = :queue" +
            (startDate && endDate ? " AND initiationTimestamp BETWEEN :start AND :end" : ""),
          ExpressionAttributeValues: {
            ":queue": { S: queueName },
            ...(startDate && endDate ? { ":start": { S: startDate }, ":end": { S: endDate } } : {}),
          },
          ScanIndexForward: false,
          ExclusiveStartKey: lastKey as never,
        });
      }
      // Scan con filtros (menos eficiente pero flexible — no hay GSI por fecha).
      const filterExpressions: string[] = [];
      const expressionValues: Record<string, { S: string }> = {};
      if (startDate && endDate) {
        filterExpressions.push("initiationTimestamp BETWEEN :start AND :end");
        expressionValues[":start"] = { S: startDate };
        expressionValues[":end"] = { S: endDate };
      }
      if (sentiment) {
        filterExpressions.push("sentiment = :sentiment");
        expressionValues[":sentiment"] = { S: sentiment };
      }
      return new ScanCommand({
        TableName: TABLE_NAME,
        ...(filterExpressions.length > 0
          ? {
              FilterExpression: filterExpressions.join(" AND "),
              ExpressionAttributeValues: expressionValues,
            }
          : {}),
        ExclusiveStartKey: lastKey as never,
      });
    };

    // Paginación acotada: acumula hasta `cap` filas o MAX_PAGES páginas.
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    let pages = 0;
    do {
      const result = await dynamo.send(makeCommand(lastKey) as never);
      for (const it of result.Items || []) items.push(it);
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      pages++;
    } while (lastKey && items.length < cap && pages < MAX_PAGES);
    const truncated = !!lastKey && (items.length >= cap || pages >= MAX_PAGES);

    const contacts = items.slice(0, cap).map((item) => unmarshall(item));

    // Sort by timestamp descending
    contacts.sort(
      (a, b) =>
        new Date(b.initiationTimestamp).getTime() - new Date(a.initiationTimestamp).getTime(),
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contacts,
        count: contacts.length,
        truncated,
      }),
    };
  } catch (error) {
    console.error("Error querying contacts:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Failed to query contacts",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
