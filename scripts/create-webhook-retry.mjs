#!/usr/bin/env node
/**
 * create-webhook-retry.mjs — provisiona la infra de #17 (webhooks salientes con
 * retry durable). Idempotente: crea-o-actualiza. Recursos (todos connectview-*,
 * us-east-1, rol compartido connectview-campaign-lambda-role):
 *
 *   · SQS connectview-webhook-queue (+ DLQ connectview-webhook-dlq, maxReceive 3)
 *   · DynamoDB connectview-webhook-deliveries (GSI byStatusNextAttempt + TTL)
 *   · Lambda connectview-webhook-dispatcher  (trigger SQS + tick EventBridge 5min)
 *   · Lambda connectview-get-webhook-deliveries (Function URL pública)
 *   · IAM inline policy (sqs + dynamodb) en el rol compartido
 *   · merge de WEBHOOK_QUEUE_URL en el env de connectview-automation-engine
 *
 * Uso: node scripts/create-webhook-retry.mjs
 */
import { execSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REGION = "us-east-1";
const ACCOUNT = "731736972577";
const ROLE = `arn:aws:iam::${ACCOUNT}:role/connectview-campaign-lambda-role`;
const ROLE_NAME = "connectview-campaign-lambda-role";

const QUEUE = "connectview-webhook-queue";
const DLQ = "connectview-webhook-dlq";
const TABLE = "connectview-webhook-deliveries";
const DISPATCHER = "connectview-webhook-dispatcher";
const GETTER = "connectview-get-webhook-deliveries";
const TICK_RULE = "connectview-webhook-retry-tick";
const ENGINE = "connectview-automation-engine";

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "whr-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `whr-${dir}-`));
  const outFile = join(tmp, "index.js");
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", target: "node20",
    format: "cjs", outfile: outFile, external: ["@aws-sdk/*", "aws-sdk", "node:*"],
    logLevel: "warning",
  });
  const zipPath = join(tmp, "bundle.zip");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`, { stdio: "ignore" });
  log(`  📦 ${dir}: ${(statSync(zipPath).size / 1024).toFixed(1)} KB`);
  return zipPath;
}

function queueUrlArn(name) {
  const url = sh(`aws sqs get-queue-url --queue-name ${name} --region ${REGION} --query QueueUrl --output text`);
  const arn = sh(`aws sqs get-queue-attributes --queue-url ${url} --attribute-names QueueArn --region ${REGION} --query "Attributes.QueueArn" --output text`);
  return { url, arn };
}

async function ensureLambda(name, dir, envObj, timeout = 30) {
  const zip = await bundle(dir);
  const exists = quiet(`aws lambda get-function --function-name ${name} --region ${REGION}`);
  const envFile = writeTmp("env.json", { Variables: envObj });
  if (exists) {
    sh(`aws lambda update-function-code --function-name ${name} --zip-file fileb://${zip} --region ${REGION} --no-cli-pager`);
    // esperar a que termine el update de código antes de tocar config
    quiet(`aws lambda wait function-updated --function-name ${name} --region ${REGION}`);
    sh(`aws lambda update-function-configuration --function-name ${name} --environment file://${envFile} --timeout ${timeout} --region ${REGION} --no-cli-pager`);
    log(`  ✅ ${name} (actualizado)`);
  } else {
    sh(`aws lambda create-function --function-name ${name} --runtime nodejs20.x --role ${ROLE} --handler index.handler --zip-file fileb://${zip} --timeout ${timeout} --memory-size 256 --environment file://${envFile} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-active --function-name ${name} --region ${REGION}`);
    log(`  ✅ ${name} (creado)`);
  }
}

(async () => {
  log("── #17 webhooks retry — provisioning ──\n");

  // 1) DLQ + cola principal con redrive
  log("1) SQS…");
  quiet(`aws sqs create-queue --queue-name ${DLQ} --region ${REGION}`);
  const dlq = queueUrlArn(DLQ);
  quiet(`aws sqs create-queue --queue-name ${QUEUE} --region ${REGION}`);
  const q = queueUrlArn(QUEUE);
  // redrive → DLQ (maxReceiveCount 3) + visibility 60s (> timeout del lambda)
  const redrive = JSON.stringify({ deadLetterTargetArn: dlq.arn, maxReceiveCount: "3" });
  const attrFile = writeTmp("attrs.json", { RedrivePolicy: redrive, VisibilityTimeout: "120" });
  sh(`aws sqs set-queue-attributes --queue-url ${q.url} --attributes file://${attrFile} --region ${REGION}`);
  log(`   queue: ${q.url}`);

  // 2) tabla de deliveries (+ GSI + TTL)
  log("2) DynamoDB…");
  if (!quiet(`aws dynamodb describe-table --table-name ${TABLE} --region ${REGION}`)) {
    sh([
      "aws dynamodb create-table",
      `--table-name ${TABLE}`,
      "--attribute-definitions AttributeName=deliveryId,AttributeType=S AttributeName=status,AttributeType=S AttributeName=nextAttemptAt,AttributeType=S",
      "--key-schema AttributeName=deliveryId,KeyType=HASH",
      "--billing-mode PAY_PER_REQUEST",
      `--global-secondary-indexes "IndexName=byStatusNextAttempt,KeySchema=[{AttributeName=status,KeyType=HASH},{AttributeName=nextAttemptAt,KeyType=RANGE}],Projection={ProjectionType=ALL}"`,
      `--region ${REGION} --no-cli-pager`,
    ].join(" "));
    quiet(`aws dynamodb wait table-exists --table-name ${TABLE} --region ${REGION}`);
    quiet(`aws dynamodb update-time-to-live --table-name ${TABLE} --time-to-live-specification "Enabled=true,AttributeName=ttl" --region ${REGION}`);
    log(`   tabla ${TABLE} creada`);
  } else {
    log(`   tabla ${TABLE} ya existe`);
  }
  const tableArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`;

  // 3) IAM: sqs + dynamodb en el rol compartido
  log("3) IAM…");
  const policy = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource: [q.arn, dlq.arn] },
      { Effect: "Allow", Action: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:Scan"], Resource: [tableArn, `${tableArn}/index/*`] },
    ],
  };
  const polFile = writeTmp("policy.json", policy);
  sh(`aws iam put-role-policy --role-name ${ROLE_NAME} --policy-name connectview-webhook-retry --policy-document file://${polFile}`);
  log("   policy connectview-webhook-retry adjunta");

  // 4) dispatcher (SQS + tick)
  log("4) dispatcher…");
  await ensureLambda(DISPATCHER, "webhook-dispatcher", { DELIVERIES_TABLE: TABLE, WEBHOOK_QUEUE_URL: q.url }, 30);
  // event source mapping SQS → dispatcher (idempotente)
  const esmList = tryjson(`aws lambda list-event-source-mappings --function-name ${DISPATCHER} --event-source-arn ${q.arn} --region ${REGION}`);
  if (!esmList || (esmList.EventSourceMappings || []).length === 0) {
    quiet(`aws lambda create-event-source-mapping --function-name ${DISPATCHER} --event-source-arn ${q.arn} --batch-size 5 --region ${REGION} --no-cli-pager`);
    log("   ESM SQS→dispatcher creado");
  } else {
    log("   ESM SQS→dispatcher ya existe");
  }
  // EventBridge tick (rate 5 min) → dispatcher
  sh(`aws events put-rule --name ${TICK_RULE} --schedule-expression "rate(5 minutes)" --region ${REGION} --no-cli-pager`);
  quiet(`aws lambda add-permission --function-name ${DISPATCHER} --statement-id ${TICK_RULE} --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:${REGION}:${ACCOUNT}:rule/${TICK_RULE} --region ${REGION}`);
  const tgtFile = writeTmp("targets.json", [{ Id: "dispatcher", Arn: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${DISPATCHER}`, Input: "{}" }]);
  sh(`aws events put-targets --rule ${TICK_RULE} --targets file://${tgtFile} --region ${REGION} --no-cli-pager`);
  log("   tick EventBridge (5 min) → dispatcher");

  // 5) getter + Function URL
  log("5) get-webhook-deliveries…");
  await ensureLambda(GETTER, "get-webhook-deliveries", { DELIVERIES_TABLE: TABLE }, 15);
  let furl = tryjson(`aws lambda get-function-url-config --function-name ${GETTER} --region ${REGION}`);
  if (!furl) {
    furl = tryjson(`aws lambda create-function-url-config --function-name ${GETTER} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION}`);
    // OJO: esta cuenta requiere AMBOS statements para una Function URL pública
    // (InvokeFunctionUrl + InvokeFunction) — si falta el segundo, da 403.
    quiet(`aws lambda add-permission --function-name ${GETTER} --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${GETTER} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal "*" --region ${REGION}`);
  }
  const getUrl = furl?.FunctionUrl || "(re-correr para ver la URL)";
  log(`   Function URL: ${getUrl}`);

  // 6) merge WEBHOOK_QUEUE_URL en el env del automation-engine
  log("6) automation-engine env…");
  const cfg = tryjson(`aws lambda get-function-configuration --function-name ${ENGINE} --region ${REGION}`);
  if (cfg) {
    const vars = { ...(cfg.Environment?.Variables || {}), WEBHOOK_QUEUE_URL: q.url };
    const ef = writeTmp("engine-env.json", { Variables: vars });
    quiet(`aws lambda wait function-updated --function-name ${ENGINE} --region ${REGION}`);
    sh(`aws lambda update-function-configuration --function-name ${ENGINE} --environment file://${ef} --region ${REGION} --no-cli-pager`);
    log("   WEBHOOK_QUEUE_URL agregado (env existente preservado)");
  } else {
    log(`   ⚠️ ${ENGINE} no encontrado — setear WEBHOOK_QUEUE_URL manualmente`);
  }

  log("\n✅ Provisioning completo.");
  log(`   getWebhookDeliveries URL → ${getUrl}`);
  log("   Recordá: re-deployar automation-engine si cambió su código (node scripts/deploy-lambda.mjs automation-engine=...)");
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
