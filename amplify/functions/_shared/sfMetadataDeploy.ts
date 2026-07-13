/**
 * sfMetadataDeploy — instala el "puente inbound" (SF → ARIA) en la org del
 * cliente vía Metadata API, con el access_token de SU OAuth. Automatiza el Paso 4
 * manual de SALESFORCE_SETUP.md: en vez de que el cliente cree a mano un Flow +
 * Remote Site + header, ARIA despliega un paquete Apex determinista:
 *
 *   • RemoteSiteSetting  → autoriza el callout saliente a la URL del webhook.
 *   • ApexTrigger (Lead, after insert/update) → filtra LeadSource≠'Vox' (anti-eco)
 *     y encola el envío.
 *   • ApexClass @future(callout=true) → POST del Lead al webhook con el token
 *     per-tenant en el header `x-vox-token`.
 *   • ApexClass de test → cobertura ≥75% (obligatoria para desplegar a producción).
 *
 * Deploy = Metadata API SOAP (`deploy` + `checkDeployStatus`), sin dependencias.
 * Requiere que el usuario que autorizó el OAuth sea admin (Modify Metadata); si
 * no, SF devuelve INSUFFICIENT_ACCESS y el caller cae a la guía manual.
 */
import { makeZip } from "./zip";

const MD_VERSION = "60.0";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
/** Escapa un string para incrustarlo como literal Apex entre comillas simples. */
function apexEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Genera los archivos del paquete de metadata con la URL y el token inyectados. */
export function buildInboundPackage(
  webhookUrl: string,
  inboundToken: string,
): Record<string, string> {
  const ep = apexEscape(webhookUrl);
  const tok = apexEscape(inboundToken);

  const apexClass = `public with sharing class VoxLeadSync {
    // Generada por ARIA — envía los cambios de Lead al webhook de ARIA.
    @future(callout=true)
    public static void sync(Set<Id> leadIds) {
        String endpoint = '${ep}';
        String token = '${tok}';
        List<Lead> leads = [
            SELECT Id, Phone, MobilePhone, FirstName, LastName, Email, Company, Status, LeadSource
            FROM Lead WHERE Id IN :leadIds
        ];
        for (Lead l : leads) {
            Map<String, Object> payload = new Map<String, Object>{
                'phone' => l.Phone,
                'mobilePhone' => l.MobilePhone,
                'firstName' => l.FirstName,
                'lastName' => l.LastName,
                'email' => l.Email,
                'company' => l.Company,
                'status' => l.Status,
                'leadId' => l.Id,
                'source' => l.LeadSource
            };
            HttpRequest req = new HttpRequest();
            req.setEndpoint(endpoint);
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('x-vox-token', token);
            req.setTimeout(10000);
            req.setBody(JSON.serialize(payload));
            try {
                new Http().send(req);
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'VoxLeadSync callout failed: ' + e.getMessage());
            }
        }
    }
}`;

  const apexTrigger = `trigger VoxLeadSyncTrigger on Lead (after insert, after update) {
    Set<Id> ids = new Set<Id>();
    for (Lead l : Trigger.new) {
        // Anti-eco: los Leads que ARIA escribe llevan LeadSource='Vox'; no se
        // reenvían de vuelta (evita el bucle SF <-> ARIA).
        if (l.LeadSource == 'Vox') continue;
        ids.add(l.Id);
    }
    if (!ids.isEmpty()) VoxLeadSync.sync(ids);
}`;

  const apexTest = `@isTest
private class VoxLeadSyncTest {
    private class Mock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"ok":true}');
            return res;
        }
    }
    @isTest static void sendsCallout() {
        Test.setMock(HttpCalloutMock.class, new Mock());
        Test.startTest();
        insert new Lead(LastName = 'Prueba ARIA', Company = 'ARIA', Phone = '+51999000111');
        Test.stopTest();
        System.assertEquals(1, [SELECT COUNT() FROM Lead WHERE LastName = 'Prueba ARIA']);
    }
    @isTest static void skipsVoxSource() {
        Test.startTest();
        insert new Lead(LastName = 'Eco', Company = 'ARIA', LeadSource = 'Vox');
        Test.stopTest();
        System.assertEquals(1, [SELECT COUNT() FROM Lead WHERE LeadSource = 'Vox']);
    }
}`;

  const clsMeta = `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${MD_VERSION}</apiVersion>
    <status>Active</status>
</ApexClass>`;
  const trgMeta = `<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${MD_VERSION}</apiVersion>
    <status>Active</status>
</ApexTrigger>`;

  // El RemoteSiteSetting NO va en el ZIP: el Metadata API deploy lo reporta
  // "not found in zipped directory" aunque el archivo esté presente (los Apex del
  // mismo ZIP sí se despliegan). Se crea aparte con upsertMetadata (CRUD síncrono).
  const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>VoxLeadSync</members><members>VoxLeadSyncTest</members><name>ApexClass</name></types>
    <types><members>VoxLeadSyncTrigger</members><name>ApexTrigger</name></types>
    <version>${MD_VERSION}</version>
</Package>`;

  return {
    "package.xml": packageXml,
    "classes/VoxLeadSync.cls": apexClass,
    "classes/VoxLeadSync.cls-meta.xml": clsMeta,
    "classes/VoxLeadSyncTest.cls": apexTest,
    "classes/VoxLeadSyncTest.cls-meta.xml": clsMeta,
    "triggers/VoxLeadSyncTrigger.trigger": apexTrigger,
    "triggers/VoxLeadSyncTrigger.trigger-meta.xml": trgMeta,
  };
}

const SOAP_URL = (instanceUrl: string) =>
  `${instanceUrl.replace(/\/+$/, "")}/services/Soap/m/${MD_VERSION}`;

/** Extrae el primer valor de un tag SOAP (tolerante a prefijo de namespace). */
function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? m[1].trim() : null;
}

async function metadataSoap(
  instanceUrl: string,
  sessionId: string,
  action: string,
  body: string,
): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header><met:SessionHeader><met:sessionId>${xmlEscape(sessionId)}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
  const r = await fetch(SOAP_URL(instanceUrl), {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: `"${action}"` },
    body: envelope,
  });
  const text = await r.text();
  if (!r.ok) {
    const fault = pick(text, "faultstring");
    throw new Error(fault || `Metadata API HTTP ${r.status}`);
  }
  return text;
}

/** Crea/actualiza el Remote Site (autoriza el callout saliente) vía upsertMetadata
 *  (CRUD síncrono). Fuera del ZIP: el deploy no reconoce el RemoteSiteSetting
 *  empaquetado. Idempotente (crea o actualiza por fullName). */
async function upsertRemoteSite(
  instanceUrl: string,
  sessionId: string,
  webhookUrl: string,
): Promise<void> {
  const origin = new URL(webhookUrl).origin; // el Remote Site usa el host, no el path
  const body =
    `<met:upsertMetadata><met:metadata xsi:type="met:RemoteSiteSetting">` +
    `<met:fullName>Vox_Inbound_Webhook</met:fullName>` +
    `<met:description>ARIA - webhook de sincronizacion de Leads</met:description>` +
    `<met:disableProtocolSecurity>false</met:disableProtocolSecurity>` +
    `<met:isActive>true</met:isActive>` +
    `<met:url>${xmlEscape(origin)}</met:url>` +
    `</met:metadata></met:upsertMetadata>`;
  const xml = await metadataSoap(instanceUrl, sessionId, "upsertMetadata", body);
  if (pick(xml, "success") !== "true") {
    const err =
      pick(xml, "errors") || pick(xml, "faultstring") || "no se pudo crear el Remote Site";
    throw new Error(`RemoteSiteSetting: ${err}`);
  }
}

/** Llamada REST con el access_token del OAuth como Bearer. */
async function sfRest(
  instanceUrl: string,
  sessionId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${instanceUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: { Authorization: `Bearer ${sessionId}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Deja la org lista para el push ARIA→SF: crea el campo de dedup
 *  `Lead.VoxLeadId__c` (External Id único) y le da field-level security al usuario
 *  del conector. Crear el campo NO lo hace escribible (FLS): sin el permiso, el
 *  upsert por External Id que hace `pushLeadToSalesforce` da 404. Idempotente. */
async function ensureDedupField(instanceUrl: string, sessionId: string): Promise<void> {
  // 1) Campo External Id único.
  const field =
    `<met:upsertMetadata><met:metadata xsi:type="met:CustomField">` +
    `<met:fullName>Lead.VoxLeadId__c</met:fullName><met:label>Vox Lead Id</met:label>` +
    // length 40: el External Id que escribe pushLeadToSalesforce es el leadId de
    // ARIA (UUID de 36 chars). Con 18 daba STRING_TOO_LONG y el push fallaba entero.
    `<met:type>Text</met:type><met:length>40</met:length>` +
    `<met:externalId>true</met:externalId><met:unique>true</met:unique>` +
    `</met:metadata></met:upsertMetadata>`;
  const fx = await metadataSoap(instanceUrl, sessionId, "upsertMetadata", field);
  if (pick(fx, "success") !== "true") {
    throw new Error(
      `VoxLeadId__c: ${pick(fx, "errors") || pick(fx, "faultstring") || "no se pudo crear"}`,
    );
  }
  // 2) PermissionSet con la FLS del campo (readable + editable).
  const ps =
    `<met:upsertMetadata><met:metadata xsi:type="met:PermissionSet">` +
    `<met:fullName>Vox_Lead_Sync</met:fullName><met:label>Vox Lead Sync</met:label>` +
    `<met:fieldPermissions><met:field>Lead.VoxLeadId__c</met:field><met:editable>true</met:editable><met:readable>true</met:readable></met:fieldPermissions>` +
    `</met:metadata></met:upsertMetadata>`;
  const px = await metadataSoap(instanceUrl, sessionId, "upsertMetadata", ps);
  if (pick(px, "success") !== "true") {
    throw new Error(
      `PermissionSet: ${pick(px, "errors") || pick(px, "faultstring") || "no se pudo crear"}`,
    );
  }
  // 3) Asignar el PermissionSet al usuario del conector (el que corre el push).
  const me = (await (
    await sfRest(instanceUrl, sessionId, "GET", "/services/oauth2/userinfo")
  ).json()) as {
    user_id?: string;
  };
  const q = (await (
    await sfRest(
      instanceUrl,
      sessionId,
      "GET",
      `/services/data/v${MD_VERSION}/query?q=${encodeURIComponent("SELECT Id FROM PermissionSet WHERE Name='Vox_Lead_Sync'")}`,
    )
  ).json()) as { records?: Array<{ Id?: string }> };
  const userId = me.user_id;
  const psId = q.records?.[0]?.Id;
  if (!userId || !psId) return; // sin usuario/permset resueltos no forzamos (no fatal)
  const asg = await sfRest(
    instanceUrl,
    sessionId,
    "POST",
    `/services/data/v${MD_VERSION}/sobjects/PermissionSetAssignment`,
    { AssigneeId: userId, PermissionSetId: psId },
  );
  // 201 = asignado; DUPLICATE_VALUE = ya lo tenía (idempotente).
  if (asg.status !== 201) {
    const t = await asg.text();
    if (!/DUPLICATE_VALUE/.test(t)) throw new Error(`asignación PermissionSet HTTP ${asg.status}`);
  }
}

export interface DeployResult {
  done: boolean;
  success: boolean;
  errors: string[];
  status: string;
  /** Avisos no-fatales (p.ej. no se pudo preparar VoxLeadId__c para el push). */
  warnings?: string[];
}

/** Lanza el deploy y hace polling hasta terminar (o agotar el presupuesto). */
export async function deployInboundBridge(
  instanceUrl: string,
  sessionId: string,
  webhookUrl: string,
  inboundToken: string,
  budgetMs = 75_000,
): Promise<DeployResult> {
  // 1) Remote Site (autoriza el callout saliente) por CRUD síncrono — el deploy
  //    ZIP no reconoce este componente. Si el usuario no es admin, lanza aquí.
  await upsertRemoteSite(instanceUrl, sessionId, webhookUrl);
  // 2) Campo de dedup Lead.VoxLeadId__c + FLS → deja la org lista para el push
  //    ARIA→SF. Best-effort: si falla, el inbound igual queda activo (warning).
  const warnings: string[] = [];
  try {
    await ensureDedupField(instanceUrl, sessionId);
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "No se pudo preparar VoxLeadId__c");
  }
  // 3) Apex (trigger + clases + tests) por deploy ZIP.
  const files = buildInboundPackage(webhookUrl, inboundToken);
  const zipB64 = makeZip(files).toString("base64");

  const startXml = await metadataSoap(
    instanceUrl,
    sessionId,
    "deploy",
    `<met:deploy><met:ZipFile>${zipB64}</met:ZipFile><met:DeployOptions>` +
      `<met:singlePackage>true</met:singlePackage><met:rollbackOnError>true</met:rollbackOnError>` +
      `<met:testLevel>RunSpecifiedTests</met:testLevel><met:runTests>VoxLeadSyncTest</met:runTests>` +
      `</met:DeployOptions></met:deploy>`,
  );
  const asyncId = pick(startXml, "id");
  if (!asyncId) throw new Error("Salesforce no devolvió un id de deploy");

  const deadline = Date.now() + budgetMs;
  // Poll cada 3s. Un deploy de este tamaño (1 trigger + 2 clases + tests) suele
  // tardar 15-40s; damos hasta budgetMs antes de rendirnos como "en progreso".
  for (;;) {
    await new Promise((res) => setTimeout(res, 3000));
    const statusXml = await metadataSoap(
      instanceUrl,
      sessionId,
      "checkDeployStatus",
      `<met:checkDeployStatus><met:asyncProcessId>${asyncId}</met:asyncProcessId><met:includeDetails>true</met:includeDetails></met:checkDeployStatus>`,
    );
    const done = pick(statusXml, "done") === "true";
    const status = pick(statusXml, "status") || "InProgress";
    if (done) {
      const success = pick(statusXml, "success") === "true";
      const errors: string[] = [];
      // Fallos de componente (Apex/trigger/remote site) y de test.
      const failRe =
        /<(?:\w+:)?(?:componentFailures|failures)[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:componentFailures|failures)>/g;
      let m: RegExpExecArray | null;
      while ((m = failRe.exec(statusXml))) {
        const problem = pick(m[1], "problem") || pick(m[1], "message");
        const name = pick(m[1], "fullName") || pick(m[1], "methodName") || "";
        if (problem) errors.push(name ? `${name}: ${problem}` : problem);
      }
      if (!success && errors.length === 0) {
        const msg = pick(statusXml, "errorMessage");
        if (msg) errors.push(msg);
      }
      return { done: true, success, errors, status, warnings };
    }
    if (Date.now() > deadline) {
      return { done: false, success: false, errors: [], status: "InProgress", warnings };
    }
  }
}
