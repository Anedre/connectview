import { useState, type ReactNode, type CSSProperties } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Send, Lock, Palette, ClipboardList, Trash2 } from "lucide-react";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import {
  useConnections,
  type ConnectionsConfig,
  type ConnectConn,
  type WhatsAppConn,
  type WhatsAppNumber,
} from "@/hooks/useConnections";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * IntegrationsManager — Configuración → Integraciones. El cliente conecta SU
 * Amazon Connect (BYO, rol cross-account), SU Salesforce (OAuth) y WhatsApp.
 * Es la superficie del SaaS: "conectá tu cuenta y usá Vox".
 *
 * Estado actual: la config NO sensible se guarda (local hoy, backend luego).
 * Los secretos (token WA, refresh token SF) y la verificación real viven en el
 * backend (Secrets Manager + assume-role) — próximo paso.
 */

// Regiones donde Amazon Connect está disponible.
const CONNECT_REGIONS = [
  "us-east-1", "us-west-2", "af-south-1", "ap-northeast-1", "ap-northeast-2",
  "ap-southeast-1", "ap-southeast-2", "ca-central-1", "eu-central-1", "eu-west-2",
];

type Tone = "ok" | "warn" | "error" | "idle";
const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--accent-green)",
  warn: "var(--accent-amber)",
  error: "var(--accent-red)",
  idle: "var(--text-3)",
};

function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  const color = TONE_COLOR[tone];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, height: 22,
        padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
        color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

function newExternalId(): string {
  // SEGURIDAD: el ExternalId es la pieza anti-confused-deputy del handshake
  // cross-account — DEBE ser impredecible (CSPRNG). NUNCA usar Math.random()
  // (predecible/forzable). randomUUID() es lo ideal; si no está, caemos a
  // getRandomValues (disponible más ampliamente). Si NINGUNO existe, fallamos
  // ruidosamente en vez de generar un id débil.
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `vox-${crypto.randomUUID()}`;
  }
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return `vox-${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error(
    "No hay generador criptográfico seguro disponible (¿contexto no-HTTPS?). " +
      "Abrí la app sobre HTTPS para generar el ExternalId de forma segura."
  );
}

/** Tarjeta genérica de conexión con header + estado + cuerpo expandible. */
function ConnCard({
  icon, title, desc, tone, statusLabel, open, onToggle, children,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  tone: Tone;
  statusLabel: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <span style={{ flex: "0 0 auto", display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--border-1)" }}>
            {icon}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
              <StatusBadge tone={tone} label={statusLabel} />
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{desc}</div>
          </div>
          <button className="btn btn--sm" onClick={onToggle}>
            {open ? <>Cerrar</> : <><Icon.Settings size={13} /> Configurar</>}
          </button>
        </div>
        {open && <div style={{ marginTop: 16, borderTop: "1px solid var(--border-1)", paddingTop: 16 }}>{children}</div>}
      </CardBody>
    </Card>
  );
}

function StepLabel({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="row" style={{ gap: 8, marginBottom: 8 }}>
      <span style={{ flex: "0 0 auto", display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 999, background: "var(--accent-cyan-soft)", color: "var(--accent-cyan)", fontSize: 11, fontWeight: 800 }}>{n}</span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{children}</span>
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid var(--border-1)",
  borderRadius: 6, background: "var(--bg-1)", color: "var(--text-1)",
};
const labelStyle: CSSProperties = {
  fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600,
};

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copiado`),
    () => toast.error("No se pudo copiar")
  );
}

// Templates CFN viven en `cfnTemplates.ts` para que este archivo no se llene
// de YAML. Importamos los dos: el del rol (obligatorio) y el del Data Plane
// (opcional, BYO Data — #46).
import { connectAccessCfnTemplate, dataPlaneCfnTemplate } from "./cfnTemplates";
import { IntegrationHealthPanel } from "./IntegrationHealthPanel";
import { ConnectSetupWizard } from "./ConnectSetupWizard";

// Alias retro-compatible para que el resto del archivo no cambie.
const connectCfnTemplate = connectAccessCfnTemplate;

/* ── Amazon Connect (BYO + rol cross-account) ───────────────────────── */
function AmazonConnectCard({ config, update }: { config: ConnectionsConfig; update: (patch: Partial<ConnectionsConfig>) => void }) {
  const c = config.connect || {};
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConnectConn>(() => ({
    region: "us-east-1",
    externalId: c.externalId || newExternalId(),
    ...c,
  }));
  const [verifying, setVerifying] = useState(false);
  const [verifyingDp, setVerifyingDp] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const ep = getApiEndpoints();
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";

  const tone: Tone = !c.instanceUrl ? "idle" : !c.roleArn ? "warn" : !c.verifiedAt ? "warn" : "ok";
  const statusLabel = !c.instanceUrl ? "No conectado" : !c.roleArn ? "Incompleto" : !c.verifiedAt ? "Sin verificar" : "Conectado";

  const set = (patch: Partial<ConnectConn>) => setDraft((d) => ({ ...d, ...patch }));
  const onSave = () => {
    if (!draft.instanceUrl?.trim()) { toast.error("Falta la URL de tu instancia de Connect"); return; }
    update({ connect: { ...draft, instanceUrl: draft.instanceUrl.trim(), roleArn: draft.roleArn?.trim(), verifiedAt: undefined } });
    toast.success("Conexión de Amazon Connect guardada");
  };
  const onVerify = async () => {
    if (!ep?.verifyConnectConnection) {
      toast.message("La verificación real estará disponible al desplegar el backend.");
      return;
    }
    if (!draft.roleArn?.trim()) { toast.error("Pegá primero el ARN del rol"); return; }
    setVerifying(true);
    try {
      const r = await fetch(ep.verifyConnectConnection, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleArn: draft.roleArn.trim(), externalId: draft.externalId, instanceArn: draft.instanceArn, region: draft.region }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo verificar");
      const verifiedAt = new Date().toISOString();
      update({ connect: { ...draft, verifiedAt } });
      setDraft((d) => ({ ...d, verifiedAt }));
      toast.success("¡Conexión a Amazon Connect verificada!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló la verificación");
    } finally {
      setVerifying(false);
    }
  };
  // BYO Data Plane verify (#46): el mismo Lambda verifyConnectConnection
  // acepta `checkDataPlane: true` y hace DescribeTable sobre las 14 tablas
  // del template. Si alguna falta, devuelve qué falta para que el cliente
  // sepa que tiene que (re)aplicar el CFN del paso 4.
  const onVerifyDataPlane = async () => {
    if (!ep?.verifyConnectConnection) {
      toast.message("Backend de verificación pendiente de despliegue.");
      return;
    }
    if (!draft.roleArn?.trim()) { toast.error("Pegá primero el ARN del rol (paso 3)"); return; }
    setVerifyingDp(true);
    try {
      const r = await fetch(ep.verifyConnectConnection, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleArn: draft.roleArn.trim(),
          externalId: draft.externalId,
          instanceArn: draft.instanceArn,
          region: draft.region,
          checkDataPlane: true,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        const missing = Array.isArray(j.missingTables) && j.missingTables.length
          ? ` Tablas faltantes: ${j.missingTables.slice(0, 5).join(", ")}${j.missingTables.length > 5 ? "…" : ""}`
          : "";
        throw new Error((j.error || "No se pudo verificar el data plane") + missing);
      }
      const dataPlaneVerifiedAt = new Date().toISOString();
      update({ connect: { ...draft, dataPlaneVerifiedAt } });
      setDraft((d) => ({ ...d, dataPlaneVerifiedAt }));
      toast.success(`Las 14 tablas existen en tu cuenta. ARIA ya escribe acá.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló la verificación del data plane");
    } finally {
      setVerifyingDp(false);
    }
  };
  // Provisión de contact flows (#1): crea el set canónico de ARIA (Inbound /
  // Outbound / Disconnect) en la instancia del tenant. Usa authedFetch porque el
  // Lambda exige JWT de admin; lee el roleArn de la config GUARDADA (server-side),
  // así que requiere conexión verificada primero.
  const onProvisionFlows = async () => {
    if (!ep?.provisionContactFlows) {
      toast.message("Backend de provisión pendiente de despliegue.");
      return;
    }
    if (!c.verifiedAt) { toast.error("Verificá la conexión a Connect primero (paso anterior)."); return; }
    setProvisioning(true);
    try {
      const r = await authedFetch(ep.provisionContactFlows, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudieron provisionar los flows");
      const n = Object.keys(j.flows || {}).length;
      toast.success(`${n} contact flows de ARIA listos en tu instancia (cola: ${j.resolvedQueue?.name || "—"}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló la provisión de flows");
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <ConnCard
      icon={<Icon.Headset size={20} style={{ color: "#FF9900" }} />}
      title="Amazon Connect"
      desc="Tu contact center: el Agent Desktop usará tu CCP, y las métricas, campañas y grabaciones leen de tu instancia."
      tone={tone} statusLabel={statusLabel} open={open} onToggle={() => setOpen((o) => !o)}
    >
      {wizardOpen && (
        <ConnectSetupWizard
          initial={draft}
          onSave={(next) => { update({ connect: { ...next } }); setDraft((d) => ({ ...d, ...next })); }}
          onClose={() => setWizardOpen(false)}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Asistente guiado (recomendado para no-técnicos) */}
        <div
          style={{
            display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between",
            padding: "14px 16px", borderRadius: 10,
            background: "linear-gradient(135deg, var(--accent-amber-soft), transparent)",
            border: "1px solid color-mix(in srgb, var(--accent-amber) 30%, transparent)",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>¿Primera vez? Usá el asistente guiado</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              Te lleva paso a paso, con un clic para crear el rol en tu cuenta AWS. ~3 minutos.
            </div>
          </div>
          <button className="btn btn--primary" onClick={() => setWizardOpen(true)} style={{ flex: "0 0 auto" }}>
            <Icon.Sparkles size={14} /> Abrir asistente
          </button>
        </div>

        <div style={{ fontSize: 11.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
          O configurá manualmente
        </div>

        {/* Paso 1 */}
        <div>
          <StepLabel n={1}>URL y región de tu instancia</StepLabel>
          <div className="camp-2col" style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10 }}>
            <label>
              <span style={labelStyle}>URL de la instancia</span>
              <input style={inputStyle} placeholder="https://tu-empresa.my.connect.aws" value={draft.instanceUrl || ""} onChange={(e) => set({ instanceUrl: e.target.value })} />
            </label>
            <label>
              <span style={labelStyle}>Región</span>
              <select style={inputStyle} value={draft.region || "us-east-1"} onChange={(e) => set({ region: e.target.value })}>
                {CONNECT_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: "block", marginTop: 10 }}>
            <span style={labelStyle}>ARN de la instancia (opcional, recomendado)</span>
            <input style={inputStyle} placeholder="arn:aws:connect:us-east-1:123456789012:instance/…" value={draft.instanceArn || ""} onChange={(e) => set({ instanceArn: e.target.value })} />
          </label>
        </div>

        {/* Paso 2 */}
        <div>
          <StepLabel n={2}>Permitir que ARIA embeba tu CCP</StepLabel>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            En tu consola de Connect → <b>Configuración de la aplicación → Orígenes aprobados</b>, agregá este dominio:
          </div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <code style={{ flex: 1, padding: "7px 10px", background: "var(--bg-2)", borderRadius: 6, fontSize: 12, border: "1px solid var(--border-1)", overflow: "hidden", textOverflow: "ellipsis" }}>{appOrigin}</code>
            <button className="btn btn--sm" onClick={() => copy(appOrigin, "Dominio")}><Icon.Copy size={12} /> Copiar</button>
          </div>
        </div>

        {/* Paso 3 */}
        <div>
          <StepLabel n={3}>Dar acceso seguro (rol cross-account)</StepLabel>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Creá un rol IAM en TU cuenta AWS que ARIA pueda asumir (no creamos nada en tu cuenta, solo lo asumimos). Desplegá esta plantilla CloudFormation y pegá el <b>RoleArn</b> de salida.
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn btn--sm" onClick={() => copy(connectCfnTemplate(draft.externalId || "", draft.instanceArn || ""), "Plantilla CloudFormation")}>
              <Icon.Copy size={12} /> Copiar plantilla CloudFormation
            </button>
            <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
              External ID: <code style={{ fontSize: 11 }}>{draft.externalId}</code>
            </span>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--accent-cyan)" }}>Ver plantilla</summary>
            <pre style={{ marginTop: 8, padding: 12, background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: 8, fontSize: 10.5, overflow: "auto", maxHeight: 220, lineHeight: 1.4 }}>{connectCfnTemplate(draft.externalId || "", draft.instanceArn || "")}</pre>
          </details>
          <label style={{ display: "block", marginTop: 10 }}>
            <span style={labelStyle}>ARN del rol creado</span>
            <input style={inputStyle} placeholder="arn:aws:iam::123456789012:role/VoxCrmConnectAccess" value={draft.roleArn || ""} onChange={(e) => set({ roleArn: e.target.value })} />
          </label>
          {/* Advanced: override del Customer Profiles domain name. Default es
              `amazon-connect-<alias>` derivado del instanceUrl — solo se
              llena si el cliente renombró el dominio manualmente. */}
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--text-3)" }}>
              Opciones avanzadas
            </summary>
            <label style={{ display: "block", marginTop: 8 }}>
              <span style={labelStyle}>Customer Profiles · domain name (opcional)</span>
              <input
                style={inputStyle}
                placeholder="amazon-connect-tu-alias (default derivado de instanceUrl)"
                value={draft.customerProfilesDomain || ""}
                onChange={(e) => set({ customerProfilesDomain: e.target.value })}
              />
            </label>
          </details>
        </div>

        {/* Paso 4 — BYO Data Plane (OBLIGATORIO: Vox no guarda datos de clientes) */}
        <div>
          <StepLabel n={4}>Tus datos en tu cuenta (requerido)</StepLabel>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            ARIA <b>no guarda datos de empresas en su cuenta</b>. Tus leads, campañas, contactos,
            tipificaciones y audit viven en TU cuenta AWS. Desplegá esta plantilla: crea las 14 tablas
            DynamoDB en TU cuenta y extiende el rol existente con permisos de lectura/escritura sobre
            ellas. <b>Es un paso necesario: sin esto, ARIA no tiene dónde guardar tus datos.</b>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn btn--sm" onClick={() => copy(dataPlaneCfnTemplate(), "Plantilla Data Plane")}>
              <Icon.Copy size={12} /> Copiar plantilla Data Plane
            </button>
            <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
              Pre-requisito: el rol del paso 3 ya creado
            </span>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--accent-cyan)" }}>Ver plantilla Data Plane</summary>
            <pre style={{ marginTop: 8, padding: 12, background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: 8, fontSize: 10.5, overflow: "auto", maxHeight: 220, lineHeight: 1.4 }}>{dataPlaneCfnTemplate()}</pre>
          </details>

          {/* Toggle de activación + verificación. CRÍTICO: sin tildar esto, Vox sigue escribiendo
              en su cuenta aunque hayas aplicado el CFN. Una vez tildado, las lecturas/escrituras van
              a TU cuenta (assume-role). Si las tablas no existen → 500 ResourceNotFoundException. */}
          <label
            className="row"
            style={{
              gap: 10, marginTop: 14, padding: "10px 12px", borderRadius: 8,
              background: draft.dataPlaneEnabled ? "var(--accent-green-soft)" : "var(--bg-2)",
              border: `1px solid ${draft.dataPlaneEnabled ? "var(--accent-green)" : "var(--border-1)"}`,
              cursor: "pointer", alignItems: "flex-start",
            }}
          >
            <input
              type="checkbox"
              checked={!!draft.dataPlaneEnabled}
              onChange={(e) => set({ dataPlaneEnabled: e.target.checked, dataPlaneVerifiedAt: undefined })}
              style={{ marginTop: 2 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Activar BYO Data Plane</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
                Tildá esto SOLO después de haber aplicado el CFN del paso 4 en tu cuenta.
                A partir de ese momento ARIA lee/escribe en TU DynamoDB; si las tablas no existen
                las llamadas van a fallar.
              </div>
            </div>
          </label>
          {draft.dataPlaneEnabled && (
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button
                className="btn btn--sm"
                onClick={onVerifyDataPlane}
                disabled={verifyingDp || !draft.roleArn}
              >
                {verifyingDp ? "Verificando tablas…" : <><Icon.Check size={12} /> Verificar tablas</>}
              </button>
              {c.dataPlaneVerifiedAt && (
                <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
                  Tablas verificadas {new Date(c.dataPlaneVerifiedAt).toLocaleString("es-PE")}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--primary" onClick={onSave}>Guardar</button>
          <button className="btn" onClick={onVerify} disabled={verifying || !draft.roleArn}>
            {verifying ? "Verificando…" : <><Icon.Check size={13} /> Verificar conexión</>}
          </button>
          {c.verifiedAt && (
            <button className="btn" onClick={onProvisionFlows} disabled={provisioning} title="Crea los contact flows de ARIA (entrante, saliente, despedida) en tu instancia de Connect.">
              {provisioning ? "Provisionando…" : <><Icon.Lightning size={13} /> Provisionar flows</>}
            </button>
          )}
          {c.verifiedAt && <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>Verificada {new Date(c.verifiedAt).toLocaleString("es-PE")}</span>}
        </div>

        {/* Panel de diagnóstico: auto-corre los health-checks contra el Connect
            del cliente y muestra qué features faltan + cómo activarlas. */}
        <IntegrationHealthPanel hasConnect={!!c.instanceUrl && !!c.roleArn} />
      </div>
    </ConnCard>
  );
}

/* ── Salesforce (OAuth web) ─────────────────────────────────────────── */
function SalesforceCard({ config, update }: { config: ConnectionsConfig; update: (patch: Partial<ConnectionsConfig>) => void }) {
  const sf = config.salesforce || {};
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<"production" | "sandbox">(sf.environment || "production");
  // Token de ENTRADA (SF→Vox) recién generado, para mostrarlo UNA vez.
  const [inboundToken, setInboundToken] = useState("");
  const [genningToken, setGenningToken] = useState(false);
  const ep = getApiEndpoints();
  const { confirm, confirmDialog } = useConfirm();

  const tone: Tone = sf.connected ? "ok" : "idle";
  const statusLabel = sf.connected ? "Conectado" : "No conectado";

  // Genera/ROTA el token de entrada per-tenant del webhook SF→Vox. El backend
  // lo guarda en Secrets Manager y devuelve el plaintext UNA sola vez; lo
  // mostramos para pegarlo en el Custom Header `x-vox-token` del Flow de SF.
  const onGenerateInboundToken = async () => {
    if (!ep?.manageConnections) {
      toast.message("Disponible al desplegar el backend de integraciones.");
      return;
    }
    if (sf.inboundTokenSet && !(await confirm({
      title: "¿Rotar el token de entrada?",
      description:
        "Rotar el token invalida el anterior: el Flow de Salesforce dejará de " +
        "sincronizar hasta que pegues el token nuevo en su header.",
      destructive: true,
      confirmLabel: "Rotar token",
    }))) return;
    setGenningToken(true);
    try {
      const r = await authedFetch(ep.manageConnections, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotateSfInboundToken: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.inboundToken) throw new Error(j.error || "No se pudo generar el token");
      setInboundToken(j.inboundToken);
      update({ salesforce: { ...sf, inboundTokenSet: true } });
      toast.success("Token de entrada generado — copialo ahora (se muestra una sola vez)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló la generación del token");
    } finally {
      setGenningToken(false);
    }
  };

  const onConnect = async () => {
    if (!ep?.salesforceOAuthStart) {
      toast.message("El flujo OAuth se habilita al desplegar el backend de Salesforce.");
      update({ salesforce: { ...sf, environment: env } });
      return;
    }
    try {
      const r = await authedFetch(`${ep.salesforceOAuthStart}?environment=${env}`);
      const j = await r.json();
      if (j.authUrl) { window.location.assign(j.authUrl); return; }
      toast.error("No se obtuvo la URL de autorización");
    } catch {
      toast.error("No se pudo iniciar OAuth con Salesforce");
    }
  };
  const onDisconnect = async () => {
    update({ salesforce: { connected: false } });
    // Invalidar el token en el backend (no solo el flag): el GET deriva el
    // estado del secret, así que sin esto la desconexión no se reflejaría.
    if (ep?.manageConnections) {
      try {
        await authedFetch(ep.manageConnections, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disconnectSalesforce: true, config: { ...config, salesforce: { connected: false } } }),
        });
      } catch { /* el flag local ya cambió; reintenta en el próximo focus */ }
    }
    toast.success("Salesforce desconectado");
  };

  return (
    <ConnCard
      icon={<Icon.Cloud size={20} style={{ color: "#00A1E0" }} />}
      title="Salesforce"
      desc="Sincroniza leads, actividad e historial en ambos sentidos. Conexión con un clic vía OAuth (sin certificados)."
      tone={tone} statusLabel={statusLabel} open={open} onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {sf.connected ? (
          <>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Conectado a <b>{sf.instanceUrl || "tu org de Salesforce"}</b>
              {sf.connectedAt ? ` · desde ${new Date(sf.connectedAt).toLocaleDateString("es-PE")}` : ""}.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--danger btn--sm" onClick={onDisconnect}><Icon.Close size={13} /> Desconectar</button>
            </div>
          </>
        ) : (
          <>
            <div>
              <StepLabel n={1}>Elegí el entorno</StepLabel>
              <div className="row" style={{ gap: 0, border: "1px solid var(--border-2)", borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
                {(["production", "sandbox"] as const).map((e) => (
                  <button key={e} onClick={() => setEnv(e)} style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 600, background: env === e ? "var(--bg-3)" : "transparent", color: env === e ? "var(--text-1)" : "var(--text-3)" }}>
                    {e === "production" ? "Producción" : "Sandbox"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <StepLabel n={2}>Autorizá a ARIA</StepLabel>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>
                Te lleva al login de Salesforce, das consentimiento y volvés. Guardamos el token de forma segura (Secrets Manager) — nunca en tu navegador.
              </div>
              <button className="btn btn--primary btn--sm" onClick={onConnect}>
                <Icon.Cloud size={13} /> Conectar con Salesforce
              </button>
            </div>
          </>
        )}

        {/* Webhook de entrada (SF → ARIA): token per-tenant para el header
            x-vox-token del Flow de Salesforce. Reemplaza el secret global. */}
        <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Webhook de entrada (SF → ARIA)</div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>
            Para que tu Flow de Salesforce sincronice leads hacia ARIA, generá un
            token propio y pegalo en el Custom Header <code style={{ fontSize: 11.5 }}>x-vox-token</code> de
            la Named Credential del Flow. Es exclusivo de tu organización: nadie
            más puede escribir en tus datos con él.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn--sm" onClick={onGenerateInboundToken} disabled={genningToken}>
              {genningToken
                ? "Generando…"
                : sf.inboundTokenSet
                  ? <><Icon.Settings size={12} /> Rotar token</>
                  : <><Icon.Sparkles size={12} /> Generar token</>}
            </button>
            {sf.inboundTokenSet && !inboundToken && (
              <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
                Token activo{sf.inboundTokenRotatedAt ? ` · generado ${new Date(sf.inboundTokenRotatedAt).toLocaleDateString("es-PE")}` : ""}
              </span>
            )}
          </div>
          {inboundToken && (
            <div style={{ marginTop: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <code style={{ flex: 1, padding: "7px 10px", background: "var(--bg-2)", borderRadius: 6, fontSize: 12, border: "1px solid var(--border-1)", overflow: "auto", whiteSpace: "nowrap" }}>{inboundToken}</code>
                <button className="btn btn--sm" onClick={() => copy(inboundToken, "Token")}><Icon.Copy size={12} /> Copiar</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 6, color: "var(--accent-amber)", display: "flex", alignItems: "center", gap: 5 }}>
                <AlertTriangle size={12} style={{ flexShrink: 0 }} /> Copialo ahora: por seguridad no se vuelve a mostrar. Si lo perdés, rotá uno nuevo.
              </div>
            </div>
          )}
        </div>
      </div>
      {confirmDialog}
    </ConnCard>
  );
}

/* ── WhatsApp ────────────────────────────────────────────────────────────
 * Dos modos, con diferencia clara:
 *  • "aws"  — número NATIVO vinculado a tu Connect (AWS End User Messaging):
 *             entra como contacto y lo atiende un AGENTE. Sin token. Recomendado.
 *  • "meta" — número de Meta aparte (Cloud API + token): SOLO plantillas/bots.
 */
function WhatsAppCard({
  config, update, awsNumbers,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
  awsNumbers: WhatsAppNumber[];
}) {
  const wa = config.whatsapp || {};
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"aws" | "meta">(
    wa.mode || (awsNumbers.length > 0 ? "aws" : "meta")
  );
  const [selectedAws, setSelectedAws] = useState(
    wa.metaPhoneNumberId || awsNumbers[0]?.metaPhoneNumberId || ""
  );
  const [phoneNumberId, setPhoneNumberId] = useState(wa.mode !== "aws" ? wa.phoneNumberId || "" : "");
  const [wabaId, setWabaId] = useState(wa.mode !== "aws" ? wa.wabaId || "" : "");
  const [token, setToken] = useState("");
  const ep = getApiEndpoints();

  const isAws = wa.mode === "aws";
  const connected = isAws ? !!wa.phoneNumberId : !!(wa.phoneNumberId && wa.tokenSet);
  const tone: Tone = connected ? "ok" : wa.phoneNumberId ? "warn" : "idle";
  const statusLabel = connected
    ? isAws ? "Conectado · Connect" : "Conectado · Meta"
    : wa.phoneNumberId ? "Falta token" : "No conectado";

  const persist = async (next: WhatsAppConn, secret?: string): Promise<boolean> => {
    if (ep?.manageConnections) {
      try {
        await authedFetch(ep.manageConnections, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ whatsappSecret: secret || undefined, config: { ...config, whatsapp: next } }),
        });
      } catch { toast.error("No se pudo guardar"); return false; }
    }
    update({ whatsapp: next });
    return true;
  };

  const onSaveAws = async () => {
    const num = awsNumbers.find((n) => n.metaPhoneNumberId === selectedAws);
    if (!num) { toast.error("Elegí un número de la lista"); return; }
    // Modo AWS: SIN token — AWS End User Messaging maneja la auth de la WABA.
    const ok = await persist({
      mode: "aws",
      phoneNumberId: num.phoneNumberId || num.metaPhoneNumberId,
      metaPhoneNumberId: num.metaPhoneNumberId,
      wabaId: num.wabaId,
      tokenSet: true,
      connectedAt: new Date().toISOString(),
    });
    if (ok) toast.success(`WhatsApp conectado · ${num.displayPhoneNumber}`);
  };

  const onSaveMeta = async () => {
    if (!phoneNumberId.trim()) { toast.error("Falta el Phone Number ID"); return; }
    const ok = await persist({
      mode: "meta",
      phoneNumberId: phoneNumberId.trim(),
      wabaId: wabaId.trim() || undefined,
      tokenSet: !!token || wa.tokenSet,
      connectedAt: new Date().toISOString(),
    }, token || undefined);
    if (ok) { setToken(""); toast.success("WhatsApp (número de Meta) guardado"); }
  };

  return (
    <ConnCard
      icon={<Icon.WhatsApp size={20} style={{ color: "#25D366" }} />}
      title="WhatsApp"
      desc="Conectá el número que ya está vinculado a tu Amazon Connect, o usá un número de Meta aparte."
      tone={tone} statusLabel={statusLabel} open={open} onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* La observación: la diferencia entre los dos tipos de número */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--accent-green) 35%, transparent)", background: "color-mix(in srgb, var(--accent-green) 8%, transparent)" }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={14} style={{ flexShrink: 0, color: "var(--accent-green)" }} /> Número de Connect (AWS)</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
              Lo atiende un <b>agente</b> en el desktop: entra como contacto, con colas, routing y Contact Lens. Entrante + saliente. Sin token.
            </div>
          </div>
          <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-1)", background: "var(--bg-2)" }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}><Send size={13} style={{ flexShrink: 0 }} /> Número de Meta aparte</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
              Envía <b>plantillas</b> (campañas) por Cloud API de Meta. Bots entrantes por webhook <i>(en construcción)</i>. <b>No</b> tiene agente en vivo de Connect.
            </div>
          </div>
        </div>

        {/* Selector de modo */}
        <div className="row" style={{ gap: 0, border: "1px solid var(--border-2)", borderRadius: 8, overflow: "hidden", width: "fit-content" }}>
          {([["aws", "Número de Connect"], ["meta", "Número de Meta aparte"]] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 600, background: mode === m ? "var(--bg-3)" : "transparent", color: mode === m ? "var(--text-1)" : "var(--text-3)" }}>
              {label}
            </button>
          ))}
        </div>

        {mode === "aws" ? (
          awsNumbers.length > 0 ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {awsNumbers.map((n) => {
                  const sel = selectedAws === n.metaPhoneNumberId;
                  return (
                    <label key={n.metaPhoneNumberId || n.phoneNumberArn} className="row" style={{ gap: 10, padding: "10px 12px", borderRadius: 8, cursor: "pointer", alignItems: "center", background: sel ? "var(--accent-green-soft)" : "var(--bg-2)", border: `1px solid ${sel ? "var(--accent-green)" : "var(--border-1)"}` }}>
                      <input type="radio" name="wa-aws-number" checked={sel} onChange={() => setSelectedAws(n.metaPhoneNumberId || "")} />
                      <Icon.WhatsApp size={16} style={{ color: "#25D366" }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{n.displayPhoneNumber} · {n.displayName}</div>
                        <div className="muted" style={{ fontSize: 11 }}>WABA {n.wabaName || n.wabaId}{n.qualityRating ? ` · calidad ${n.qualityRating}` : ""}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="row"><button className="btn btn--primary btn--sm" onClick={onSaveAws}>Usar este número</button></div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12.5, padding: "8px 0", lineHeight: 1.6 }}>
              No detectamos números vinculados a tu Amazon Connect. Vinculá uno en <b>AWS End User Messaging → WhatsApp</b> (queda atado a tu instancia), o usá un número de Meta aparte en la otra pestaña.
            </div>
          )
        ) : (
          <>
            <div className="camp-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label>
                <span style={labelStyle}>Phone Number ID</span>
                <input style={inputStyle} autoComplete="off" name="wa-phone-number-id" placeholder="1029384756…" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
              </label>
              <label>
                <span style={labelStyle}>WABA ID (opcional)</span>
                <input style={inputStyle} autoComplete="off" name="wa-waba-id" placeholder="ID de la cuenta de WhatsApp Business" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
              </label>
            </div>
            <label>
              <span style={labelStyle}>Token de acceso {wa.tokenSet ? "(ya guardado — dejá vacío para mantenerlo)" : ""}</span>
              <input style={inputStyle} type="password" autoComplete="new-password" name="wa-access-token" placeholder={wa.tokenSet ? "••••••••••••" : "Token permanente de Meta"} value={token} onChange={(e) => setToken(e.target.value)} />
              <span className="muted" style={{ fontSize: 10.5, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                <Lock size={11} style={{ flexShrink: 0 }} /> El token se guarda cifrado en el backend (Secrets Manager), nunca en tu navegador.
              </span>
            </label>
            <div className="row"><button className="btn btn--primary btn--sm" onClick={onSaveMeta}>Guardar</button></div>
          </>
        )}

        {/* ── Formularios (WhatsApp Flows, #10) — común a ambos modos ──
            El Flow (las pantallas) se diseña y publica en Meta Business
            Manager → WhatsApp Manager → Flows; acá se registra su flow_id
            para que el agente pueda enviarlo desde el chat. La respuesta
            del cliente vuelve sola al CRM (lead + automatizaciones). */}
        <WaFlowsEditor wa={wa} persist={persist} />
      </div>
    </ConnCard>
  );
}

function WaFlowsEditor({
  wa,
  persist,
}: {
  wa: WhatsAppConn;
  persist: (next: WhatsAppConn) => Promise<boolean>;
}) {
  const flows = wa.flows || [];
  const [nId, setNId] = useState("");
  const [nName, setNName] = useState("");
  const [nCta, setNCta] = useState("");
  const [nScreen, setNScreen] = useState("");

  const save = async (next: WhatsAppConn["flows"]) => {
    const ok = await persist({ ...wa, flows: next });
    if (ok) toast.success("Formularios actualizados");
  };

  const add = async () => {
    if (!nId.trim() || !nName.trim()) {
      toast.error("Pegá el flow_id y un nombre");
      return;
    }
    await save([
      ...flows,
      {
        id: nId.trim(),
        name: nName.trim(),
        cta: nCta.trim() || undefined,
        screen: nScreen.trim() || undefined,
      },
    ]);
    setNId(""); setNName(""); setNCta(""); setNScreen("");
  };

  return (
    <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        Formularios (WhatsApp Flows)
      </div>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 10 }}>
        Formularios multi-pantalla DENTRO del chat. Diseñalos y publicalos en{" "}
        <b>Meta Business Manager → WhatsApp Manager → Flows</b> y pegá acá su{" "}
        <b>flow_id</b>. El agente los envía desde el chat; la respuesta crea/actualiza
        el lead y dispara Automatizaciones ("Formulario completado").
      </div>
      {flows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {flows.map((f, i) => (
            <div key={f.id + i} className="row" style={{ gap: 10, padding: "8px 10px", background: "var(--bg-2)", borderRadius: 8, alignItems: "center" }}>
              <ClipboardList size={14} style={{ flexShrink: 0, color: "var(--accent-pink)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.name}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>
                  id {f.id}
                  {f.cta ? ` · botón "${f.cta}"` : ""}
                  {f.screen ? ` · pantalla ${f.screen}` : ""}
                </div>
              </div>
              <button
                className="btn btn--ghost btn--sm"
                aria-label={`Quitar ${f.name}`}
                onClick={() => save(flows.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.7fr 0.7fr auto", gap: 8, alignItems: "end" }}>
        <label>
          <span style={labelStyle}>flow_id</span>
          <input style={inputStyle} placeholder="1234567890…" value={nId} onChange={(e) => setNId(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Nombre</span>
          <input style={inputStyle} placeholder="Solicitud de info" value={nName} onChange={(e) => setNName(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Botón (opc.)</span>
          <input style={inputStyle} placeholder="Completar" value={nCta} onChange={(e) => setNCta(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Pantalla (opc.)</span>
          <input style={inputStyle} placeholder="INICIO" value={nScreen} onChange={(e) => setNScreen(e.target.value)} />
        </label>
        <button className="btn btn--sm" onClick={add} style={{ height: 34 }}>
          Agregar
        </button>
      </div>
    </div>
  );
}

/* ── Mensajes (textos automáticos configurables por tenant) ──────────────
   De-Novasys-ificación (#2): la despedida de chat/WhatsApp ya no está
   hardcodeada con texto de UDEP en el código; vive en la config del tenant y
   se edita acá. Vacío → el producto usa un default genérico sin marca. */
function MessagingCard({ config, update }: { config: ConnectionsConfig; update: (patch: Partial<ConnectionsConfig>) => void }) {
  const msg = config.messaging || {};
  const brand = config.branding || {};
  const [open, setOpen] = useState(false);
  const [farewell, setFarewell] = useState(msg.chatFarewell || "");
  const [productName, setProductName] = useState(brand.productName || "");
  const dirty =
    farewell.trim() !== (msg.chatFarewell || "") ||
    productName.trim() !== (brand.productName || "");
  const tone: Tone = brand.productName?.trim() || msg.chatFarewell?.trim() ? "ok" : "idle";
  const onSave = () => {
    update({
      branding: { ...brand, productName: productName.trim() || undefined },
      messaging: { ...msg, chatFarewell: farewell.trim() || undefined },
    });
    toast.success("Marca y mensajes guardados");
  };
  return (
    <ConnCard
      icon={<Palette size={20} />}
      title="Marca y mensajes"
      desc="Personalizá el nombre de producto que ven tus agentes (white-label) y los textos automáticos que reciben tus clientes. Vacío = valores por defecto de ARIA."
      tone={tone}
      statusLabel={brand.productName?.trim() || msg.chatFarewell?.trim() ? "Personalizado" : "Por defecto"}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label>
          <span style={labelStyle}>Nombre de producto (marca)</span>
          <input
            style={inputStyle}
            placeholder="ARIA"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 10.5, marginTop: 3, display: "block" }}>
            Se muestra en la barra lateral y el título de la pestaña (white-label). El login sigue con la marca de plataforma.
          </span>
        </label>
        <label>
          <span style={labelStyle}>Despedida de chat / WhatsApp</span>
          <textarea
            style={{ ...inputStyle, minHeight: 120, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            placeholder="👋 ¡Gracias por escribirnos! Esperamos haberte ayudado…"
            value={farewell}
            onChange={(e) => setFarewell(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 10.5, marginTop: 3, display: "block" }}>
            Se envía al cliente cuando el agente cierra el chat. Soporta saltos de línea y *negrita* de WhatsApp.
          </span>
        </label>
        <div className="row">
          <button className="btn btn--primary btn--sm" onClick={onSave} disabled={!dirty}>Guardar</button>
        </div>
      </div>
    </ConnCard>
  );
}

export function IntegrationsManager() {
  const { config, save, hasBackend, loading, whatsappNumbers } = useConnections();
  const update = (patch: Partial<ConnectionsConfig>) => save({ ...config, ...patch });

  // Esperamos a que la config del tenant llegue del backend ANTES de montar las
  // tarjetas. Cada tarjeta inicializa su `draft` UNA sola vez (useState lazy); si
  // renderizáramos con la config inicial vacía, ese draft capturaría un
  // externalId recién generado al azar e ignoraría el que el tenant ya tiene
  // guardado. Resultado: el rol cross-account existente no verificaría
  // (sts:ExternalId mismatch). Montar recién con la config cargada evita esa
  // desincronización para cualquier sesión nueva / browser limpio.
  if (loading) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <div className="muted" style={{ fontSize: 13, padding: "24px 4px" }}>
          Cargando integraciones…
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      {!hasBackend && (
        <div
          className="row"
          style={{
            gap: 10, padding: "10px 14px", borderRadius: 12,
            border: "1px solid color-mix(in srgb, var(--accent-amber) 35%, transparent)",
            background: "color-mix(in srgb, var(--accent-amber) 10%, transparent)",
          }}
        >
          <Icon.Lightning size={16} style={{ color: "var(--accent-amber)", flexShrink: 0 }} />
          <span className="muted" style={{ fontSize: 12 }}>
            Vista previa de Integraciones. La config se guarda localmente por ahora; el <b>guardado seguro de secretos</b> (Secrets Manager), la <b>verificación real</b> y la <b>conexión por organización</b> llegan con el backend multi-tenant (Cognito + connections).
          </span>
        </div>
      )}
      <AmazonConnectCard config={config} update={update} />
      <SalesforceCard config={config} update={update} />
      <WhatsAppCard config={config} update={update} awsNumbers={whatsappNumbers} />
      <MessagingCard config={config} update={update} />
    </div>
  );
}
