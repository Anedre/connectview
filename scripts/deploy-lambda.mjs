#!/usr/bin/env node
/**
 * deploy-lambda.mjs — Bundle un handler.ts con esbuild y actualiza la
 * función Lambda correspondiente vía AWS CLI.
 *
 * Convención: directorio `amplify/functions/<dir>/handler.ts` se mapea a
 * la función AWS `connectview-<dir>`.
 *
 * Uso:
 *   node scripts/deploy-lambda.mjs campaign-dialer
 *   node scripts/deploy-lambda.mjs create-campaign update-campaign get-live-queue campaign-dialer
 *   node scripts/deploy-lambda.mjs --all-changed
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";
import { createReadStream } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const REGION = process.env.AWS_REGION || "us-east-1";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error("Uso: node scripts/deploy-lambda.mjs <dir1> [<dir2>...]");
  console.error("       node scripts/deploy-lambda.mjs <dir>=<fn-name>");
  console.error("Ej.: node scripts/deploy-lambda.mjs campaign-dialer get-live-queue");
  console.error("Ej.: node scripts/deploy-lambda.mjs process-contact-event=amplify-foo-bar");
  process.exit(1);
}

// Parse "dir=fn-name" pairs. When no =, function name is derived as
// `connectview-<dir>` (the convention for hand-managed Lambdas).
function parseTarget(arg) {
  const idx = arg.indexOf("=");
  if (idx === -1) return { dir: arg, functionName: `connectview-${arg}` };
  return { dir: arg.slice(0, idx), functionName: arg.slice(idx + 1) };
}

async function bundleHandler(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  if (!existsSync(entry)) {
    throw new Error(`No existe: ${entry}`);
  }
  const tmp = mkdtempSync(join(tmpdir(), `lambda-${dir}-`));
  const outFile = join(tmp, "index.js");

  // Build a CommonJS bundle. AWS SDK v3 packages are provided by the Lambda
  // runtime starting with nodejs20.x, so marking them external trims the
  // bundle size dramatically.
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: outFile,
    minify: false,
    sourcemap: false,
    // Por defecto TODO @aws-sdk queda external (lo provee el runtime nodejs20).
    // Con EXTERNAL_OVERRIDE (lista separada por comas) se controla qué queda
    // external y se bundlea el resto — para clientes que NO están en el runtime
    // (p.ej. @aws-sdk/client-cost-explorer): listá todo lo demás como external y
    // ese cliente se empaqueta. Mismo mecanismo que create-lambda.mjs.
    external: process.env.EXTERNAL_OVERRIDE
      ? process.env.EXTERNAL_OVERRIDE.split(",").map((s) => s.trim()).filter(Boolean)
      : [
          "@aws-sdk/*",
          "aws-sdk",
          // Built-in / runtime-provided modules
          "node:*",
        ],
    logLevel: "warning",
  });

  // Zip — use PowerShell on Windows since 'zip' isn't always present.
  const zipPath = join(tmp, "bundle.zip");
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`,
      { stdio: "ignore" }
    );
  } else {
    execSync(`cd ${tmp} && zip -j ${zipPath} ${outFile}`, { stdio: "ignore" });
  }

  const stat = statSync(zipPath);
  return { zipPath, size: stat.size, tmp };
}

function awsUpdateFunctionCode(functionName, zipPath) {
  // Use --zip-file fileb:// to upload the binary
  const cmd = [
    "aws",
    "lambda",
    "update-function-code",
    "--function-name",
    functionName,
    "--zip-file",
    `fileb://${zipPath}`,
    "--region",
    REGION,
    "--no-cli-pager",
    "--output",
    "json",
  ];
  console.log("→ Ejecutando:", cmd.slice(0, 6).join(" "), "…");
  const out = execSync(cmd.join(" "), { stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out.toString());
}

const summary = [];
for (const arg of argv) {
  const { dir, functionName } = parseTarget(arg);
  console.log(`\n📦 Bundling ${dir}…`);
  let tmpDir = null;
  try {
    const { zipPath, size, tmp } = await bundleHandler(dir);
    tmpDir = tmp;
    console.log(`   bundle size: ${(size / 1024).toFixed(1)} KB`);

    console.log(`🚀 Actualizando ${functionName}…`);
    const result = awsUpdateFunctionCode(functionName, zipPath);
    console.log(`   ✅ LastModified: ${result.LastModified}`);
    console.log(`   ✅ CodeSize:     ${result.CodeSize} bytes`);
    console.log(`   ✅ Version:      ${result.Version}`);
    summary.push({ dir, functionName, status: "ok", lastModified: result.LastModified });
  } catch (err) {
    console.error(`   ❌ Falló:`, err.message || err);
    summary.push({ dir, status: "error", error: String(err.message || err) });
  } finally {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

console.log("\n╔══════════════════════════════════════════════════════════");
console.log("║ Resumen del deploy");
console.log("╠══════════════════════════════════════════════════════════");
for (const r of summary) {
  if (r.status === "ok") {
    console.log(`║ ✅ ${r.functionName} · ${r.lastModified}`);
  } else {
    console.log(`║ ❌ ${r.dir} · ${r.error}`);
  }
}
console.log("╚══════════════════════════════════════════════════════════");

const failed = summary.filter((s) => s.status === "error");
process.exit(failed.length > 0 ? 1 : 0);

// Silence unused import warning
void createReadStream;
