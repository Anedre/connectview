import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Phone, MessageCircle, Globe, Mail, Copy, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody, Kpi } from "@/components/vox/primitives";
import { useConnections } from "@/hooks/useConnections";
import { WhatsAppHealthPanel } from "@/components/admin/WhatsAppHealthPanel";

/**
 * ChannelsManager — "Canales" de Configuración: el centro omnicanal. Distinto de
 * Integraciones (que CONECTA cuentas externas): aquí se configura CÓMO se comporta
 * cada canal de conversación con el cliente.
 *
 * - Overview premium por canal (Voz, WhatsApp, Chat web, Email + social próx.),
 *   con estado derivado del config del tenant.
 * - Mensajes de conversación (saludo · fuera de horario · despedida) guardados en
 *   `messaging`. La despedida YA se consume (CCPContext la envía al cerrar chat).
 * - Snippet del widget de chat web para pegar en el sitio.
 */

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".05em",
  color: "var(--text-3)",
  marginBottom: 5,
  display: "block",
};

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success("Snippet copiado"),
    () => toast.error("No se pudo copiar"),
  );
}

/** Glifo de Instagram (lucide-react en esta versión no trae íconos de marca). */
function IgIcon({ size = 19 }: { size?: number }) {
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
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M16.5 7.5h.01" />
    </svg>
  );
}

export function ChannelsManager() {
  const { config, save, loading, saving } = useConnections();
  const [welcome, setWelcome] = useState("");
  const [away, setAway] = useState("");
  const [farewell, setFarewell] = useState("");
  const [snippet, setSnippet] = useState("");
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (loading) return;
    const m = config.messaging;
    setWelcome(m?.welcome ?? "");
    setAway(m?.away ?? "");
    setFarewell(m?.chatFarewell ?? "");
    setSnippet(m?.webChatSnippet ?? "");
    setDirty(false);
  }, [loading, config]);

  const doSave = async () => {
    const ok = await save({
      ...config,
      messaging: {
        ...config.messaging,
        welcome: welcome.trim(),
        away: away.trim(),
        chatFarewell: farewell.trim(),
        webChatSnippet: snippet.trim(),
      },
    });
    setDirty(false);
    if (ok) toast.success("Canales guardados");
    else toast.error("No se pudo guardar en el servidor. Reintenta.");
  };

  // ── Estado por canal (derivado del config) ──────────────────────────────
  const voiceOn = !!config.connect?.instanceUrl;
  const wa = config.whatsapp;
  const waOn = !!(wa?.phoneNumberId || wa?.metaPhoneNumberId);
  const webChatOn = !!snippet.trim();
  // Meta multi-cuenta: cada página conectada trae Messenger; las que tienen un IG
  // Business Account conectado, además Instagram DM. Se conectan en Integraciones.
  // Contamos accounts[] + el legacy singular (meta.pageId) — espejo del backend.
  const meta = config.meta || {};
  const metaPages: { pageId?: string; igId?: string }[] = meta.accounts?.length
    ? meta.accounts
    : meta.pageId
      ? [{ pageId: meta.pageId, igId: meta.igId }]
      : [];
  const messengerOn = metaPages.length > 0;
  const igCount = metaPages.filter((a) => a.igId).length;
  const igOn = igCount > 0;

  const channels: {
    key: string;
    name: string;
    icon: React.ElementType;
    on: boolean;
    sub: string;
    tone: string;
    soft: string;
  }[] = [
    {
      key: "voz",
      name: "Voz",
      icon: Phone,
      on: voiceOn,
      sub: voiceOn ? "Amazon Connect" : "Conecta Connect en Integraciones",
      tone: "var(--accent-cyan)",
      soft: "var(--accent-cyan-soft)",
    },
    {
      key: "whatsapp",
      name: "WhatsApp",
      icon: MessageCircle,
      on: waOn,
      sub: waOn
        ? wa?.mode === "meta"
          ? "Meta Cloud API"
          : "AWS End User Messaging"
        : "No configurado",
      tone: "var(--accent-green)",
      soft: "var(--accent-green-soft)",
    },
    {
      key: "instagram",
      name: "Instagram",
      icon: IgIcon,
      on: igOn,
      sub: igOn
        ? `${igCount} cuenta${igCount > 1 ? "s" : ""} · DM + comentarios`
        : "Conecta en Integraciones",
      tone: "#E4405F",
      soft: "color-mix(in srgb, #E4405F 14%, transparent)",
    },
    {
      key: "messenger",
      name: "Messenger",
      icon: MessageCircle,
      on: messengerOn,
      sub: messengerOn
        ? `${metaPages.length} página${metaPages.length > 1 ? "s" : ""} · DM + comentarios`
        : "Conecta en Integraciones",
      tone: "#0084FF",
      soft: "color-mix(in srgb, #0084FF 14%, transparent)",
    },
    {
      key: "chatweb",
      name: "Chat web",
      icon: Globe,
      on: webChatOn,
      sub: webChatOn ? "Snippet configurado" : "Pega el snippet abajo",
      tone: "var(--accent-violet)",
      soft: "var(--accent-violet-soft)",
    },
    {
      key: "email",
      name: "Email",
      icon: Mail,
      on: voiceOn,
      sub: voiceOn ? "Disponible vía Connect" : "Requiere Connect",
      tone: "var(--accent-amber)",
      soft: "var(--accent-amber-soft)",
    },
  ];
  const soon: { name: string; icon: React.ElementType }[] = [{ name: "SMS", icon: Phone }];

  const activeCount = channels.filter((c) => c.on).length;
  const msgCount = [welcome, away, farewell].filter((m) => m.trim()).length;

  const TEMPLATE = `<!-- Genera tu widget en: Consola de Amazon Connect → Canales → Widgets de comunicación.
     Copia el snippet que te da Connect y pégalo aquí (tendrá esta forma): -->
<script type="text/javascript">
  (function(w, d, x, id){ /* …script de Amazon Connect… */ })
  (window, document, 'amazon_connect', 'TU_WIDGET_ID');
  amazon_connect('snippetId', 'TU_SNIPPET_ID');
  amazon_connect('supportedMessagingContentTypes', ['text/plain', 'text/markdown']);
</script>`;

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Canales</div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 640, lineHeight: 1.5 }}
          >
            Cómo se comporta cada canal de conversación con tus clientes. Distinto de{" "}
            <strong>Integraciones</strong>, que conecta las cuentas — aquí configuras la
            experiencia.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          {dirty && (
            <span className="chip chip--amber" style={{ height: 28 }}>
              <span className="dot" /> Sin guardar
            </span>
          )}
          <button className="btn btn--primary btn--sm" onClick={doSave} disabled={saving || !dirty}>
            <Check size={13} /> {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 }}>
        <Kpi
          label="Canales activos"
          value={
            <span>
              <span style={{ color: "var(--accent-green)" }}>{activeCount}</span>{" "}
              <span style={{ color: "var(--text-3)", fontSize: 18 }}>/ {channels.length}</span>
            </span>
          }
          color="var(--accent-green)"
        />
        <Kpi
          label="Mensajes configurados"
          value={
            <span>
              {msgCount} <span style={{ color: "var(--text-3)", fontSize: 18 }}>/ 3</span>
            </span>
          }
          color="var(--accent-violet)"
        />
        <Kpi
          label="Chat web"
          value={
            <span style={{ color: webChatOn ? "var(--accent-green)" : "var(--text-3)" }}>
              {webChatOn ? "Activo" : "Inactivo"}
            </span>
          }
          color="var(--accent-cyan)"
        />
      </div>

      {/* Channel cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        {channels.map((c) => (
          <div
            key={c.key}
            style={{
              position: "relative",
              borderRadius: 12,
              border: "1px solid var(--border-1)",
              background: "var(--bg-1)",
              padding: "16px 18px",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 3,
                background: c.on ? c.tone : "var(--border-1)",
              }}
            />
            <div className="row" style={{ gap: 11, alignItems: "center" }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  background: c.soft,
                  color: c.tone,
                  flex: "0 0 auto",
                }}
              >
                <c.icon size={19} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 7, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>{c.name}</span>
                  <span
                    className={`chip ${c.on ? "chip--green" : ""}`}
                    style={c.on ? undefined : { color: "var(--text-3)" }}
                  >
                    <span
                      className="dot"
                      style={c.on ? undefined : { background: "var(--text-3)" }}
                    />{" "}
                    {c.on ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  {c.sub}
                </div>
              </div>
            </div>
          </div>
        ))}
        {soon.map((s) => (
          <div
            key={s.name}
            style={{
              borderRadius: 12,
              border: "1px dashed var(--border-1)",
              background: "transparent",
              padding: "16px 18px",
              opacity: 0.7,
            }}
          >
            <div className="row" style={{ gap: 11, alignItems: "center" }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  background: "var(--bg-2)",
                  color: "var(--text-3)",
                  flex: "0 0 auto",
                }}
              >
                <s.icon size={19} />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--text-2)" }}>
                  {s.name}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  Próximamente
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Salud del número de WhatsApp (Pilar 4 · #13) */}
      {waOn && <WhatsAppHealthPanel />}

      {/* Mensajes de conversación */}
      <Card>
        <CardBody>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Mensajes de conversación</div>
          <div
            className="muted"
            style={{ fontSize: 12, marginTop: 3, marginBottom: 14, lineHeight: 1.5 }}
          >
            Para <strong>WhatsApp y Chat web</strong>. La <strong>despedida</strong> ya se envía
            automáticamente al cerrar un chat. Deja un campo vacío para usar el default genérico.
          </div>
          <div className="col" style={{ gap: 14 }}>
            <div>
              <label style={labelStyle}>Saludo de bienvenida</label>
              <Textarea
                rows={2}
                value={welcome}
                onChange={(e) => {
                  setWelcome(e.target.value);
                  setDirty(true);
                }}
                placeholder="¡Hola! 👋 Gracias por escribirnos. ¿En qué te podemos ayudar?"
              />
            </div>
            <div>
              <label style={labelStyle}>Fuera de horario / sin agentes</label>
              <Textarea
                rows={2}
                value={away}
                onChange={(e) => {
                  setAway(e.target.value);
                  setDirty(true);
                }}
                placeholder="Por ahora no hay agentes disponibles. Déjanos tu consulta y te respondemos apenas volvamos."
              />
            </div>
            <div>
              <label style={labelStyle}>Despedida (al cerrar)</label>
              <Textarea
                rows={2}
                value={farewell}
                onChange={(e) => {
                  setFarewell(e.target.value);
                  setDirty(true);
                }}
                placeholder="¡Gracias por contactarnos! Que tengas un buen día. 🙌"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Widget de chat web */}
      <Card>
        <CardBody>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Widget de chat web</div>
              <div
                className="muted"
                style={{ fontSize: 12, marginTop: 3, maxWidth: 520, lineHeight: 1.5 }}
              >
                Pega el snippet de tu widget de Amazon Connect para activar el chat en tu sitio. Lo
                generas en la consola de Connect →{" "}
                <strong>Canales → Widgets de comunicación</strong>.
              </div>
            </div>
            <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
              {!snippet.trim() && (
                <button
                  className="btn btn--sm"
                  onClick={() => {
                    setSnippet(TEMPLATE);
                    setDirty(true);
                  }}
                >
                  Insertar plantilla
                </button>
              )}
              <button
                className="btn btn--sm"
                disabled={!snippet.trim()}
                onClick={() => {
                  copy(snippet);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? (
                  <>
                    <Check size={12} /> Copiado
                  </>
                ) : (
                  <>
                    <Copy size={12} /> Copiar
                  </>
                )}
              </button>
            </div>
          </div>
          <Textarea
            rows={7}
            value={snippet}
            onChange={(e) => {
              setSnippet(e.target.value);
              setDirty(true);
            }}
            placeholder="Pega aquí el snippet <script> de tu widget de Amazon Connect…"
            style={{
              marginTop: 12,
              fontFamily: "ui-monospace, monospace",
              whiteSpace: "pre",
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
