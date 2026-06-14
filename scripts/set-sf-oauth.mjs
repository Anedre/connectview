#!/usr/bin/env node
/**
 * set-sf-oauth.mjs — agrega las credenciales OAuth web (Connected App / External
 * Client App compartida) al secret `connectview/salesforce`, SIN pisar las
 * credenciales JWT que ya estaban (consumerKey/username/privateKey/audience).
 *
 * Uso (CMD / PowerShell / bash):
 *   node scripts/set-sf-oauth.mjs "CONSUMER_KEY" "CONSUMER_SECRET"
 *
 * Imprime solo los NOMBRES de los campos (nunca los valores) para confirmar.
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const [key, secret] = process.argv.slice(2);
if (!key || !secret) {
  console.error('Uso: node scripts/set-sf-oauth.mjs "CONSUMER_KEY" "CONSUMER_SECRET"');
  process.exit(1);
}

const REGION = process.env.AWS_REGION || "us-east-1";
const SECRET_ID = "connectview/salesforce";
const sm = new SecretsManagerClient({ region: REGION });

const cur = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
const obj = JSON.parse(cur.SecretString || "{}");
obj.oauthConsumerKey = key.trim();
obj.oauthConsumerSecret = secret.trim();
await sm.send(
  new PutSecretValueCommand({ SecretId: SECRET_ID, SecretString: JSON.stringify(obj) })
);

console.log("OK ✓ — secret connectview/salesforce actualizado.");
console.log("Campos presentes ahora:", Object.keys(obj).join(", "));
console.log(
  "OAuth web listo:",
  !!obj.oauthConsumerKey && !!obj.oauthConsumerSecret,
  "| JWT preservado:",
  !!obj.consumerKey && !!obj.privateKey
);
