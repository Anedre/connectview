#!/usr/bin/env node
/**
 * test-load-campaign.mjs — Crea una campaña de prueba con N leads contra los
 * Lambda endpoints REALES de Connectview.
 *
 * Uso:
 *   node scripts/test-load-campaign.mjs                # 100 contactos, DRAFT
 *   node scripts/test-load-campaign.mjs --count 200    # 200 contactos
 *   node scripts/test-load-campaign.mjs --start        # crea y arranca dialing
 *   node scripts/test-load-campaign.mjs --name "Mi test" --start
 *   node scripts/test-load-campaign.mjs --real-phones phones.csv
 *
 *   --csv-only            no crea campaña, solo genera el CSV en /tmp
 *   --count N             cantidad de contactos (default 100)
 *   --name "..."          nombre de la campaña (default "Test N leads - <iso>")
 *   --prefix "+1555555"   prefijo para auto-generar números E.164 (default
 *                         "+1555555" → genera +15555550100..+15555550199 con
 *                         área 555 no asignada por NANP → Connect rechaza el
 *                         routing y no marca a nadie real)
 *   --start               crea con startNow=true, arranca el dialer inmediato
 *   --real-phones FILE    en vez de auto-generar, lee un CSV con números reales
 *                         (formato: phone,name por línea)
 *   --concurrency N       concurrencia de dialing (default 1)
 *   --dial-mode MODE      progressive|power|agentless (default progressive)
 *   --dry-run             muestra qué se va a hacer sin llamar a la API
 *
 * Salida: imprime el campaignId y la URL del Queue Manager / Detail page.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const COUNT = parseInt(args.count || "100", 10);
const NAME =
  args.name ||
  `Test ${COUNT} leads - ${new Date().toISOString().slice(0, 16)}`;
const PHONE_PREFIX = args.prefix || "+1555555";
const START_NOW = args.start === true || args.start === "true";
const DRY_RUN = args["dry-run"] === true;
const CSV_ONLY = args["csv-only"] === true;
const CONCURRENCY = parseInt(args.concurrency || "1", 10);
const DIAL_MODE = args["dial-mode"] || "progressive";
const REAL_PHONES_FILE = args["real-phones"];

// ── Read endpoints from amplify_outputs.json ────────────────────────────────
const outputs = JSON.parse(
  readFileSync(join(ROOT, "amplify_outputs.json"), "utf8")
);
const endpoints = JSON.parse(outputs.custom?.apiEndpoints || "{}");

const required = [
  "listSourcePhones",
  "listContactFlows",
  "listQueues",
  "createCampaign",
  "listCampaigns",
];
for (const k of required) {
  if (!endpoints[k]) {
    console.error(`Missing endpoint: ${k}`);
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`GET ${url} → HTTP ${r.status} ${text}`);
  }
  return r.json();
}
async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `POST ${url} → HTTP ${r.status} ${JSON.stringify(json)}`
    );
  }
  return json;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function buildPhone(prefix, i) {
  // Build a valid E.164 number using the FCC fictional range. The default
  // prefix "+1555555" + a 4-digit padded index starting at 0100 produces
  // e.g. +15555550100 (11 digits after the +), which matches the NANP
  // shape Connect expects but routes nowhere — so the dialer fails fast
  // and we see the no_answer/failed transition within seconds.
  const padded = String(100 + i).padStart(4, "0");
  return `${prefix}${padded}`;
}

function loadRealPhones(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const contacts = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [phoneRaw, name = ""] = line.split(",").map((s) => s.trim());
    if (!/^\+\d{8,15}$/.test(phoneRaw)) continue;
    contacts.push({
      phone: phoneRaw,
      customerName: name || `Test ${contacts.length + 1}`,
      attributes: { source: "test-script" },
    });
  }
  return contacts;
}

function buildSyntheticContacts(count, prefix) {
  // First-name pool used to give every lead a recognisable label in the UI.
  const firstNames = [
    "Andrés",
    "Lucía",
    "María",
    "Juan",
    "Sofía",
    "Carlos",
    "Valentina",
    "Diego",
    "Camila",
    "Mateo",
    "Isabella",
    "Lucas",
    "Renata",
    "Sebastián",
    "Catalina",
    "Tomás",
    "Antonia",
    "Joaquín",
    "Emilia",
    "Benjamín",
  ];
  const lastNames = [
    "García",
    "Martínez",
    "Rodríguez",
    "Hernández",
    "López",
    "Pérez",
    "Sánchez",
    "Ramírez",
    "Torres",
    "Flores",
    "Reyes",
    "Vargas",
    "Díaz",
    "Morales",
    "Castro",
  ];
  const contacts = [];
  for (let i = 0; i < count; i++) {
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[(i * 7) % lastNames.length];
    contacts.push({
      phone: buildPhone(prefix, i),
      customerName: `${fn} ${ln}`,
      attributes: {
        source: "test-script",
        leadIndex: String(i + 1),
      },
    });
  }
  return contacts;
}

function generateCsv(contacts) {
  const header = "phone,name,source\n";
  const rows = contacts
    .map((c) => `${c.phone},${c.customerName},test-script`)
    .join("\n");
  return header + rows + "\n";
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log("┌─────────────────────────────────────────────────────────");
  console.log("│ Connectview · Test campaign loader");
  console.log("├─────────────────────────────────────────────────────────");
  console.log(`│ Contactos:      ${COUNT}`);
  console.log(`│ Nombre:         ${NAME}`);
  console.log(`│ Modo dialing:   ${DIAL_MODE} · concurrencia ${CONCURRENCY}`);
  console.log(
    `│ Arrancar?:      ${START_NOW ? "SI (status=RUNNING)" : "NO (status=DRAFT)"}`
  );
  console.log("└─────────────────────────────────────────────────────────");

  // Build contact list
  const contacts = REAL_PHONES_FILE
    ? loadRealPhones(REAL_PHONES_FILE)
    : buildSyntheticContacts(COUNT, PHONE_PREFIX);

  if (contacts.length === 0) {
    console.error("❌ No se generó ningún contacto válido.");
    process.exit(1);
  }
  console.log(`✓ ${contacts.length} contactos preparados`);
  console.log(
    `  Primeros 3: ${contacts
      .slice(0, 3)
      .map((c) => `${c.phone} (${c.customerName})`)
      .join(", ")}`
  );

  // Write CSV next to the script for reuse / manual upload. We include the
  // count in the filename so running `--count 5` doesn't silently overwrite
  // the user's 100-lead file.
  const csvPath = join(ROOT, "scripts", `test-leads-${contacts.length}.csv`);
  writeFileSync(csvPath, generateCsv(contacts), "utf8");
  console.log(`✓ CSV escrito en ${csvPath}`);

  if (CSV_ONLY) {
    console.log("✓ --csv-only: no se crea campaña. Usá el CSV manualmente.");
    process.exit(0);
  }

  // Discover what to use as sourcePhone / contactFlow / queue
  console.log("→ Consultando recursos de Connect…");
  const [phonesRes, flowsRes, queuesRes] = await Promise.all([
    getJson(endpoints.listSourcePhones),
    getJson(endpoints.listContactFlows),
    getJson(endpoints.listQueues),
  ]);

  const sourcePhones = phonesRes.phoneNumbers || phonesRes.phones || [];
  const flows = flowsRes.flows || flowsRes.contactFlows || [];
  const queues = queuesRes.queues || [];

  if (sourcePhones.length === 0) {
    console.error("❌ No se encontró ningún source phone en la instancia.");
    process.exit(1);
  }
  if (flows.length === 0) {
    console.error("❌ No se encontró ningún contact flow.");
    process.exit(1);
  }

  // Prefer the most recently created campaign as template so we hit the same
  // flow/phone/queue the user normally tests with. Fall back to first-of-list.
  console.log("→ Buscando campaña reciente como template…");
  let template = null;
  try {
    const list = await getJson(endpoints.listCampaigns);
    const all = list.campaigns || [];
    template = all.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  } catch {
    /* no campaigns yet — keep template null */
  }

  const sourcePhoneNumber =
    template?.sourcePhoneNumber ||
    sourcePhones[0]?.phoneNumber ||
    sourcePhones[0]?.PhoneNumber;
  const contactFlowId =
    template?.contactFlowId ||
    flows[0]?.id ||
    flows[0]?.Id;
  const contactFlow = flows.find(
    (f) => (f.id || f.Id) === contactFlowId
  );
  const contactFlowName =
    contactFlow?.name || contactFlow?.Name || template?.contactFlowName;
  const campaignQueueId =
    template?.campaignQueueId || queues[0]?.id || undefined;
  const campaignQueueName =
    template?.campaignQueueName ||
    queues.find((q) => q.id === campaignQueueId)?.name;

  console.log(`  ↳ sourcePhone:   ${sourcePhoneNumber}`);
  console.log(`  ↳ contactFlow:   ${contactFlowName} (${contactFlowId})`);
  console.log(
    `  ↳ queue:         ${campaignQueueName || "(sin asignar)"} (${campaignQueueId || "—"})`
  );
  if (template) {
    console.log(`  ↳ template:      ${template.name}`);
  }

  // Compose payload
  const payload = {
    name: NAME,
    description: `Campaña generada por test-load-campaign.mjs · ${new Date().toISOString()}`,
    sourcePhoneNumber,
    contactFlowId,
    contactFlowName,
    campaignQueueId,
    campaignQueueName,
    dialMode: DIAL_MODE,
    concurrency: CONCURRENCY,
    timezone: template?.timezone || "America/Lima",
    windowStartHour: template?.windowStartHour ?? 8,
    windowEndHour: template?.windowEndHour ?? 22,
    windowDaysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    retryNoAnswerMinutes: template?.retryNoAnswerMinutes ?? 30,
    retryMaxAttempts: template?.retryMaxAttempts ?? 3,
    contacts,
    createdBy: "test-script",
    startNow: START_NOW,
  };

  if (DRY_RUN) {
    console.log("→ DRY RUN — payload que se enviaría:");
    console.log(JSON.stringify({ ...payload, contacts: `[${contacts.length} contactos]` }, null, 2));
    process.exit(0);
  }

  console.log("→ Creando campaña…");
  const result = await postJson(endpoints.createCampaign, payload);
  const campaignId = result.campaignId || result.id;
  const totalContacts = result.totalContacts || contacts.length;

  console.log("");
  console.log("╔═════════════════════════════════════════════════════════");
  console.log(`║ ✅ Campaña creada: ${campaignId}`);
  console.log(`║    Contactos cargados: ${totalContacts}`);
  console.log(
    `║    Estado: ${START_NOW ? "RUNNING (dialing arrancó)" : "DRAFT (no arrancó aún)"}`
  );
  console.log("║");
  console.log("║ 👀 Para ver el flujo:");
  console.log("║   • Queue Manager:");
  console.log("║     http://localhost:5173/queue");
  console.log(`║   • Detalle de campaña:`);
  console.log(`║     http://localhost:5173/campaigns/${campaignId}`);
  if (!START_NOW) {
    console.log("║");
    console.log("║ ▶ Arrancá el dialer desde Queue Manager o /campaigns/<id>");
    console.log("║   (botón 'Iniciar') para ver las llamadas entrando una por una");
    console.log("║   en el nuevo feed de actividad.");
  }
  console.log("╚═════════════════════════════════════════════════════════");
})().catch((err) => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
