#!/usr/bin/env node
/**
 * dryrun-workflow-engine.mjs — prueba E2E del motor unificado (Fase 2) en DRY-RUN,
 * SIN enviar nada y SIN tocar datos reales. Siembra 2 workflows de prueba (un
 * reflejo y un recorrido) en un tenant aislado, invoca el Lambda con un evento y
 * verifica:
 *   1) el reflejo ejecuta sus efectos y TERMINA (sin estado),
 *   2) el recorrido inscribe UN enrollment (efecto + descanso en la espera),
 *   3) re-disparar el MISMO evento NO re-inscribe (idempotencia = anti-doble).
 * Limpia todo al final (borra los workflows + el enrollment de prueba).
 *
 * Uso: node scripts/dryrun-workflow-engine.mjs
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const REGION = "us-east-1";
const FN = "connectview-workflow-engine";
const T_WORKFLOWS = "connectview-workflows";
const T_ENROLLMENTS = "connectview-workflow-enrollments";
const TENANT = "t_dryrun_wf";
const LEAD = "L_dryrun_wf";
const dynamo = new DynamoDBClient({ region: REGION });
const tmp = mkdtempSync(join(tmpdir(), "wf-dryrun-"));

const reflex = {
  tenantId: TENANT,
  workflowId: "wf_dry_reflex",
  name: "[dryrun] reflejo",
  status: "active",
  trigger: { kind: "event", type: "lead_created", params: {} },
  nodes: [
    { id: "e", kind: "entry" },
    { id: "s", kind: "send_whatsapp", params: { templateName: "bienvenida" } },
    { id: "x", kind: "exit" },
  ],
  edges: [
    { from: "e", to: "s" },
    { from: "s", to: "x" },
  ],
};
const recorrido = {
  tenantId: TENANT,
  workflowId: "wf_dry_journey",
  name: "[dryrun] recorrido",
  status: "active",
  trigger: { kind: "event", type: "lead_created", params: {} },
  nodes: [
    { id: "e", kind: "entry" },
    { id: "s", kind: "send_whatsapp", params: { templateName: "hola" } },
    { id: "w", kind: "wait", params: { days: 2 } },
    { id: "s2", kind: "send_email", params: { subject: "seguimos" } },
    { id: "x", kind: "exit" },
  ],
  edges: [
    { from: "e", to: "s" },
    { from: "s", to: "w" },
    { from: "w", to: "s2" },
    { from: "s2", to: "x" },
  ],
};

function invoke(payload) {
  const inPath = join(tmp, "in.json");
  const outPath = join(tmp, "out.json");
  writeFileSync(inPath, JSON.stringify(payload));
  execSync(
    `aws lambda invoke --region ${REGION} --function-name ${FN} --payload fileb://${inPath} --cli-binary-format raw-in-base64-out ${outPath} --no-cli-pager`,
    { stdio: "ignore" },
  );
  return JSON.parse(readFileSync(outPath, "utf8"));
}

const ok = [];
const fail = [];
const check = (name, cond, detail) => (cond ? ok : fail).push(`${name}${detail ? " · " + detail : ""}`);

try {
  console.log("· Sembrando 2 workflows de prueba (tenant aislado)…");
  for (const w of [reflex, recorrido]) {
    await dynamo.send(new PutItemCommand({ TableName: T_WORKFLOWS, Item: marshall(w) }));
  }

  const ev = {
    event: { type: "lead_created", tenantId: TENANT, ctx: { leadId: LEAD, source: "dryrun" } },
  };

  console.log("· Disparo #1 (evento lead_created)…");
  const r1 = invoke(ev);
  console.log("  →", JSON.stringify(r1));
  check("dry-run activo", r1.dryRun === true);
  check("matchean 2 workflows", r1.matched === 2, `matched=${r1.matched}`);
  check("el recorrido inscribe 1", r1.enrolled === 1, `enrolled=${r1.enrolled}`);
  check(
    "2 efectos, todos [dry] (nada real)",
    r1.effects.length === 2 && r1.effects.every((e) => e.startsWith("[dry]")),
    r1.effects.join(" | "),
  );

  console.log("· Disparo #2 (mismo evento) → idempotencia…");
  const r2 = invoke(ev);
  console.log("  →", JSON.stringify(r2));
  check("re-disparo NO re-inscribe (anti-doble)", r2.enrolled === 0, `enrolled=${r2.enrolled}`);

  console.log("· Verificando el enrollment persistido (recorrido)…");
  const enr = await dynamo.send(
    new GetItemCommand({
      TableName: T_ENROLLMENTS,
      Key: marshall({ workflowId: "wf_dry_journey", leadId: LEAD }),
    }),
  );
  const e = enr.Item ? unmarshall(enr.Item) : null;
  check("enrollment activo con nextRunAt futuro", !!e && e.status === "active" && Date.parse(e.nextRunAt) > Date.now(), e ? `next=${e.nextRunAt}` : "sin enrollment");
} catch (err) {
  fail.push("EXCEPCIÓN: " + (err.message || err));
} finally {
  console.log("· Limpiando datos de prueba…");
  try {
    await dynamo.send(new DeleteItemCommand({ TableName: T_WORKFLOWS, Key: marshall({ tenantId: TENANT, workflowId: "wf_dry_reflex" }) }));
    await dynamo.send(new DeleteItemCommand({ TableName: T_WORKFLOWS, Key: marshall({ tenantId: TENANT, workflowId: "wf_dry_journey" }) }));
    await dynamo.send(new DeleteItemCommand({ TableName: T_ENROLLMENTS, Key: marshall({ workflowId: "wf_dry_journey", leadId: LEAD }) }));
  } catch (e) {
    console.warn("  (cleanup parcial:", e.message, ")");
  }
  rmSync(tmp, { recursive: true, force: true });
}

console.log("\n── Resultado ──");
for (const o of ok) console.log("  ✅ " + o);
for (const f of fail) console.log("  ❌ " + f);
console.log(`\n${fail.length === 0 ? "✅ DRY-RUN OK" : "❌ FALLARON " + fail.length}  (${ok.length}/${ok.length + fail.length})`);
process.exitCode = fail.length ? 1 : 0;
