#!/usr/bin/env node
/**
 * set-sf-oauth-from-file.mjs — igual que set-sf-oauth.mjs pero lee las
 * credenciales de un ARCHIVO (a prueba de comillas/caracteres especiales de CMD).
 *
 * 1. Creá un archivo `sf-creds.txt` en B:\Connectview con DOS líneas:
 *      línea 1 = Consumer Key   (lo que copiás de Salesforce, ~85 chars)
 *      línea 2 = Consumer Secret (lo que copiás de Salesforce, ~64+ chars)
 * 2. Corré:  node B:\Connectview\scripts\set-sf-oauth-from-file.mjs
 * 3. Borrá sf-creds.txt
 *
 * Mergea en el secret connectview/salesforce SIN pisar las creds JWT.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const file = process.argv[2] || join(ROOT, "sf-creds.txt");

if (!existsSync(file)) {
  console.error("✗ No existe el archivo:", file);
  console.error("  Creá sf-creds.txt con el Consumer Key en la línea 1 y el Secret en la línea 2.");
  process.exit(1);
}

const lines = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const [key, secret] = lines;
if (!key || !secret) {
  console.error("✗ El archivo debe tener 2 líneas no vacías: Consumer Key (1) y Consumer Secret (2).");
  process.exit(1);
}

// Validación de cordura — avisa si parecen cortos / si quedó texto de ejemplo.
if (key.includes("...") || secret.includes("...") || key.includes("PEGA") || key.length < 50 || secret.length < 30) {
  console.error("✗ Esos valores parecen de ejemplo o cortados (key len " + key.length + ", secret len " + secret.length + ").");
  console.error("  Un Consumer Key real de Salesforce tiene ~85 chars y el Secret ~64+. NO los guardé.");
  console.error("  Copiá los valores COMPLETOS de la pantalla 'Clave y secreto de consumidor' de Salesforce.");
  process.exit(1);
}

const REGION = process.env.AWS_REGION || "us-east-1";
const sm = new SecretsManagerClient({ region: REGION });
const cur = await sm.send(new GetSecretValueCommand({ SecretId: "connectview/salesforce" }));
const obj = JSON.parse(cur.SecretString || "{}");
obj.oauthConsumerKey = key;
obj.oauthConsumerSecret = secret;
await sm.send(new PutSecretValueCommand({ SecretId: "connectview/salesforce", SecretString: JSON.stringify(obj) }));

console.log("OK ✓ — guardado en connectview/salesforce.");
console.log("Key len:", key.length, "| Secret len:", secret.length, "| JWT preservado:", !!obj.consumerKey && !!obj.privateKey);
console.log("Acordate de BORRAR sf-creds.txt.");
