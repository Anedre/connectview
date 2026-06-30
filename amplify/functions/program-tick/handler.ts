import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

/**
 * program-tick — auto-archivado de programas vencidos (Pilar 1, Fase C).
 * Disparado por EventBridge (rate 1h). Archiva los programas cuya `endDate` ya
 * pasó (salvo `autoArchive === false`), cerrando su ciclo de vida sin que nadie
 * lo haga a mano (los programas de UDEP duran ~3 meses). Corre con el rol de
 * ejecución (pooled Vox); el multi-tenant queda para una iteración futura.
 */

const dynamo = new DynamoDBClient({});
const TABLE = process.env.PROGRAMS_TABLE || "connectview-programs";

interface ProgramRow {
  programId: string;
  status?: string;
  endDate?: string;
  autoArchive?: boolean;
}

export const handler: Handler = async () => {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  let scanned = 0;
  let archived = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await dynamo.send(
      new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never })
    );
    for (const it of res.Items || []) {
      scanned++;
      const p = unmarshall(it) as ProgramRow;
      if (p.status === "archivado") continue;
      if (p.autoArchive === false) continue;
      if (!p.endDate) continue;
      const end = new Date(p.endDate).getTime();
      if (Number.isNaN(end) || end >= nowMs) continue; // aún vigente

      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { programId: { S: p.programId } },
          UpdateExpression:
            "SET #s = :a, archivedAt = if_not_exists(archivedAt, :now), updatedAt = :now",
          ExpressionAttributeNames: { "#s": "status" }, // "status" es reservado
          ExpressionAttributeValues: { ":a": { S: "archivado" }, ":now": { S: nowIso } },
        })
      );
      archived++;
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(`program-tick: scanned=${scanned} archived=${archived}`);
  return { ok: true, scanned, archived };
};
