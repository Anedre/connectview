import { useState, useEffect, useCallback, type ReactNode, type CSSProperties } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Send,
  Lock,
  Palette,
  ClipboardList,
  Trash2,
  ShoppingBag,
} from "lucide-react";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import {
  useConnections,
  effectiveWaNumbers,
  type ConnectionsConfig,
  type ConnectConn,
  type WhatsAppConn,
  type WhatsAppNumber,
  type WhatsAppNumberRef,
  type SsoConn,
  type MetaConn,
  type MetaAccountRef,
} from "@/hooks/useConnections";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { RadioCards } from "@/components/ui/radio-cards";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import outputs from "../../../amplify_outputs.json";

/**
 * IntegrationsManager — Configuración → Integraciones. El cliente conecta SU
 * Amazon Connect (BYO, rol cross-account), SU Salesforce (OAuth) y WhatsApp.
 * Es la superficie del SaaS: "conecta tu cuenta y usa Vox".
 *
 * Estado actual: la config NO sensible se guarda (local hoy, backend luego).
 * Los secretos (token WA, refresh token SF) y la verificación real viven en el
 * backend (Secrets Manager + assume-role) — próximo paso.
 */

// Regiones donde Amazon Connect está disponible.
const CONNECT_REGIONS = [
  "us-east-1",
  "us-west-2",
  "af-south-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ca-central-1",
  "eu-central-1",
  "eu-west-2",
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
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
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
      "Abre la app sobre HTTPS para generar el ExternalId de forma segura.",
  );
}

/** Tarjeta genérica de conexión con header + estado + cuerpo expandible. */
function ConnCard({
  icon,
  title,
  desc,
  tone,
  statusLabel,
  open,
  onToggle,
  children,
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
          <span
            style={{
              flex: "0 0 auto",
              display: "grid",
              placeItems: "center",
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
            }}
          >
            {icon}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
              <StatusBadge tone={tone} label={statusLabel} />
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
              {desc}
            </div>
          </div>
          <button className="btn btn--sm" onClick={onToggle}>
            {open ? (
              <>Cerrar</>
            ) : (
              <>
                <Icon.Settings size={13} /> Configurar
              </>
            )}
          </button>
        </div>
        {open && (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--border-1)", paddingTop: 16 }}>
            {children}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function StepLabel({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="row" style={{ gap: 8, marginBottom: 8 }}>
      <span
        style={{
          flex: "0 0 auto",
          display: "grid",
          placeItems: "center",
          width: 20,
          height: 20,
          borderRadius: 999,
          background: "var(--accent-cyan-soft)",
          color: "var(--accent-cyan)",
          fontSize: 11,
          fontWeight: 800,
        }}
      >
        {n}
      </span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{children}</span>
    </div>
  );
}

const labelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  fontWeight: 600,
};

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copiado`),
    () => toast.error("No se pudo copiar"),
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
function AmazonConnectCard({
  config,
  update,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
}) {
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
  const statusLabel = !c.instanceUrl
    ? "No conectado"
    : !c.roleArn
      ? "Incompleto"
      : !c.verifiedAt
        ? "Sin verificar"
        : "Conectado";

  const set = (patch: Partial<ConnectConn>) => setDraft((d) => ({ ...d, ...patch }));
  const onSave = () => {
    if (!draft.instanceUrl?.trim()) {
      toast.error("Falta la URL de tu instancia de Connect");
      return;
    }
    update({
      connect: {
        ...draft,
        instanceUrl: draft.instanceUrl.trim(),
        roleArn: draft.roleArn?.trim(),
        verifiedAt: undefined,
      },
    });
    toast.success("Conexión de Amazon Connect guardada");
  };
  const onVerify = async () => {
    if (!ep?.verifyConnectConnection) {
      toast.message("La verificación real estará disponible al desplegar el backend.");
      return;
    }
    if (!draft.roleArn?.trim()) {
      toast.error("Pega primero el ARN del rol");
      return;
    }
    setVerifying(true);
    try {
      const r = await fetch(ep.verifyConnectConnection, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleArn: draft.roleArn.trim(),
          externalId: draft.externalId,
          instanceArn: draft.instanceArn,
          region: draft.region,
        }),
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
    if (!draft.roleArn?.trim()) {
      toast.error("Pega primero el ARN del rol (paso 3)");
      return;
    }
    setVerifyingDp(true);
    try {
      const r = await fetch(ep.verifyConnectConnection, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        const missing =
          Array.isArray(j.missingTables) && j.missingTables.length
            ? ` Tablas faltantes: ${j.missingTables.slice(0, 5).join(", ")}${j.missingTables.length > 5 ? "…" : ""}`
            : "";
        throw new Error((j.error || "No se pudo verificar el data plane") + missing);
      }
      const dataPlaneVerifiedAt = new Date().toISOString();
      update({ connect: { ...draft, dataPlaneVerifiedAt } });
      setDraft((d) => ({ ...d, dataPlaneVerifiedAt }));
      toast.success(`Las 14 tablas existen en tu cuenta. ARIA ya escribe aquí.`);
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
    if (!c.verifiedAt) {
      toast.error("Verifica la conexión a Connect primero (paso anterior).");
      return;
    }
    setProvisioning(true);
    try {
      const r = await authedFetch(ep.provisionContactFlows, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudieron provisionar los flows");
      const n = Object.keys(j.flows || {}).length;
      toast.success(
        `${n} contact flows de ARIA listos en tu instancia (cola: ${j.resolvedQueue?.name || "—"}).`,
      );
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
      tone={tone}
      statusLabel={statusLabel}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      {wizardOpen && (
        <ConnectSetupWizard
          initial={draft}
          onSave={(next) => {
            update({ connect: { ...next } });
            setDraft((d) => ({ ...d, ...next }));
          }}
          onClose={() => setWizardOpen(false)}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Asistente guiado (recomendado para no-técnicos) */}
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderRadius: 10,
            background: "linear-gradient(135deg, var(--accent-amber-soft), transparent)",
            border: "1px solid color-mix(in srgb, var(--accent-amber) 30%, transparent)",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              ¿Primera vez? Usa el asistente guiado
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              Te lleva paso a paso, con un clic para crear el rol en tu cuenta AWS. ~3 minutos.
            </div>
          </div>
          <button
            className="btn btn--primary"
            onClick={() => setWizardOpen(true)}
            style={{ flex: "0 0 auto" }}
          >
            <Icon.Sparkles size={14} /> Abrir asistente
          </button>
        </div>

        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-3)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            fontWeight: 600,
          }}
        >
          O configura manualmente
        </div>

        {/* Paso 1 */}
        <div>
          <StepLabel n={1}>URL y región de tu instancia</StepLabel>
          <div
            className="camp-2col"
            style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10 }}
          >
            <label>
              <span style={labelStyle}>URL de la instancia</span>
              <Input
                placeholder="https://tu-empresa.my.connect.aws"
                value={draft.instanceUrl || ""}
                onChange={(e) => set({ instanceUrl: e.target.value })}
              />
            </label>
            <label>
              <span style={labelStyle}>Región</span>
              <Select
                value={draft.region || "us-east-1"}
                onValueChange={(nv) => nv && set({ region: nv })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{draft.region || "us-east-1"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CONNECT_REGIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <label style={{ display: "block", marginTop: 10 }}>
            <span style={labelStyle}>ARN de la instancia (opcional, recomendado)</span>
            <Input
              placeholder="arn:aws:connect:us-east-1:123456789012:instance/…"
              value={draft.instanceArn || ""}
              onChange={(e) => set({ instanceArn: e.target.value })}
            />
          </label>
        </div>

        {/* Paso 2 */}
        <div>
          <StepLabel n={2}>Permitir que ARIA embeba tu CCP</StepLabel>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            En tu consola de Connect → <b>Configuración de la aplicación → Orígenes aprobados</b>,
            agrega este dominio:
          </div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <code
              style={{
                flex: 1,
                padding: "7px 10px",
                background: "var(--bg-2)",
                borderRadius: 6,
                fontSize: 12,
                border: "1px solid var(--border-1)",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {appOrigin}
            </code>
            <button className="btn btn--sm" onClick={() => copy(appOrigin, "Dominio")}>
              <Icon.Copy size={12} /> Copiar
            </button>
          </div>
        </div>

        {/* Paso 3 */}
        <div>
          <StepLabel n={3}>Dar acceso seguro (rol cross-account)</StepLabel>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Crea un rol IAM en TU cuenta AWS que ARIA pueda asumir (no creamos nada en tu cuenta,
            solo lo asumimos). Despliega esta plantilla CloudFormation y pega el <b>RoleArn</b> de
            salida.
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn--sm"
              onClick={() =>
                copy(
                  connectCfnTemplate(draft.externalId || "", draft.instanceArn || ""),
                  "Plantilla CloudFormation",
                )
              }
            >
              <Icon.Copy size={12} /> Copiar plantilla CloudFormation
            </button>
            <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
              External ID: <code style={{ fontSize: 11 }}>{draft.externalId}</code>
            </span>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--accent-cyan)" }}>
              Ver plantilla
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                fontSize: 10.5,
                overflow: "auto",
                maxHeight: 220,
                lineHeight: 1.4,
              }}
            >
              {connectCfnTemplate(draft.externalId || "", draft.instanceArn || "")}
            </pre>
          </details>
          <label style={{ display: "block", marginTop: 10 }}>
            <span style={labelStyle}>ARN del rol creado</span>
            <Input
              placeholder="arn:aws:iam::123456789012:role/VoxCrmConnectAccess"
              value={draft.roleArn || ""}
              onChange={(e) => set({ roleArn: e.target.value })}
            />
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
              <Input
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
            tipificaciones y audit viven en TU cuenta AWS. Despliega esta plantilla: crea las 14
            tablas DynamoDB en TU cuenta y extiende el rol existente con permisos de
            lectura/escritura sobre ellas.{" "}
            <b>Es un paso necesario: sin esto, ARIA no tiene dónde guardar tus datos.</b>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn--sm"
              onClick={() => copy(dataPlaneCfnTemplate(), "Plantilla Data Plane")}
            >
              <Icon.Copy size={12} /> Copiar plantilla Data Plane
            </button>
            <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
              Pre-requisito: el rol del paso 3 ya creado
            </span>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--accent-cyan)" }}>
              Ver plantilla Data Plane
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                fontSize: 10.5,
                overflow: "auto",
                maxHeight: 220,
                lineHeight: 1.4,
              }}
            >
              {dataPlaneCfnTemplate()}
            </pre>
          </details>

          {/* Toggle de activación + verificación. CRÍTICO: sin tildar esto, Vox sigue escribiendo
              en su cuenta aunque hayas aplicado el CFN. Una vez tildado, las lecturas/escrituras van
              a TU cuenta (assume-role). Si las tablas no existen → 500 ResourceNotFoundException. */}
          <label
            className="row"
            style={{
              gap: 10,
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 8,
              background: draft.dataPlaneEnabled ? "var(--accent-green-soft)" : "var(--bg-2)",
              border: `1px solid ${draft.dataPlaneEnabled ? "var(--accent-green)" : "var(--border-1)"}`,
              cursor: "pointer",
              alignItems: "flex-start",
            }}
          >
            <span style={{ marginTop: 2, display: "inline-flex" }}>
              <Switch
                checked={!!draft.dataPlaneEnabled}
                onCheckedChange={(checked) =>
                  set({ dataPlaneEnabled: checked, dataPlaneVerifiedAt: undefined })
                }
                accent="var(--accent-green)"
                aria-label="Activar BYO Data Plane"
              />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Activar BYO Data Plane</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
                Marca esto SOLO después de haber aplicado el CFN del paso 4 en tu cuenta. A partir
                de ese momento ARIA lee/escribe en TU DynamoDB; si las tablas no existen las
                llamadas van a fallar.
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
                {verifyingDp ? (
                  "Verificando tablas…"
                ) : (
                  <>
                    <Icon.Check size={12} /> Verificar tablas
                  </>
                )}
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
          <button className="btn btn--primary" onClick={onSave}>
            Guardar
          </button>
          <button className="btn" onClick={onVerify} disabled={verifying || !draft.roleArn}>
            {verifying ? (
              "Verificando…"
            ) : (
              <>
                <Icon.Check size={13} /> Verificar conexión
              </>
            )}
          </button>
          {c.verifiedAt && (
            <button
              className="btn"
              onClick={onProvisionFlows}
              disabled={provisioning}
              title="Crea los contact flows de ARIA (entrante, saliente, despedida) en tu instancia de Connect."
            >
              {provisioning ? (
                "Provisionando…"
              ) : (
                <>
                  <Icon.Lightning size={13} /> Provisionar flows
                </>
              )}
            </button>
          )}
          {c.verifiedAt && (
            <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
              Verificada {new Date(c.verifiedAt).toLocaleString("es-PE")}
            </span>
          )}
        </div>

        {/* Panel de diagnóstico: auto-corre los health-checks contra el Connect
            del cliente y muestra qué features faltan + cómo activarlas. */}
        <IntegrationHealthPanel hasConnect={!!c.instanceUrl && !!c.roleArn} />
      </div>
    </ConnCard>
  );
}

/* ── Salesforce (OAuth web) ─────────────────────────────────────────── */
/** Pilar 10 — campos de ARIA mapeables al Lead de Salesforce + su default. */
const ARIA_SF_FIELDS: { key: string; label: string; def: string; hint: string }[] = [
  { key: "firstName", label: "Nombre", def: "FirstName", hint: "Nombre del lead" },
  { key: "phone", label: "Teléfono", def: "Phone", hint: "Teléfono normalizado (E.164)" },
  { key: "email", label: "Email", def: "Email", hint: "Correo del lead" },
  { key: "company", label: "Empresa", def: "Company", hint: "Empresa (requerida por SF al crear)" },
  {
    key: "status",
    label: "Etapa → Status",
    def: "Status",
    hint: "Etapa del embudo (vía salesforceValue)",
  },
  { key: "source", label: "Origen", def: "LeadSource", hint: "Canal/fuente del lead" },
];

interface SfDescField {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  /** Valores del picklist (si type === "picklist") — para importar la tipificación. */
  picklistValues?: { label: string; value: string }[];
}

/** Mapeo schema-aware (Pilar 10): descubre los campos reales del Lead de la org
 *  del tenant y deja al admin elegir a qué campo escribe cada dato de ARIA. */
function SfFieldMapper({
  config,
  update,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
}) {
  const ep = getApiEndpoints();
  const sf = config.salesforce || {};
  const stored = (sf.fieldMapping || {}) as Record<string, string>;
  const [fields, setFields] = useState<SfDescField[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const f of ARIA_SF_FIELDS) m[f.key] = stored[f.key] ?? f.def;
    return m;
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovered, setDiscovered] = useState(false);
  // Tipificación ↔ Salesforce: dirección + campo SF.
  const { docs: taxDocs, refetch: refetchTax } = useTaxonomy();
  const tip = sf.tipificacion || { source: "salesforce" as const, field: "" };
  const [tipSource, setTipSource] = useState<"salesforce" | "aria">(tip.source || "salesforce");
  const [tipField, setTipField] = useState<string>(tip.field || "");
  const [importing, setImporting] = useState(false);
  // Campos elegibles: para importar solo picklists; para escribir, texto/picklist.
  const tipFieldOptions =
    tipSource === "salesforce"
      ? fields.filter((f) => (f.picklistValues?.length ?? 0) > 0 || f.type === "picklist")
      : fields.filter((f) => ["string", "textarea", "picklist"].includes(f.type));

  /** SF → ARIA: importa los valores del picklist elegido como tipificación de ARIA,
   *  MERGE no destructivo (agrega solo los salesforceValue que falten). */
  const importTipificacion = async () => {
    const field = fields.find((f) => f.name === tipField);
    const values = field?.picklistValues || [];
    if (!values.length) {
      toast.error("Ese campo no tiene valores de picklist");
      return;
    }
    if (!ep?.manageTaxonomy) return;
    setImporting(true);
    try {
      const doc = taxDocs.find((d) => d.isDefault) || taxDocs[0];
      const existing = doc?.stages || [];
      const haveSf = new Set(
        existing.map((s) => (s.salesforceValue || "").trim().toLowerCase()).filter(Boolean),
      );
      const added = values
        .filter((v) => !haveSf.has(String(v.value).trim().toLowerCase()))
        .map((v) => ({
          label: v.label || v.value,
          valoracion: "inicial" as const,
          salesforceValue: v.value,
          subStages: [] as { label: string }[],
        }));
      if (!added.length) {
        toast.message("Tu tipificación ya cubre todos los valores de Salesforce");
        return;
      }
      const payload = {
        taxonomyId: doc?.taxonomyId,
        name: doc?.name || "Tipificación",
        isDefault: doc?.isDefault ?? true,
        stages: [
          ...existing.map((s) => ({
            id: s.id,
            label: s.label,
            valoracion: s.valoracion,
            description: s.description,
            salesforceValue: s.salesforceValue,
            subStages: s.subStages.map((ss) => ({ id: ss.id, label: ss.label })),
          })),
          ...added,
        ],
        actor: "admin",
      };
      const r = await authedFetch(ep.manageTaxonomy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json())?.error || "No se pudo importar");
      toast.success(`${added.length} tipificación(es) importadas de Salesforce`);
      await refetchTax(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo importar");
    } finally {
      setImporting(false);
    }
  };

  const discover = async () => {
    if (!ep?.salesforceSync) {
      toast.message("El backend de Salesforce se habilita al desplegar.");
      return;
    }
    setLoading(true);
    try {
      const r = await authedFetch(`${ep.salesforceSync}?mode=describe`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo leer el esquema");
      setFields(Array.isArray(j.fields) ? j.fields : []);
      setDiscovered(true);
      toast.success(`${(j.fields || []).length} campos descubiertos en tu org`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo descubrir el esquema");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!ep?.manageConnections) return;
    setSaving(true);
    try {
      const nextSf = {
        ...sf,
        fieldMapping: mapping,
        tipificacion: { source: tipSource, field: tipField },
      };
      // POST el config COMPLETO (manage-connections reemplaza el configJson) con
      // el mapeo dentro de salesforce → no pisa la conexión/instanceUrl.
      const r = await authedFetch(ep.manageConnections, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...config, salesforce: nextSf } }),
      });
      if (!r.ok) throw new Error((await r.json())?.error || "No se pudo guardar");
      update({ salesforce: nextSf });
      toast.success("Mapeo guardado — el próximo sync escribe estos campos");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el mapeo");
    } finally {
      setSaving(false);
    }
  };

  const standard = fields.filter((f) => !f.custom);
  const custom = fields.filter((f) => f.custom);

  return (
    <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 14 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        <div style={{ fontWeight: 600, fontSize: 13 }}>Mapeo de campos a Salesforce</div>
        <button className="btn btn--sm" onClick={discover} disabled={loading}>
          {loading ? (
            "Descubriendo…"
          ) : (
            <>
              <Icon.Sparkles size={12} />{" "}
              {discovered ? "Volver a descubrir" : "Descubrir campos de mi org"}
            </>
          )}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "8px 0 12px" }}>
        ARIA <b>no crea campos</b> en tu Salesforce: tú eliges a qué campo de tu Lead se escribe
        cada dato. Descubre tu esquema y mapea. «No escribir» deja ese dato sin sincronizar.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ARIA_SF_FIELDS.map((f) => (
          <div
            key={f.key}
            className="row"
            style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}
          >
            <div style={{ width: 150, minWidth: 150 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.label}</div>
              <div className="muted" style={{ fontSize: 10.5 }}>
                {f.hint}
              </div>
            </div>
            <span style={{ color: "var(--text-3)" }}>→</span>
            <Select
              value={mapping[f.key] ?? ""}
              onValueChange={(nv) => setMapping((m) => ({ ...m, [f.key]: nv ?? "" }))}
              disabled={!discovered}
            >
              <SelectTrigger style={{ flex: 1, minWidth: 180 }}>
                <SelectValue>
                  {(() => {
                    const cur = mapping[f.key] ?? "";
                    if (!cur) return "— No escribir —";
                    const cf = [...standard, ...custom].find((sfF) => sfF.name === cur);
                    return cf
                      ? `${cf.custom ? "✦ " : ""}${cf.label} · ${cf.name}`
                      : `${cur} (actual)`;
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— No escribir —</SelectItem>
                {mapping[f.key] &&
                  ![...standard, ...custom].some((sfF) => sfF.name === mapping[f.key]) && (
                    <SelectItem value={mapping[f.key]}>{mapping[f.key]} (actual)</SelectItem>
                  )}
                {standard.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Estándar</SelectLabel>
                    {standard.map((sfF) => (
                      <SelectItem key={sfF.name} value={sfF.name}>
                        {sfF.label} · {sfF.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {custom.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Personalizados</SelectLabel>
                    {custom.map((sfF) => (
                      <SelectItem key={sfF.name} value={sfF.name}>
                        ✦ {sfF.label} · {sfF.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {/* ── Tipificación ↔ Salesforce (dirección + importar) ── */}
      <div style={{ borderTop: "1px solid var(--border-1)", marginTop: 16, paddingTop: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
          Tipificación ↔ Salesforce
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 10 }}>
          Decide quién manda en la tipificación (dispositions). <b>Salesforce manda</b> = importas
          su picklist a ARIA; <b>ARIA manda</b> = cada wrap-up escribe su tipificación en un campo
          de tu Lead.
        </div>
        <SegmentedControl
          value={tipSource}
          onValueChange={(v) => {
            setTipSource(v as "salesforce" | "aria");
            setTipField("");
          }}
          options={[
            { value: "salesforce", label: "Salesforce manda" },
            { value: "aria", label: "ARIA manda" },
          ]}
          size="sm"
        />
        <div
          className="row"
          style={{ gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}
        >
          <div style={{ width: 150, minWidth: 150, fontSize: 12.5 }}>
            {tipSource === "salesforce" ? "Picklist a importar" : "Campo donde escribir"}
          </div>
          <span style={{ color: "var(--text-3)" }}>
            {tipSource === "salesforce" ? "→ ARIA" : "ARIA →"}
          </span>
          <Select
            value={tipField}
            onValueChange={(nv) => setTipField(nv ?? "")}
            disabled={!discovered}
          >
            <SelectTrigger style={{ flex: 1, minWidth: 180 }}>
              <SelectValue>
                {(() => {
                  const cf = fields.find((f) => f.name === tipField);
                  return cf
                    ? `${cf.custom ? "✦ " : ""}${cf.label} · ${cf.name}`
                    : "— elige un campo —";
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— elige un campo —</SelectItem>
              {tipFieldOptions.map((f) => (
                <SelectItem key={f.name} value={f.name}>
                  {f.custom ? "✦ " : ""}
                  {f.label} · {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {tipSource === "salesforce" ? (
          <div
            className="row"
            style={{ marginTop: 10, gap: 8, alignItems: "center", flexWrap: "wrap" }}
          >
            <button
              className="btn btn--sm"
              onClick={importTipificacion}
              disabled={importing || !tipField || !discovered}
            >
              {importing ? (
                "Importando…"
              ) : (
                <>
                  <Icon.Sparkles size={12} /> Importar valores a ARIA
                </>
              )}
            </button>
            <span className="muted" style={{ fontSize: 11 }}>
              Agrega a tu taxonomía las tipificaciones de SF que falten — no borra nada.
            </span>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
            Usa un <b>campo de texto</b> de tu Lead. ARIA no crea ni gestiona el picklist de SF.
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 14, alignItems: "center" }}>
        <button
          className="btn btn--primary btn--sm"
          onClick={save}
          disabled={saving || !discovered}
        >
          <Icon.Check size={12} /> {saving ? "Guardando…" : "Guardar mapeo"}
        </button>
        {!discovered && (
          <span className="muted" style={{ fontSize: 11 }}>
            Descubre tu esquema primero para editar el mapeo.
          </span>
        )}
      </div>
    </div>
  );
}

function SalesforceCard({
  config,
  update,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
}) {
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
    if (
      sf.inboundTokenSet &&
      !(await confirm({
        title: "¿Rotar el token de entrada?",
        description:
          "Rotar el token invalida el anterior: el Flow de Salesforce dejará de " +
          "sincronizar hasta que pegues el token nuevo en su header.",
        destructive: true,
        confirmLabel: "Rotar token",
      }))
    )
      return;
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
      toast.success("Token de entrada generado — cópialo ahora (se muestra una sola vez)");
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
      if (j.authUrl) {
        window.location.assign(j.authUrl);
        return;
      }
      toast.error("No se obtuvo la URL de autorización");
    } catch {
      toast.error("No se pudo iniciar OAuth con Salesforce");
    }
  };
  const onDisconnect = async () => {
    if (
      !(await confirm({
        title: "¿Desconectar Salesforce?",
        description:
          "Se invalidará el token y ARIA dejará de sincronizar con tu org de Salesforce.",
        destructive: true,
        confirmLabel: "Desconectar",
      }))
    )
      return;
    update({ salesforce: { connected: false } });
    // Invalidar el token en el backend (no solo el flag): el GET deriva el
    // estado del secret, así que sin esto la desconexión no se reflejaría.
    if (ep?.manageConnections) {
      try {
        await authedFetch(ep.manageConnections, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            disconnectSalesforce: true,
            config: { ...config, salesforce: { connected: false } },
          }),
        });
      } catch {
        /* el flag local ya cambió; reintenta en el próximo focus */
      }
    }
    toast.success("Salesforce desconectado");
  };

  return (
    <ConnCard
      icon={<Icon.Cloud size={20} style={{ color: "#00A1E0" }} />}
      title="Salesforce"
      desc="Sincroniza leads, actividad e historial en ambos sentidos. Conexión con un clic vía OAuth (sin certificados)."
      tone={tone}
      statusLabel={statusLabel}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {sf.connected ? (
          <>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Conectado a <b>{sf.instanceUrl || "tu org de Salesforce"}</b>
              {sf.connectedAt
                ? ` · desde ${new Date(sf.connectedAt).toLocaleDateString("es-PE")}`
                : ""}
              .
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--danger btn--sm" onClick={onDisconnect}>
                <Icon.Close size={13} /> Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <StepLabel n={1}>Elige el entorno</StepLabel>
              <div
                className="row"
                style={{
                  gap: 0,
                  border: "1px solid var(--border-2)",
                  borderRadius: 6,
                  overflow: "hidden",
                  width: "fit-content",
                }}
              >
                {(["production", "sandbox"] as const).map((e) => (
                  <button
                    key={e}
                    onClick={() => setEnv(e)}
                    style={{
                      padding: "6px 14px",
                      fontSize: 12.5,
                      fontWeight: 600,
                      background: env === e ? "var(--bg-3)" : "transparent",
                      color: env === e ? "var(--text-1)" : "var(--text-3)",
                    }}
                  >
                    {e === "production" ? "Producción" : "Sandbox"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <StepLabel n={2}>Autoriza a ARIA</StepLabel>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>
                Te lleva al login de Salesforce, das consentimiento y vuelves. Guardamos el token de
                forma segura (Secrets Manager) — nunca en tu navegador.
              </div>
              <button className="btn btn--primary btn--sm" onClick={onConnect}>
                <Icon.Cloud size={13} /> Conectar con Salesforce
              </button>
            </div>
          </>
        )}

        {/* Pilar 10 — mapeo schema-aware de campos (solo cuando hay conexión). */}
        {sf.connected && <SfFieldMapper config={config} update={update} />}

        {/* Webhook de entrada (SF → ARIA): token per-tenant para el header
            x-vox-token del Flow de Salesforce. Reemplaza el secret global. */}
        <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            Webhook de entrada (SF → ARIA)
          </div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>
            Para que tu Flow de Salesforce sincronice leads hacia ARIA, genera un token propio y
            pégalo en el Custom Header <code style={{ fontSize: 11.5 }}>x-vox-token</code> de la
            Named Credential del Flow. Es exclusivo de tu organización: nadie más puede escribir en
            tus datos con él.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn--sm"
              onClick={onGenerateInboundToken}
              disabled={genningToken}
            >
              {genningToken ? (
                "Generando…"
              ) : sf.inboundTokenSet ? (
                <>
                  <Icon.Settings size={12} /> Rotar token
                </>
              ) : (
                <>
                  <Icon.Sparkles size={12} /> Generar token
                </>
              )}
            </button>
            {sf.inboundTokenSet && !inboundToken && (
              <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
                Token activo
                {sf.inboundTokenRotatedAt
                  ? ` · generado ${new Date(sf.inboundTokenRotatedAt).toLocaleDateString("es-PE")}`
                  : ""}
              </span>
            )}
          </div>
          {inboundToken && (
            <div style={{ marginTop: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <code
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    background: "var(--bg-2)",
                    borderRadius: 6,
                    fontSize: 12,
                    border: "1px solid var(--border-1)",
                    overflow: "auto",
                    whiteSpace: "nowrap",
                  }}
                >
                  {inboundToken}
                </code>
                <button className="btn btn--sm" onClick={() => copy(inboundToken, "Token")}>
                  <Icon.Copy size={12} /> Copiar
                </button>
              </div>
              <div
                className="muted"
                style={{
                  fontSize: 11,
                  marginTop: 6,
                  color: "var(--accent-amber)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <AlertTriangle size={12} style={{ flexShrink: 0 }} /> Cópialo ahora: por seguridad
                no se vuelve a mostrar. Si lo pierdes, rota uno nuevo.
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
  config,
  update,
  awsNumbers,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
  awsNumbers: WhatsAppNumber[];
}) {
  const wa = config.whatsapp || {};
  const numbers = effectiveWaNumbers(wa);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(numbers.length === 0);
  const ep = getApiEndpoints();
  const { confirm, confirmDialog } = useConfirm();

  // Form de alta de UN número (se agrega a numbers[] vía saveWaNumber).
  const [mode, setMode] = useState<"aws" | "meta">(awsNumbers.length > 0 ? "aws" : "meta");
  const [label, setLabel] = useState("");
  const [selectedAws, setSelectedAws] = useState(awsNumbers[0]?.metaPhoneNumberId || "");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const tone: Tone = numbers.length > 0 ? "ok" : "idle";
  const statusLabel =
    numbers.length > 0
      ? `${numbers.length} número${numbers.length > 1 ? "s" : ""}`
      : "No conectado";

  // Acciones aisladas de WhatsApp multi-número → refrescan numbers[] en el config.
  const callWa = async (payload: Record<string, unknown>): Promise<void> => {
    if (!ep?.manageConnections) return;
    const r = await authedFetch(ep.manageConnections, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "fallo");
    update({ whatsapp: { ...wa, numbers: (j.numbers as WhatsAppNumberRef[]) || [] } });
  };

  const resetForm = () => {
    setLabel("");
    setPhoneNumberId("");
    setWabaId("");
    setToken("");
  };

  const onAdd = async () => {
    let number: Partial<WhatsAppNumberRef>;
    let secret = "";
    if (mode === "aws") {
      const num = awsNumbers.find((n) => n.metaPhoneNumberId === selectedAws);
      if (!num) {
        toast.error("Elige un número de la lista");
        return;
      }
      // Modo AWS: SIN token — AWS End User Messaging maneja la auth de la WABA.
      number = {
        label: label.trim() || num.displayName || undefined,
        mode: "aws",
        metaPhoneNumberId: num.metaPhoneNumberId,
        phoneNumberId: num.phoneNumberId || num.metaPhoneNumberId,
        wabaId: num.wabaId,
        displayNumber: num.displayPhoneNumber,
      };
    } else {
      if (!phoneNumberId.trim()) {
        toast.error("Falta el Phone Number ID");
        return;
      }
      number = {
        label: label.trim() || undefined,
        mode: "meta",
        metaPhoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim() || undefined,
      };
      secret = token.trim();
    }
    setBusy(true);
    try {
      await callWa({ action: "saveWaNumber", number, token: secret || undefined });
      toast.success("Número guardado");
      resetForm();
      setAdding(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (n: WhatsAppNumberRef) => {
    const ok = await confirm({
      title: `¿Quitar ${n.label || n.metaPhoneNumberId || n.id}?`,
      description: "Se elimina el número y su token del backend. Su ruteo a un flujo se pierde.",
      destructive: true,
      confirmLabel: "Quitar",
    });
    if (!ok) return;
    try {
      await callWa({ action: "removeWaNumber", id: n.metaPhoneNumberId || n.id });
      toast.success("Número quitado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo quitar");
    }
  };

  // WhatsApp Flows (bloque común al tenant, no por número): reusa el save genérico
  // del config sin tocar numbers[].
  const persistFlows = async (next: WhatsAppConn): Promise<boolean> => {
    if (ep?.manageConnections) {
      try {
        await authedFetch(ep.manageConnections, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { ...config, whatsapp: next } }),
        });
      } catch {
        toast.error("No se pudo guardar");
        return false;
      }
    }
    update({ whatsapp: next });
    return true;
  };

  return (
    <ConnCard
      icon={<Icon.WhatsApp size={20} style={{ color: "#25D366" }} />}
      title="WhatsApp"
      desc="Registra uno o varios números (de Connect o de Meta). El ruteo de cada número a su flujo se decide en Bots → Ruteo."
      tone={tone}
      statusLabel={statusLabel}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Números registrados (con el legacy singular incluido como numbers[0]) */}
        {numbers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {numbers.map((n) => (
              <div
                key={n.id}
                className="row"
                style={{
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  alignItems: "center",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                }}
              >
                <Icon.WhatsApp size={16} style={{ color: "#25D366", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {n.label || n.displayNumber || n.metaPhoneNumberId || n.id}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {n.mode === "aws" ? "Connect (AWS)" : "Meta Cloud API"} ·{" "}
                    {n.metaPhoneNumberId || n.phoneNumberId || n.id}
                    {n.mode === "meta" && !n.tokenSet ? " · falta token" : ""}
                  </div>
                </div>
                <span
                  className="chip"
                  style={{ fontSize: 10.5, opacity: n.botId ? 1 : 0.6 }}
                  title={n.botId ? "Ruteado a un flujo" : "Sin flujo — se rutea en Bots → Ruteo"}
                >
                  {n.botId ? "Ruteado" : "Sin flujo"}
                </span>
                <button
                  className="btn btn--ghost btn--icon"
                  onClick={() => void onRemove(n)}
                  title="Quitar número"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!adding ? (
          <button
            className="btn btn--ghost btn--sm"
            style={{ width: "fit-content" }}
            onClick={() => setAdding(true)}
          >
            + Agregar número
          </button>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              borderTop: numbers.length ? "1px solid var(--border-1)" : undefined,
              paddingTop: numbers.length ? 14 : 0,
            }}
          >
            {/* La observación: la diferencia entre los dos tipos de número */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid color-mix(in srgb, var(--accent-green) 35%, transparent)",
                  background: "color-mix(in srgb, var(--accent-green) 8%, transparent)",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 12.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <CheckCircle2 size={14} style={{ flexShrink: 0, color: "var(--accent-green)" }} />{" "}
                  Número de Connect (AWS)
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
                  Lo atiende un <b>agente</b> en el desktop: entra como contacto, con colas, routing
                  y Contact Lens. Entrante + saliente. Sin token.
                </div>
              </div>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border-1)",
                  background: "var(--bg-2)",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 12.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Send size={13} style={{ flexShrink: 0 }} /> Número de Meta aparte
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
                  Envía <b>plantillas</b> (campañas) por Cloud API de Meta y corre <b>bots</b>{" "}
                  entrantes por webhook (el flujo se elige en <b>Bots → Ruteo</b>). <b>No</b> tiene
                  agente en vivo de Connect.
                </div>
              </div>
            </div>

            {/* Selector de modo */}
            <div
              className="row"
              style={{
                gap: 0,
                border: "1px solid var(--border-2)",
                borderRadius: 8,
                overflow: "hidden",
                width: "fit-content",
              }}
            >
              {(
                [
                  ["aws", "Número de Connect"],
                  ["meta", "Número de Meta aparte"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: "7px 14px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    background: mode === m ? "var(--bg-3)" : "transparent",
                    color: mode === m ? "var(--text-1)" : "var(--text-3)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <label>
              <span style={labelStyle}>Etiqueta (opcional)</span>
              <Input
                autoComplete="off"
                name="wa-label"
                placeholder="Admisiones, Cobranzas…"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>

            {mode === "aws" ? (
              awsNumbers.length > 0 ? (
                <>
                  <RadioCards
                    aria-label="Número de WhatsApp de tu Amazon Connect"
                    columns={1}
                    value={selectedAws}
                    onValueChange={setSelectedAws}
                    options={awsNumbers.map((n) => ({
                      value: n.metaPhoneNumberId || "",
                      label: `${n.displayPhoneNumber || ""} · ${n.displayName || ""}`,
                      description: `WABA ${n.wabaName || n.wabaId || ""}${
                        n.qualityRating ? ` · calidad ${n.qualityRating}` : ""
                      }`,
                      icon: <Icon.WhatsApp size={16} style={{ color: "#25D366" }} />,
                      color: "var(--accent-green)",
                    }))}
                  />
                </>
              ) : (
                <div
                  className="muted"
                  style={{ fontSize: 12.5, padding: "8px 0", lineHeight: 1.6 }}
                >
                  No detectamos números vinculados a tu Amazon Connect. Vincula uno en{" "}
                  <b>AWS End User Messaging → WhatsApp</b> (queda atado a tu instancia), o usa un
                  número de Meta aparte en la otra pestaña.
                </div>
              )
            ) : (
              <>
                <div
                  className="camp-2col"
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
                >
                  <label>
                    <span style={labelStyle}>Phone Number ID</span>
                    <Input
                      autoComplete="off"
                      name="wa-phone-number-id"
                      placeholder="1029384756…"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                    />
                  </label>
                  <label>
                    <span style={labelStyle}>WABA ID (opcional)</span>
                    <Input
                      autoComplete="off"
                      name="wa-waba-id"
                      placeholder="ID de la cuenta de WhatsApp Business"
                      value={wabaId}
                      onChange={(e) => setWabaId(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  <span style={labelStyle}>Token de acceso</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    name="wa-access-token"
                    placeholder="Token permanente de Meta"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <span
                    className="muted"
                    style={{
                      fontSize: 10.5,
                      marginTop: 3,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <Lock size={11} style={{ flexShrink: 0 }} /> El token se guarda cifrado en el
                    backend (Secrets Manager), nunca en tu navegador.
                  </span>
                </label>
              </>
            )}

            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => void onAdd()}
                disabled={busy}
              >
                {busy ? "Guardando…" : "Agregar número"}
              </button>
              {numbers.length > 0 && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setAdding(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Formularios (WhatsApp Flows, #10) — común al tenant ──
            El Flow se diseña/publica en Meta Business Manager → WhatsApp
            Manager → Flows; aquí se registra su flow_id para enviarlo desde
            el chat. La respuesta vuelve sola al CRM (lead + automatizaciones). */}
        <WaFlowsEditor wa={wa} persist={persistFlows} />
      </div>
      {confirmDialog}
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
      toast.error("Pega el flow_id y un nombre");
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
    setNId("");
    setNName("");
    setNCta("");
    setNScreen("");
  };

  return (
    <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        Formularios (WhatsApp Flows)
      </div>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 10 }}>
        Formularios multi-pantalla DENTRO del chat. Diséñalos y publícalos en{" "}
        <b>Meta Business Manager → WhatsApp Manager → Flows</b> y pega aquí su <b>flow_id</b>. El
        agente los envía desde el chat; la respuesta crea/actualiza el lead y dispara
        Automatizaciones ("Formulario completado").
      </div>
      {flows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {flows.map((f, i) => (
            <div
              key={f.id + i}
              className="row"
              style={{
                gap: 10,
                padding: "8px 10px",
                background: "var(--bg-2)",
                borderRadius: 8,
                alignItems: "center",
              }}
            >
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr 0.7fr 0.7fr auto",
          gap: 8,
          alignItems: "end",
        }}
      >
        <label>
          <span style={labelStyle}>flow_id</span>
          <Input placeholder="1234567890…" value={nId} onChange={(e) => setNId(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Nombre</span>
          <Input
            placeholder="Solicitud de info"
            value={nName}
            onChange={(e) => setNName(e.target.value)}
          />
        </label>
        <label>
          <span style={labelStyle}>Botón (opc.)</span>
          <Input placeholder="Completar" value={nCta} onChange={(e) => setNCta(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Pantalla (opc.)</span>
          <Input
            placeholder="INICIO"
            value={nScreen}
            onChange={(e) => setNScreen(e.target.value)}
          />
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
   se edita aquí. Vacío → el producto usa un default genérico sin marca. */
function MessagingCard({
  config,
  update,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
}) {
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
      desc="Personaliza el nombre de producto que ven tus agentes (white-label) y los textos automáticos que reciben tus clientes. Vacío = valores por defecto de ARIA."
      tone={tone}
      statusLabel={
        brand.productName?.trim() || msg.chatFarewell?.trim() ? "Personalizado" : "Por defecto"
      }
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label>
          <span style={labelStyle}>Nombre de producto (marca)</span>
          <Input
            placeholder="ARIA"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 10.5, marginTop: 3, display: "block" }}>
            Se muestra en la barra lateral y el título de la pestaña (white-label). El login sigue
            con la marca de plataforma.
          </span>
        </label>
        <label>
          <span style={labelStyle}>Despedida de chat / WhatsApp</span>
          <Textarea
            style={{ minHeight: 120, resize: "vertical" }}
            placeholder="👋 ¡Gracias por escribirnos! Esperamos haberte ayudado…"
            value={farewell}
            onChange={(e) => setFarewell(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 10.5, marginTop: 3, display: "block" }}>
            Se envía al cliente cuando el agente cierra el chat. Soporta saltos de línea y *negrita*
            de WhatsApp.
          </span>
        </label>
        <div className="row">
          <button className="btn btn--primary btn--sm" onClick={onSave} disabled={!dirty}>
            Guardar
          </button>
        </div>
      </div>
    </ConnCard>
  );
}

/** Campo read-only con botón de copiar (datos del SP que el cliente pega en su IdP). */
function SsoRoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={labelStyle}>{label}</span>
      <div className="row" style={{ gap: 8, marginTop: 3 }}>
        <code
          style={{
            flex: 1,
            padding: "7px 10px",
            background: "var(--bg-2)",
            borderRadius: 6,
            fontSize: 11.5,
            border: "1px solid var(--border-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </code>
        <button
          className="btn btn--sm"
          onClick={() => copy(value, label)}
          disabled={!value || value.startsWith("(")}
        >
          <Icon.Copy size={12} /> Copiar
        </button>
      </div>
    </div>
  );
}

/* ── SSO SAML/OIDC (F4.3 · build-ahead) ──────────────────────────────────
 * Config por-tenant del login federado. Guarda la metadata/routing en
 * connections (`config.sso`); el REGISTRO real del IdP en Cognito lo hace el
 * equipo con `ampx pipeline-deploy` + env (ver design/sso.md). Los valores
 * read-only (Entity ID, ACS/redirect URL) son lo que el admin carga en SU IdP. */
function SsoCard({
  config,
  update,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
}) {
  const sso = config.sso || {};
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SsoConn>(() => ({
    provider: "saml",
    ...sso,
  }));
  const [domainsText, setDomainsText] = useState((sso.emailDomains || []).join(", "));

  // Valores del Service Provider (Cognito) que el cliente pega en SU IdP.
  const userPoolId = (outputs.auth as { user_pool_id?: string }).user_pool_id || "";
  const oauth = (outputs.auth as { oauth?: { domain?: string } }).oauth;
  const entityId = userPoolId ? `urn:amazon:cognito:sp:${userPoolId}` : "";
  // El dominio Cognito recién existe tras el deploy con externalProviders.
  const cognitoDomain = oauth?.domain || "";
  const acsUrl = cognitoDomain
    ? `https://${cognitoDomain}/saml2/idpresponse`
    : "(se genera al desplegar el SSO)";
  const oidcRedirect = cognitoDomain
    ? `https://${cognitoDomain}/oauth2/idpresponse`
    : "(se genera al desplegar el SSO)";
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";

  const isSaml = draft.provider === "saml";
  const configured = isSaml ? !!draft.metadataUrl : !!(draft.issuerUrl && draft.clientId);
  const tone: Tone = !configured ? "idle" : oauth ? "ok" : "warn";
  const statusLabel = !configured ? "No configurado" : oauth ? "Activo" : "Pendiente de deploy";

  const set = (patch: Partial<SsoConn>) => setDraft((d) => ({ ...d, ...patch }));

  const onSave = () => {
    const emailDomains = domainsText
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (isSaml && !draft.metadataUrl?.trim()) {
      toast.error("Pega la URL de metadata del IdP (SAML).");
      return;
    }
    if (!isSaml && !(draft.issuerUrl?.trim() && draft.clientId?.trim())) {
      toast.error("Completa el Issuer URL y el Client ID (OIDC).");
      return;
    }
    const next: SsoConn = {
      ...draft,
      cognitoProviderName: draft.cognitoProviderName?.trim() || undefined,
      metadataUrl: isSaml ? draft.metadataUrl?.trim() : undefined,
      issuerUrl: !isSaml ? draft.issuerUrl?.trim() : undefined,
      clientId: !isSaml ? draft.clientId?.trim() : undefined,
      emailDomains,
      updatedAt: new Date().toISOString(),
    };
    setDraft(next);
    update({ sso: next });
    toast.success("Configuración de SSO guardada");
  };

  return (
    <ConnCard
      icon={<Lock size={20} style={{ color: "var(--accent-cyan)" }} />}
      title="SSO — Inicio de sesión con tu empresa"
      desc="Login federado SAML 2.0 / OpenID Connect: tus usuarios entran con las credenciales de tu organización (Azure AD, ADFS, Google Workspace…)."
      tone={tone}
      statusLabel={statusLabel}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Nota de activación: la config se guarda; el go-live necesita el deploy. */}
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.55,
            padding: "10px 12px",
            borderRadius: 10,
            background: "color-mix(in srgb, var(--accent-cyan) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent-cyan) 30%, transparent)",
          }}
        >
          Esta configuración se <b>guarda</b> ahora. Para <b>activar</b> el botón «Entrar con tu
          empresa» en el login, el equipo de la plataforma registra tu IdP y publica el cambio
          (deploy). Mientras tanto, el inicio de sesión con correo sigue funcionando normal.
        </div>

        {/* Paso 1 — proveedor */}
        <div>
          <StepLabel n={1}>Elige el protocolo de tu IdP</StepLabel>
          <div
            className="row"
            style={{
              gap: 0,
              border: "1px solid var(--border-2)",
              borderRadius: 6,
              overflow: "hidden",
              width: "fit-content",
            }}
          >
            {(
              [
                ["saml", "SAML 2.0"],
                ["oidc", "OpenID Connect"],
              ] as const
            ).map(([p, label]) => (
              <button
                key={p}
                onClick={() => set({ provider: p })}
                style={{
                  padding: "6px 14px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: draft.provider === p ? "var(--bg-3)" : "transparent",
                  color: draft.provider === p ? "var(--text-1)" : "var(--text-3)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label style={{ display: "block", marginTop: 12 }}>
            <span style={labelStyle}>Nombre del proveedor (interno, ej. UDEP)</span>
            <Input
              placeholder="UDEP"
              value={draft.cognitoProviderName || ""}
              onChange={(e) => set({ cognitoProviderName: e.target.value })}
            />
          </label>
        </div>

        {/* Paso 2 — credenciales del IdP */}
        <div>
          <StepLabel n={2}>Datos de tu IdP</StepLabel>
          {isSaml ? (
            <label style={{ display: "block" }}>
              <span style={labelStyle}>URL de metadata (SAML)</span>
              <Input
                placeholder="https://login.tu-idp.com/…/federationmetadata.xml"
                value={draft.metadataUrl || ""}
                onChange={(e) => set({ metadataUrl: e.target.value })}
              />
            </label>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "block" }}>
                <span style={labelStyle}>Issuer / Discovery URL</span>
                <Input
                  placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
                  value={draft.issuerUrl || ""}
                  onChange={(e) => set({ issuerUrl: e.target.value })}
                />
              </label>
              <label style={{ display: "block" }}>
                <span style={labelStyle}>Client ID</span>
                <Input
                  placeholder="ID de la aplicación registrada en tu IdP"
                  value={draft.clientId || ""}
                  onChange={(e) => set({ clientId: e.target.value })}
                />
              </label>
              <div
                className="muted"
                style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}
              >
                <Lock size={11} style={{ flexShrink: 0 }} /> El <b>Client Secret</b> no se pega
                aquí: se carga como secreto en el deploy (Secrets Manager de Amplify), nunca en el
                navegador ni en la base.
              </div>
            </div>
          )}
        </div>

        {/* Paso 3 — routing por dominio */}
        <div>
          <StepLabel n={3}>Dominios de correo de tu organización</StepLabel>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>
            Los usuarios con estos dominios entran por tu IdP. Sepáralos por coma.
          </div>
          <Input
            placeholder="udep.edu.pe, udep.pe"
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
          />
        </div>

        {/* Paso 4 — datos para cargar en el IdP del cliente (read-only) */}
        <div>
          <StepLabel n={4}>Pega estos datos en tu IdP</StepLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SsoRoField label="Entity ID / Audience URI" value={entityId} />
            <SsoRoField
              label={isSaml ? "ACS URL (Reply URL)" : "Redirect URI (OIDC)"}
              value={isSaml ? acsUrl : oidcRedirect}
            />
            <SsoRoField label="URL de la aplicación (callback)" value={appOrigin} />
          </div>
        </div>

        <div className="row">
          <button className="btn btn--primary" onClick={onSave}>
            Guardar configuración
          </button>
          {sso.updatedAt && (
            <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
              Guardada {new Date(sso.updatedAt).toLocaleString("es-PE")}
            </span>
          )}
        </div>
      </div>
    </ConnCard>
  );
}

/* ── Mercado Libre (F4.1 · canal del inbox) ──────────────────────────────
 * Conecta la cuenta de ML del tenant (OAuth) para recibir preguntas + mensajes
 * post-venta en el inbox omnicanal. Build-ahead: el OAuth se activa con la App
 * de ML del cliente. La URL del webhook se pega en el panel de ML → Notificaciones. */
const ML_SITES: { v: string; l: string }[] = [
  { v: "MPE", l: "Perú" },
  { v: "MLA", l: "Argentina" },
  { v: "MLB", l: "Brasil" },
  { v: "MLM", l: "México" },
  { v: "MLC", l: "Chile" },
  { v: "MCO", l: "Colombia" },
  { v: "MLU", l: "Uruguay" },
];

/* ── Correo saliente (multi-proveedor) ─────────────────────────────────── */
const EMAIL_PROVIDERS: { kind: string; label: string; oauth?: boolean }[] = [
  { kind: "novasys", label: "SES de Novasys (compartido)" },
  { kind: "ses", label: "Amazon SES (propio)" },
  { kind: "smtp", label: "SMTP — Gmail, Outlook, Zoho, custom" },
  { kind: "sendgrid", label: "SendGrid" },
  { kind: "resend", label: "Resend" },
  { kind: "mailgun", label: "Mailgun" },
  { kind: "gmail", label: "Gmail API (OAuth)", oauth: true },
  { kind: "microsoft", label: "Microsoft 365 (OAuth)", oauth: true },
];

function EmailCard({
  config,
  update,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
}) {
  const ep = getApiEndpoints();
  const [open, setOpen] = useState(false);
  const prov = config.email?.provider as Record<string, unknown> | undefined;
  const [kind, setKind] = useState<string>((prov?.kind as string) || "novasys");
  const [fromEmail, setFromEmail] = useState<string>((prov?.fromEmail as string) || "");
  const [fromName, setFromName] = useState<string>((prov?.fromName as string) || "ARIA");
  const [region, setRegion] = useState<string>((prov?.region as string) || "us-east-1");
  const [useTenantRole, setUseTenantRole] = useState<boolean>(!!prov?.useTenantRole);
  const [host, setHost] = useState<string>((prov?.host as string) || "");
  const [port, setPort] = useState<string>(String((prov?.port as number) || 587));
  const [user, setUser] = useState<string>((prov?.user as string) || "");
  const [domain, setDomain] = useState<string>((prov?.domain as string) || "");
  const [mgRegion, setMgRegion] = useState<string>((prov?.region as string) || "us");
  const [msTenant, setMsTenant] = useState<string>("");
  const [sender, setSender] = useState<string>((prov?.sender as string) || "");
  const [smtpPass, setSmtpPass] = useState("");
  const [sgKey, setSgKey] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [mgKey, setMgKey] = useState("");
  const [gId, setGId] = useState("");
  const [gSecret, setGSecret] = useState("");
  const [gRefresh, setGRefresh] = useState("");
  const [msId, setMsId] = useState("");
  const [msSecret, setMsSecret] = useState("");
  const [msRefresh, setMsRefresh] = useState("");
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const configured = !!config.email?.provider;
  const secretSet = !!config.email?.secretSet;
  const tone: Tone = configured ? "ok" : "idle";
  const statusLabel = configured ? "Configurado" : "No configurado";

  const buildProvider = (): Record<string, unknown> => {
    switch (kind) {
      case "ses":
        return { kind, fromEmail, fromName, region, useTenantRole };
      case "smtp":
        return {
          kind,
          host,
          port: Number(port),
          secure: Number(port) === 465,
          user,
          fromEmail,
          fromName,
        };
      case "gmail":
      case "sendgrid":
      case "resend":
        return { kind, fromEmail, fromName };
      case "microsoft":
        return { kind, fromEmail, fromName, sender: sender || fromEmail };
      case "mailgun":
        return { kind, fromEmail, fromName, domain, region: mgRegion };
      default:
        return { kind: "novasys" };
    }
  };
  const buildSecret = (): Record<string, unknown> => {
    const s: Record<string, unknown> = {};
    if (kind === "smtp" && smtpPass) s.smtpPass = smtpPass;
    if (kind === "sendgrid" && sgKey) s.sendgridKey = sgKey;
    if (kind === "resend" && resendKey) s.resendKey = resendKey;
    if (kind === "mailgun" && mgKey) s.mailgunKey = mgKey;
    if (kind === "gmail") {
      if (gId) s.gmailClientId = gId;
      if (gSecret) s.gmailClientSecret = gSecret;
      if (gRefresh) s.gmailRefreshToken = gRefresh;
    }
    if (kind === "microsoft") {
      if (msId) s.msClientId = msId;
      if (msSecret) s.msClientSecret = msSecret;
      if (msRefresh) s.msRefreshToken = msRefresh;
      if (msTenant) s.msTenant = msTenant;
    }
    return s;
  };

  const onSave = async () => {
    if (!ep?.manageConnections) return;
    setSaving(true);
    try {
      const r = await authedFetch(ep.manageConnections, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveEmailConn",
          provider: buildProvider(),
          emailSecret: buildSecret(),
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      update({ email: j.email });
      setSmtpPass("");
      setSgKey("");
      setResendKey("");
      setMgKey("");
      setGId("");
      setGSecret("");
      setGRefresh("");
      setMsId("");
      setMsSecret("");
      setMsRefresh("");
      toast.success("Correo configurado");
    } catch {
      toast.error("No se pudo guardar la configuración de correo.");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    const to = testTo.trim();
    if (!to) {
      toast.error("Escribe un destinatario para la prueba.");
      return;
    }
    if (!ep?.sendEmail) {
      toast.error("El envío aún no está desplegado (Lambda send-email).");
      return;
    }
    setTesting(true);
    try {
      const r = await authedFetch(ep.sendEmail, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, to }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) toast.success(`Prueba enviada a ${to}`);
      else toast.error(j.error || "No se pudo enviar la prueba.");
    } catch {
      toast.error("No se pudo enviar la prueba.");
    } finally {
      setTesting(false);
    }
  };

  const oauthProvider = kind === "gmail" || kind === "microsoft";

  return (
    <ConnCard
      icon={<Icon.Send size={20} style={{ color: "#2c5698" }} />}
      title="Correo"
      desc="Envía correos desde ARIA (automatizaciones, journeys, avisos) por el proveedor que elijas: SES, SMTP, Gmail, Microsoft 365, SendGrid, Resend o Mailgun."
      tone={tone}
      statusLabel={statusLabel}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label>
          <span style={labelStyle}>Proveedor</span>
          <Select value={kind} onValueChange={(nv) => nv && setKind(nv)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {EMAIL_PROVIDERS.find((p) => p.kind === kind)?.label || kind}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EMAIL_PROVIDERS.map((p) => (
                <SelectItem key={p.kind} value={p.kind}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {kind === "novasys" ? (
          <div className="muted" style={{ fontSize: 12.5 }}>
            Usa el dominio verificado de Novasys (novasys.com.pe). Ideal para pilotos, sin
            configurar nada.
          </div>
        ) : (
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 180 }}>
              <span style={labelStyle}>Remitente (From)</span>
              <Input
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="ventas@tudominio.com"
              />
            </label>
            <label style={{ flex: 1, minWidth: 140 }}>
              <span style={labelStyle}>Nombre visible</span>
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="ARIA"
              />
            </label>
          </div>
        )}

        {kind === "ses" && (
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ width: 160 }}>
              <span style={labelStyle}>Región</span>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} />
            </label>
            <label className="row" style={{ gap: 8, fontSize: 13, marginTop: 18 }}>
              <Switch
                checked={useTenantRole}
                onCheckedChange={setUseTenantRole}
                aria-label="SES de mi cuenta (assume-role)"
              />{" "}
              SES de mi cuenta (assume-role)
            </label>
          </div>
        )}

        {kind === "smtp" && (
          <>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <label style={{ flex: 2, minWidth: 180 }}>
                <span style={labelStyle}>Servidor SMTP</span>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                />
              </label>
              <label style={{ width: 90 }}>
                <span style={labelStyle}>Puerto</span>
                <Input value={port} onChange={(e) => setPort(e.target.value)} />
              </label>
            </div>
            <label>
              <span style={labelStyle}>Usuario</span>
              <Input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="ventas@tudominio.com"
              />
            </label>
            <label>
              <span style={labelStyle}>
                Contraseña / app-password{secretSet ? " · ya guardada" : ""}
              </span>
              <Input
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={secretSet ? "•••••• (vacío = no cambiar)" : ""}
              />
            </label>
          </>
        )}

        {kind === "sendgrid" && (
          <label>
            <span style={labelStyle}>API key de SendGrid{secretSet ? " · ya guardada" : ""}</span>
            <Input
              type="password"
              value={sgKey}
              onChange={(e) => setSgKey(e.target.value)}
              placeholder="SG.xxxx"
            />
          </label>
        )}
        {kind === "resend" && (
          <label>
            <span style={labelStyle}>API key de Resend{secretSet ? " · ya guardada" : ""}</span>
            <Input
              type="password"
              value={resendKey}
              onChange={(e) => setResendKey(e.target.value)}
              placeholder="re_xxxx"
            />
          </label>
        )}
        {kind === "mailgun" && (
          <>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <label style={{ flex: 1, minWidth: 160 }}>
                <span style={labelStyle}>Dominio</span>
                <Input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="mg.tudominio.com"
                />
              </label>
              <div style={{ width: 90 }}>
                <span style={labelStyle}>Región</span>
                <SegmentedControl
                  block
                  size="sm"
                  aria-label="Región de Mailgun"
                  value={mgRegion}
                  onValueChange={setMgRegion}
                  options={[
                    { value: "us", label: "US" },
                    { value: "eu", label: "EU" },
                  ]}
                />
              </div>
            </div>
            <label>
              <span style={labelStyle}>API key de Mailgun{secretSet ? " · ya guardada" : ""}</span>
              <Input
                type="password"
                value={mgKey}
                onChange={(e) => setMgKey(e.target.value)}
                placeholder="key-xxxx"
              />
            </label>
          </>
        )}

        {oauthProvider && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
            }}
          >
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              OAuth: pega las credenciales de tu app de{" "}
              {kind === "gmail" ? "Google Cloud" : "Azure AD"}. El botón «Conectar con OAuth»
              (redirección) llega en la siguiente fase.
            </div>
            {kind === "gmail" ? (
              <div className="col" style={{ gap: 8 }}>
                <Input
                  value={gId}
                  onChange={(e) => setGId(e.target.value)}
                  placeholder="Client ID"
                />
                <Input
                  type="password"
                  value={gSecret}
                  onChange={(e) => setGSecret(e.target.value)}
                  placeholder="Client secret"
                />
                <Input
                  type="password"
                  value={gRefresh}
                  onChange={(e) => setGRefresh(e.target.value)}
                  placeholder="Refresh token"
                />
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <Input
                  value={msTenant}
                  onChange={(e) => setMsTenant(e.target.value)}
                  placeholder="Tenant ID (Directory)"
                />
                <Input
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  placeholder="Buzón remitente (user@dominio)"
                />
                <Input
                  value={msId}
                  onChange={(e) => setMsId(e.target.value)}
                  placeholder="Client ID"
                />
                <Input
                  type="password"
                  value={msSecret}
                  onChange={(e) => setMsSecret(e.target.value)}
                  placeholder="Client secret"
                />
                <Input
                  type="password"
                  value={msRefresh}
                  onChange={(e) => setMsRefresh(e.target.value)}
                  placeholder="Refresh token"
                />
              </div>
            )}
          </div>
        )}

        <div
          className="row"
          style={{ gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}
        >
          <button className="btn btn--primary btn--sm" onClick={onSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
            <Input
              style={{ width: 200 }}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="correo@prueba.com"
            />
            <button className="btn btn--sm" onClick={onTest} disabled={testing}>
              {testing ? "Enviando…" : "Enviar prueba"}
            </button>
          </div>
        </div>
      </div>
    </ConnCard>
  );
}

function MercadoLibreCard({
  config,
  update,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
}) {
  const ml = config.mercadolibre || {};
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(ml.siteId || "MPE");
  const ep = getApiEndpoints();
  const webhookUrl = ep?.mercadolibreWebhook || "";
  const { confirm, confirmDialog } = useConfirm();

  const tone: Tone = ml.connected ? "ok" : "idle";
  const statusLabel = ml.connected ? "Conectado" : "No conectado";

  const onConnect = async () => {
    if (!ep?.mercadolibreOAuthStart) {
      // Sin backend desplegado aún: guardamos el sitio elegido para después.
      update({ mercadolibre: { ...ml, siteId } });
      toast.message(
        "El OAuth de Mercado Libre se habilita al desplegar el backend + la App de ML.",
      );
      return;
    }
    try {
      const r = await authedFetch(
        `${ep.mercadolibreOAuthStart}?siteId=${encodeURIComponent(siteId)}`,
      );
      const j = await r.json();
      if (j.authUrl) {
        window.location.assign(j.authUrl);
        return;
      }
      toast.error(j.error || "No se obtuvo la URL de autorización de Mercado Libre");
    } catch {
      toast.error("No se pudo iniciar el OAuth con Mercado Libre");
    }
  };

  const onDisconnect = async () => {
    if (
      !(await confirm({
        title: "¿Desconectar Mercado Libre?",
        description: "El canal dejará de recibir preguntas y mensajes en tu inbox.",
        destructive: true,
        confirmLabel: "Desconectar",
      }))
    )
      return;
    update({ mercadolibre: { connected: false } });
    toast.success("Mercado Libre desconectado");
  };

  return (
    <ConnCard
      icon={<ShoppingBag size={20} style={{ color: "#2d3277" }} />}
      title="Mercado Libre"
      desc="Opcional — si vendes en Mercado Libre, recibe las preguntas de tus publicaciones y los mensajes post-venta en el inbox omnicanal. El canal aparece en el inbox solo cuando lo conectas."
      tone={tone}
      statusLabel={statusLabel}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      {confirmDialog}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {ml.connected ? (
          <>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Conectado como <b>{ml.nickname || ml.userId || "tu cuenta de ML"}</b>
              {ml.connectedAt
                ? ` · desde ${new Date(ml.connectedAt).toLocaleDateString("es-PE")}`
                : ""}
              .
            </div>
            <div className="row">
              <button className="btn btn--danger btn--sm" onClick={onDisconnect}>
                <Icon.Close size={13} /> Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.55,
                padding: "10px 12px",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--accent-amber) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent-amber) 30%, transparent)",
              }}
            >
              El OAuth de Mercado Libre requiere una <b>App de ML</b> registrada (app_id/secret). El
              equipo la configura una vez; después, «Conectar» te lleva a autorizar tu cuenta.
            </div>
            <div>
              <StepLabel n={1}>Elige tu país de Mercado Libre</StepLabel>
              <Select value={siteId} onValueChange={(nv) => nv && setSiteId(nv)}>
                <SelectTrigger className="w-full" style={{ maxWidth: 220 }}>
                  <SelectValue>
                    {(() => {
                      const s = ML_SITES.find((x) => x.v === siteId);
                      return s ? `${s.l} · ${s.v}` : siteId;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ML_SITES.map((s) => (
                    <SelectItem key={s.v} value={s.v}>
                      {s.l} · {s.v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <StepLabel n={2}>Autoriza a ARIA</StepLabel>
              <button className="btn btn--primary btn--sm" onClick={onConnect}>
                <ShoppingBag size={13} /> Conectar con Mercado Libre
              </button>
            </div>
          </>
        )}

        {/* URL del webhook — se pega en el panel de ML → Notificaciones. */}
        <div>
          <StepLabel n={ml.connected ? 1 : 3}>Webhook de notificaciones</StepLabel>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>
            En tu App de Mercado Libre → <b>Notificaciones</b>, pega esta URL y suscríbete a los
            topics <code style={{ fontSize: 11.5 }}>questions</code> y{" "}
            <code style={{ fontSize: 11.5 }}>messages</code>.
          </div>
          <SsoRoField
            label="Callback / Notifications URL"
            value={webhookUrl || "(se genera al desplegar el webhook)"}
          />
        </div>
      </div>
    </ConnCard>
  );
}

/* ── Instagram y Messenger (Meta multi-cuenta · "Conectar con Facebook") ──────
 * Auto-servicio estilo Chattigo/ManyChat: el tenant hace "Login con Facebook",
 * tilda cuáles páginas/cuentas traer, y las gestiona aquí. Cada página trae
 * Messenger y, si tiene un Instagram Business Account conectado, también IG DM.
 * Build-ahead: el OAuth se activa con la App de Meta del cliente
 * (secret connectview/meta + scripts/create-meta-oauth.mjs). Los page tokens
 * viven en Secrets Manager, NUNCA tocan el navegador (el callback los guarda como
 * `pending` y el usuario elige por id). */
interface MetaPendingPage {
  pageId: string;
  pageName?: string;
  igId?: string;
  igUsername?: string;
}

/** Cuentas efectivas del tenant: las de accounts[] + el legacy singular
 *  (meta.pageId/igId) como una más, espejo de `normalizeMetaAccounts` del backend.
 *  Así un tenant configurado "por detrás" (singular) también se muestra conectado. */
function effectiveMetaAccounts(meta: MetaConn): MetaAccountRef[] {
  const out: MetaAccountRef[] = Array.isArray(meta.accounts) ? [...meta.accounts] : [];
  if (meta.pageId && !out.some((a) => a.pageId === meta.pageId)) {
    out.push({ id: meta.pageId, pageId: meta.pageId, pageName: meta.pageName, igId: meta.igId });
  }
  return out;
}

/** Glifo de Instagram (lucide-react en esta versión no trae íconos de marca;
 *  reusamos el mismo trazo que el chip de canal del inbox). */
function IgIcon({ size = 20, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M16.5 7.5h.01" />
    </svg>
  );
}

function InstagramMessengerCard({
  config,
  update,
}: {
  config: ConnectionsConfig;
  update: (patch: Partial<ConnectionsConfig>) => void;
}) {
  const meta = config.meta || {};
  const accounts: MetaAccountRef[] = effectiveMetaAccounts(meta);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, setPending] = useState<MetaPendingPage[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const ep = getApiEndpoints();
  const { confirm, confirmDialog } = useConfirm();

  const tone: Tone = accounts.length ? "ok" : "idle";
  const statusLabel = accounts.length
    ? `${accounts.length} cuenta${accounts.length > 1 ? "s" : ""}`
    : "No conectado";

  // Trae las páginas pendientes de elección (tras el "Login con Facebook"). El
  // backend las tiene guardadas (con sus page tokens) en el secret del tenant; aquí
  // sólo llegan sin tokens para tildar cuáles traer.
  const loadPending = useCallback(async () => {
    if (!ep?.manageConnections) return;
    try {
      const r = await authedFetch(ep.manageConnections, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listMetaAccounts" }),
      });
      const j = await r.json();
      const pend: MetaPendingPage[] = Array.isArray(j?.pending) ? j.pending : [];
      setPending(pend);
      setSelected(Object.fromEntries(pend.map((p) => [p.pageId, true])));
      if (pend.length) {
        setOpen(true);
        setModalOpen(true);
      } else {
        toast.message("No hay cuentas nuevas para elegir. Vuelve a “Conectar con Facebook”.");
      }
    } catch {
      toast.error("No se pudieron cargar las cuentas pendientes.");
    }
  }, [ep?.manageConnections]);

  // Al volver del "Login con Facebook" (?meta=connected|err), abrir el selector.
  // Limpiamos el query param con replaceState para no re-disparar en cada refresh.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const m = sp.get("meta");
    if (!m) return;
    const reason = sp.get("reason") || "error";
    sp.delete("meta");
    sp.delete("reason");
    const qs = sp.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if (m === "connected") void loadPending();
    else if (m === "err") toast.error(`No se pudo conectar con Facebook (${reason}).`);
  }, [loadPending]);

  const onConnect = async () => {
    if (!ep?.metaOAuthStart) {
      toast.message(
        "El “Login con Facebook” se habilita al desplegar el backend + la App de Meta.",
      );
      return;
    }
    try {
      const r = await authedFetch(ep.metaOAuthStart);
      const j = await r.json();
      if (j.authUrl) {
        window.location.assign(j.authUrl);
        return;
      }
      toast.error(j.error || "No se obtuvo la URL de autorización de Meta");
    } catch {
      toast.error("No se pudo iniciar el Login con Facebook");
    }
  };

  const onSaveChosen = async () => {
    const pageIds = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!pageIds.length) {
      toast.error("Elige al menos una cuenta.");
      return;
    }
    if (!ep?.manageConnections) return;
    setBusy(true);
    try {
      const r = await authedFetch(ep.manageConnections, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveMetaAccounts", pageIds }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      update({ meta: { ...meta, accounts: (j.accounts as MetaAccountRef[]) || [] } });
      setModalOpen(false);
      setPending([]);
      const n = pageIds.length;
      toast.success(`${n} cuenta${n > 1 ? "s" : ""} conectada${n > 1 ? "s" : ""}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (acc: MetaAccountRef) => {
    if (!ep?.manageConnections) return;
    const label = acc.pageName || acc.igUsername || acc.pageId;
    if (
      !(await confirm({
        title: `¿Quitar ${label}?`,
        description: "Dejarás de recibir sus mensajes y comentarios en el inbox.",
        destructive: true,
        confirmLabel: "Quitar",
      }))
    )
      return;
    try {
      const r = await authedFetch(ep.manageConnections, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "removeMetaAccount", pageId: acc.pageId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo quitar");
      update({ meta: { ...meta, accounts: (j.accounts as MetaAccountRef[]) || [] } });
      toast.success("Cuenta quitada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo quitar");
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <ConnCard
      icon={<IgIcon size={20} style={{ color: "#E4405F" }} />}
      title="Instagram y Messenger"
      desc="Conecta tus cuentas de Instagram y Facebook (Messenger) y recibe los mensajes directos y comentarios en el inbox omnicanal. Puedes conectar varias cuentas."
      tone={tone}
      statusLabel={statusLabel}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Nota build-ahead: el OAuth requiere la App de Meta configurada. */}
        {!ep?.metaOAuthStart && (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              padding: "10px 12px",
              borderRadius: 10,
              background: "color-mix(in srgb, var(--accent-amber) 8%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent-amber) 30%, transparent)",
            }}
          >
            El “Login con Facebook” requiere la <b>App de Meta</b> configurada (App ID + Secret). El
            equipo la activa una vez; después, «Conectar con Facebook» te lleva a elegir tus
            cuentas.
          </div>
        )}

        {/* Botón principal — Conectar con Facebook */}
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn--primary btn--sm" onClick={() => void onConnect()}>
            <IgIcon size={14} /> Conectar con Facebook
          </button>
          {ep?.metaOAuthStart && (
            <button className="btn btn--sm" onClick={() => void loadPending()}>
              ¿Ya conectaste? Elegir cuentas
            </button>
          )}
        </div>

        {/* Lista de cuentas conectadas */}
        {accounts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={labelStyle}>Cuentas conectadas</span>
            {accounts.map((a) => (
              <div
                key={a.pageId}
                className="row"
                style={{
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                  alignItems: "center",
                }}
              >
                <IgIcon size={16} style={{ color: "#E4405F", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.pageName || a.pageId}</div>
                  <div
                    className="muted"
                    style={{ fontSize: 11, display: "flex", gap: 6, flexWrap: "wrap" }}
                  >
                    <span>Messenger</span>
                    {a.igId && <span>· Instagram {a.igUsername ? `@${a.igUsername}` : ""}</span>}
                  </div>
                </div>
                <button
                  className="btn btn--ghost btn--sm"
                  aria-label={`Quitar ${a.pageName || a.pageId}`}
                  onClick={() => void onRemove(a)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: elegir cuáles cuentas traer */}
      {modalOpen && (
        <div
          role="presentation"
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0,0,0,.45)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Elige qué cuentas traer"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 96vw)",
              maxHeight: "82vh",
              overflow: "auto",
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderRadius: 14,
              padding: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,.35)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16 }}>Elige qué cuentas traer</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>
              Marca las páginas de Facebook / Instagram que quieres gestionar en ARIA. Puedes
              cambiarlo después.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "14px 0" }}>
              {pending.length === 0 && (
                <div className="muted" style={{ fontSize: 12.5 }}>
                  No hay cuentas pendientes.
                </div>
              )}
              {pending.map((p) => {
                const on = !!selected[p.pageId];
                return (
                  <label
                    key={p.pageId}
                    className="row"
                    style={{
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      cursor: "pointer",
                      alignItems: "center",
                      background: on ? "var(--accent-green-soft)" : "var(--bg-2)",
                      border: `1px solid ${on ? "var(--accent-green)" : "var(--border-1)"}`,
                    }}
                  >
                    <Switch
                      checked={on}
                      onCheckedChange={(checked) =>
                        setSelected((s) => ({ ...s, [p.pageId]: checked }))
                      }
                      accent="var(--accent-green)"
                      aria-label={`Traer ${p.pageName || p.pageId}`}
                    />
                    <IgIcon size={16} style={{ color: "#E4405F", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.pageName || p.pageId}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        Messenger
                        {p.igId ? ` · Instagram ${p.igUsername ? `@${p.igUsername}` : ""}` : ""}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn--sm" onClick={() => setModalOpen(false)}>
                Cancelar
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => void onSaveChosen()}
                disabled={busy || selectedCount === 0}
              >
                {busy
                  ? "Guardando…"
                  : `Traer ${selectedCount} cuenta${selectedCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
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
            gap: 10,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid color-mix(in srgb, var(--accent-amber) 35%, transparent)",
            background: "color-mix(in srgb, var(--accent-amber) 10%, transparent)",
          }}
        >
          <Icon.Lightning size={16} style={{ color: "var(--accent-amber)", flexShrink: 0 }} />
          <span className="muted" style={{ fontSize: 12 }}>
            Vista previa de Integraciones. La config se guarda localmente por ahora; el{" "}
            <b>guardado seguro de secretos</b> (Secrets Manager), la <b>verificación real</b> y la{" "}
            <b>conexión por organización</b> llegan con el backend multi-tenant (Cognito +
            connections).
          </span>
        </div>
      )}
      <AmazonConnectCard config={config} update={update} />
      <SalesforceCard config={config} update={update} />
      <WhatsAppCard config={config} update={update} awsNumbers={whatsappNumbers} />
      <InstagramMessengerCard config={config} update={update} />
      <MercadoLibreCard config={config} update={update} />
      <SsoCard config={config} update={update} />
      <EmailCard config={config} update={update} />
      <MessagingCard config={config} update={update} />
    </div>
  );
}
