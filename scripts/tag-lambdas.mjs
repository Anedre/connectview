#!/usr/bin/env node
/**
 * tag-lambdas.mjs — etiqueta cada Lambda `connectview-*` con su capa y dominio,
 * para diferenciar en la consola/facturación el **Núcleo ARIA** (el producto:
 * contact center, campañas, CRM, inbox, IA, admin) de la **capa de Integraciones**
 * (conectores a sistemas externos: Salesforce, WhatsApp/Meta, Mercado Libre, la
 * conexión BYO a Amazon Connect, email tracking, webhooks salientes).
 *
 * Tags aplicados (no-disruptivo — no renombra nada):
 *   aria:layer   = core | integration
 *   aria:domain  = contact-center | campaigns | crm | inbox | ai | admin
 *                | salesforce | whatsapp | meta | mercadolibre | connect | email | web | webhooks
 *   aria:product = ARIA
 *
 * Uso:  node scripts/tag-lambdas.mjs           (aplica)
 *       node scripts/tag-lambdas.mjs --dry-run (solo reporta)
 *
 * Ver la convención en design/nomenclatura.md.
 */
import { execSync } from "node:child_process";

const REGION = process.env.AWS_REGION || "us-east-1";
const DRY = process.argv.includes("--dry-run");

// ── Taxonomía: dominio → { layer, fns[] }. Criterio: una función es
// INTEGRATION si su trabajo PRIMARIO es hablar con un sistema externo / de
// terceros o preparar una integración de tenant; si no, es CORE (lógica y datos
// propios de ARIA, aunque por debajo use una integración). ────────────────────
const TAXONOMY = {
  // ── NÚCLEO ARIA ──────────────────────────────────────────────────────────
  "contact-center": {
    layer: "core",
    fns: [
      "admin-change-agent-status",
      "admin-monitor-contact",
      "admin-stop-contact",
      "admin-transfer-contact",
      "admin-update-contact-attrs",
      "get-agent-active-contact",
      "get-realtime-metrics",
      "get-live-queue",
      "get-live-transcript",
      "get-contact-detail",
      "get-contact-history",
      "get-customer-attachments",
      "get-customer-thread",
      "get-recording",
      "query-contacts",
      "process-contact-event",
      "enrich-contact-lens",
      "save-agent-notes",
      "lookup-customer-profile",
      "search-customer-profiles",
      "update-customer-profile",
      "list-recent-customers",
      "list-contact-flows",
      "list-source-phones",
      "list-email-addresses",
      "list-queues",
      "get-flow-queues",
      "list-missed-contacts",
    ],
  },
  campaigns: {
    layer: "core",
    fns: [
      "create-campaign",
      "campaign-dialer",
      "control-campaign",
      "update-campaign",
      "clone-campaign",
      "relaunch-campaign",
      "list-campaigns",
      "get-campaign-stats",
      "get-campaign-contacts",
      "get-campaign-agents",
      "assign-campaign-agents",
      "edit-campaign-contacts",
      "start-outbound-contact",
    ],
  },
  crm: {
    layer: "core",
    fns: [
      "manage-leads",
      "manage-appointment",
      "journey-runner",
      "automation-engine",
      "manage-automations",
      "program-tick",
      "manage-programs",
      "manage-suppression",
      "schedule-callback",
      "list-callbacks",
      "cancel-callback",
      "callback-dispatcher",
    ],
  },
  inbox: {
    layer: "core",
    fns: ["manage-conversations"],
  },
  ai: {
    layer: "core",
    fns: [
      "bot-runtime",
      "manage-bot",
      "get-bot-report",
      "agent-channel-adapter",
      "get-q-suggestions",
      "get-churn-risk",
      "get-agent-wellness",
      "get-agent-leaderboard",
      "generate-call-summary",
    ],
  },
  admin: {
    layer: "core",
    fns: [
      "manage-taxonomy",
      "manage-catalog",
      "manage-knowledge",
      "manage-permissions",
      "admin-list-audit",
      "manage-scheduled-exports",
      "scheduled-export-runner",
      "provision-tenant",
      "invite-user",
      "list-team",
      "list-users",
      "post-confirmation", // trigger de Cognito (post-signup → grupo)
    ],
  },

  // ── INTEGRACIONES / CONECTORES ───────────────────────────────────────────
  salesforce: {
    layer: "integration",
    fns: [
      "salesforce-sync",
      "salesforce-oauth-start",
      "salesforce-oauth-callback",
      "salesforce-inbound-webhook",
    ],
  },
  whatsapp: {
    layer: "integration",
    fns: [
      "send-whatsapp-template",
      "send-whatsapp-flow",
      "send-whatsapp-list-interactive",
      "create-whatsapp-template",
      "update-whatsapp-template",
      "delete-whatsapp-template",
      "list-whatsapp-templates",
      "upload-whatsapp-template-media",
      "list-whatsapp-flows",
      "get-whatsapp-health",
      "get-whatsapp-analytics",
      "get-hsm-report",
      "whatsapp-meta-webhook",
    ],
  },
  meta: {
    layer: "integration",
    fns: ["meta-messaging-webhook", "meta-lead-ads-webhook"],
  },
  mercadolibre: {
    layer: "integration",
    fns: ["mercadolibre-webhook", "mercadolibre-oauth-start"],
  },
  connect: {
    layer: "integration",
    fns: [
      "verify-connect-connection",
      "diagnose-connection",
      "create-connect-instance",
      "provision-contact-flows",
      "get-federation-token",
      "set-connect-link",
      "manage-connections",
    ],
  },
  email: {
    layer: "integration",
    fns: ["email-tracking"],
  },
  web: {
    layer: "integration",
    fns: ["web-form-capture"],
  },
  webhooks: {
    layer: "integration",
    fns: ["webhook-dispatcher", "get-webhook-deliveries"],
  },
};

// Aplana a { shortName: { layer, domain } }.
const MAP = {};
for (const [domain, { layer, fns }] of Object.entries(TAXONOMY)) {
  for (const fn of fns) {
    if (MAP[fn]) throw new Error(`Función duplicada en la taxonomía: ${fn}`);
    MAP[fn] = { layer, domain };
  }
}

const sh = (cmd) =>
  execSync(cmd, { encoding: "utf8", env: { ...process.env, AWS_REGION: REGION } });
const ACCOUNT_ID = process.env.ACCOUNT_ID || "731736972577";

// Forma normalizada para comparar nombres entre esquemas (kebab vs camel/amplify).
const norm = (s) => s.replace(/[-_]/g, "").toLowerCase();
const NORM_MAP = {}; // normalizado → { layer, domain, canonical }
for (const [fn, m] of Object.entries(MAP)) NORM_MAP[norm(fn)] = { ...m, canonical: fn };

// Lista TODAS las funciones (auto-paginado con NextToken).
function listAll() {
  const out = [];
  let token = null;
  do {
    const cmd =
      `aws lambda list-functions --region ${REGION} --output json` +
      (token ? ` --starting-token "${token}"` : "");
    const j = JSON.parse(sh(cmd));
    for (const f of j.Functions || []) out.push(f.FunctionName);
    token = j.NextToken || null;
  } while (token);
  return out;
}

/**
 * ¿Es una función de ARIA/Connectview y cuál es su nombre canónico?
 *  - `connectview-<name>`  → hand-managed.
 *  - `amplify-connectview-<branch>-<logical>lambda<hash>` → amplify-managed
 *    (las del backend.ts). Extraemos <logical> (antes de "lambda") y lo matcheamos
 *    por forma normalizada contra la taxonomía.
 * Cualquier otra función (otros proyectos Novasys: NovaDialer, NovaCitas, ND-*, …)
 * se ignora.
 */
function classify(fnName) {
  if (fnName.startsWith("connectview-")) {
    const short = fnName.replace(/^connectview-/, "");
    const m = MAP[short];
    return m
      ? { ...m, canonical: short, scheme: "connectview" }
      : { unknown: true, canonical: short };
  }
  if (fnName.startsWith("amplify-connectview-")) {
    // …-<branch>-<logical>lambda<cdkSuffix>-<hash>. El segmento con el logical es
    // `<logical>lambda<suffix>` (a veces "lambda" truncado a 64 chars: lambd/lamb/
    // lam, o seguido de sufijo CDK: lambda8, lambda47375A). Stripeamos desde el
    // marcador "lam(bda)" hasta el final del segmento. Los logicals de ARIA no
    // contienen "lam", así que no hay falso positivo.
    const LAMBDA_MARK = /lamb?d?a?[0-9a-zA-Z]*$/;
    const seg = fnName.split("-").find((s) => /[a-z]lamb?d?a?/.test(s)) || "";
    const logical = seg.replace(LAMBDA_MARK, "");
    const m = NORM_MAP[norm(logical)];
    return m ? { ...m, scheme: "amplify" } : { unknown: true, canonical: logical || fnName };
  }
  return null; // ajena a ARIA → ignorar
}

const all = listAll();
const aria = all.map((f) => ({ name: f, cls: classify(f) })).filter((x) => x.cls);
const known = aria.filter((x) => !x.cls.unknown);
const unknown = aria.filter((x) => x.cls.unknown);

console.log(
  `Funciones en la cuenta: ${all.length} · de ARIA: ${aria.length} · clasificadas: ${known.length}`,
);
if (unknown.length) {
  console.log(`\n⚠️  De ARIA pero SIN clasificar (agregar a la taxonomía):`);
  unknown.forEach((x) => console.log(`   - ${x.name}  (${x.cls.canonical})`));
}
// Cobertura de la taxonomía.
const coveredCanon = new Set(known.map((x) => x.cls.canonical));
const notDeployed = Object.keys(MAP).filter((f) => !coveredCanon.has(f));
if (notDeployed.length) {
  console.log(
    `\nℹ️  En taxonomía pero no desplegadas (código sin deploy): ${notDeployed.join(", ")}`,
  );
}

// Resumen por capa/dominio.
const byLayer = {};
for (const x of known) {
  const k = `${x.cls.layer}/${x.cls.domain}`;
  byLayer[k] = (byLayer[k] || 0) + 1;
}
console.log("\n=== Cobertura por capa/dominio ===");
Object.entries(byLayer)
  .sort()
  .forEach(([k, v]) => console.log(`  ${v.toString().padStart(3)}  ${k}`));

// Aplica los tags.
let tagged = 0;
for (const { name, cls } of known) {
  // aria:tier=platform → las Lambdas viven en la cuenta de Novasys (infra compartida
  // que NOSOTROS pagamos). Los recursos BYO en la cuenta del cliente = aria:tier=tenant.
  const tags = `aria:layer=${cls.layer},aria:domain=${cls.domain},aria:product=ARIA,aria:tier=platform`;
  if (DRY) {
    console.log(`[dry] ${name} → ${tags}`);
  } else {
    sh(
      `aws lambda tag-resource --region ${REGION} --resource "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${name}" --tags "${tags}"`,
    );
    tagged++;
  }
}
console.log(DRY ? "\n(dry-run — nada aplicado)" : `\n✅ ${tagged} Lambdas de ARIA etiquetados.`);
