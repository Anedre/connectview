import { describe, it, expect } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";
import { evaluateSend } from "../../amplify/functions/_shared/suppression";

/**
 * Red de seguridad para el GATE de supresión (`_shared/suppression.ts`) — la
 * causa raíz de la peor clase de regresión del proyecto: al tocar la lib y NO
 * re-desplegar los 6 Lambdas que la bundlean, el `hardVerdict` viejo etiquetaba
 * `converted` como `dnc`. Estos tests fijan el veredicto SIN AWS: un fake dynamo
 * devuelve la entrada de supresión + reglas vacías. Se usa `channel:"voice"`
 * para evitar el query de frecuencia (solo aplica a WhatsApp). Fase 1 · F1.8.
 */

// Fake DynamoDBClient mínimo: resuelve GetItem de la tabla de supresión (Key.phone)
// y de reglas (Key.tenantId); cualquier Query (frecuencia) devuelve vacío.
function fakeDynamo(entryByDigits: Record<string, unknown>) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: async (cmd: any) => {
      const key = cmd?.input?.Key || {};
      if (key.phone) {
        const e = entryByDigits[key.phone.S];
        return { Item: e ? marshall(e) : undefined };
      }
      if (key.tenantId) return { Item: marshall({ tenantId: key.tenantId.S }) };
      return { Items: [] };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("evaluateSend (gate de supresión)", () => {
  it("número limpio → permitido", async () => {
    const v = await evaluateSend(fakeDynamo({}), {
      phone: "+51900000001",
      channel: "voice",
      tenantId: "t_test_clean",
    });
    expect(v.allowed).toBe(true);
  });

  it("status 'converted' (all) → bloquea y REPORTA 'converted' (no 'dnc')", async () => {
    // Este es el caso que rompía tras un re-deploy olvidado.
    const dynamo = fakeDynamo({
      "51900000002": { phone: "51900000002", status: "converted", channels: ["all"] },
    });
    const v = await evaluateSend(dynamo, {
      phone: "+51900000002",
      channel: "voice",
      tenantId: "t_test_conv",
    });
    expect(v.allowed).toBe(false);
    expect(v.blockedBy).toBe("converted");
  });

  it("opt-out channel-scoped a WhatsApp NO bloquea voz", async () => {
    const dynamo = fakeDynamo({
      "51900000003": { phone: "51900000003", status: "opted_out", channels: ["whatsapp"] },
    });
    const v = await evaluateSend(dynamo, {
      phone: "+51900000003",
      channel: "voice",
      tenantId: "t_test_scope",
    });
    expect(v.allowed).toBe(true);
  });

  it("DNC 'all' → bloquea y reporta 'dnc'", async () => {
    const dynamo = fakeDynamo({
      "51900000004": { phone: "51900000004", status: "dnc", channels: ["all"] },
    });
    const v = await evaluateSend(dynamo, {
      phone: "+51900000004",
      channel: "voice",
      tenantId: "t_test_dnc",
    });
    expect(v.allowed).toBe(false);
    expect(v.blockedBy).toBe("dnc");
  });
});
