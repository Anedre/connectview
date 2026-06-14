#!/usr/bin/env node
/**
 * create-lambda.mjs — Crea (no actualiza) una función Lambda connectview-<dir>
 * desde amplify/functions/<dir>/handler.ts, reusando un rol existente, y le
 * agrega un Function URL público (auth NONE + CORS *). Para Lambdas nuevos
 * manejados a mano (los existentes se actualizan con deploy-lambda.mjs).
 *
 * Uso:
 *   node scripts/create-lambda.mjs <dir> [KEY=VAL ...]
 *   node scripts/create-lambda.mjs manage-connections CONNECTIONS_TABLE=connectview-connections
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REGION = process.env.AWS_REGION || "us-east-1";
const ROLE_ARN =
  process.env.LAMBDA_ROLE_ARN ||
  "arn:aws:iam::731736972577:role/connectview-campaign-lambda-role";

const [dir, ...envPairs] = process.argv.slice(2);
if (!dir) {
  console.error("Uso: node scripts/create-lambda.mjs <dir> [KEY=VAL ...]");
  process.exit(1);
}
const functionName = `connectview-${dir}`;
const envVars = envPairs
  .map((p) => p.split("="))
  .filter((kv) => kv.length === 2)
  .map(([k, v]) => `${k}=${v}`)
  .join(",");

async function bundle() {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  if (!existsSync(entry)) throw new Error(`No existe: ${entry}`);
  const tmp = mkdtempSync(join(tmpdir(), `lambda-${dir}-`));
  const outFile = join(tmp, "index.js");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: outFile,
    external: ["@aws-sdk/*", "aws-sdk", "node:*"],
    logLevel: "warning",
  });
  const zipPath = join(tmp, "bundle.zip");
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`,
      { stdio: "ignore" }
    );
  } else {
    execSync(`cd ${tmp} && zip -j ${zipPath} ${outFile}`, { stdio: "ignore" });
  }
  return { zipPath, size: statSync(zipPath).size, tmp };
}

function aws(args) {
  return execSync(["aws", ...args, "--region", REGION, "--no-cli-pager", "--output", "json"].join(" "), {
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

let tmpDir = null;
try {
  console.log(`📦 Bundling ${dir}…`);
  const { zipPath, size, tmp } = await bundle();
  tmpDir = tmp;
  console.log(`   bundle: ${(size / 1024).toFixed(1)} KB`);

  console.log(`🚀 create-function ${functionName}…`);
  const created = JSON.parse(
    aws([
      "lambda", "create-function",
      "--function-name", functionName,
      "--runtime", "nodejs20.x",
      "--role", ROLE_ARN,
      "--handler", "index.handler",
      "--zip-file", `fileb://${zipPath}`,
      "--timeout", "15",
      "--memory-size", "256",
      ...(envVars ? ["--environment", `Variables={${envVars}}`] : []),
    ])
  );
  console.log(`   ✅ ${created.FunctionArn} (${created.State})`);

  console.log(`🔗 Function URL (auth NONE)…`);
  // CORS lo maneja el handler (devuelve headers + responde OPTIONS), así no
  // peleamos con el escapado de JSON en --cors a través del shell.
  const urlCfg = JSON.parse(
    aws([
      "lambda", "create-function-url-config",
      "--function-name", functionName,
      "--auth-type", "NONE",
    ])
  );
  // Function URL público requiere DOS permisos (gotcha conocido):
  //   1) lambda:InvokeFunctionUrl con condición FunctionUrlAuthType=NONE
  //   2) lambda:InvokeFunction (sin condición)
  aws([
    "lambda", "add-permission",
    "--function-name", functionName,
    "--statement-id", "FunctionURLAllowPublicAccess",
    "--action", "lambda:InvokeFunctionUrl",
    "--principal", "*",
    "--function-url-auth-type", "NONE",
  ]);
  aws([
    "lambda", "add-permission",
    "--function-name", functionName,
    "--statement-id", "AllowInvokeFromURL",
    "--action", "lambda:InvokeFunction",
    "--principal", "*",
  ]);

  console.log("\n╔══════════════════════════════════════════════");
  console.log(`║ ✅ ${functionName}`);
  console.log(`║ URL: ${urlCfg.FunctionUrl}`);
  console.log("╚══════════════════════════════════════════════");
} catch (err) {
  console.error("❌ Falló:", err.message || err);
  process.exitCode = 1;
} finally {
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
