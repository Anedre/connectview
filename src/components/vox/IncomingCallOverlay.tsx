import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAllActiveContacts, type ActiveContact } from "@/hooks/useActiveContact";
import { useCCP } from "@/hooks/useCCP";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Icon, Pill } from "@/components/aria";
import { useDebugRender } from "@/lib/debugTrace";

/** Vistazo rápido al lead por teléfono (manage-leads ?phone=) mientras timbra:
 *  si el número ya es un lead, el pop-up muestra su nombre + "Lead conocido";
 *  si no hay lead ni perfil, muestra "Desconocido". Best-effort con abort. */
interface LeadPeek {
  name?: string;
  company?: string;
  source?: string;
}
function useLeadPeek(phone: string | null): { lead: LeadPeek | null; checked: boolean } {
  const [lead, setLead] = useState<LeadPeek | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!phone) return;
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    const ctrl = new AbortController();
    authedFetch(`${ep.manageLeads}?phone=${encodeURIComponent(phone)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        setLead(((j.leads || [])[0] as LeadPeek) || null);
        setChecked(true);
      })
      .catch(() => setChecked(true));
    return () => ctrl.abort();
  }, [phone]);
  return { lead, checked: checked || !phone };
}

const LEAD_SOURCE_LABEL: Record<string, string> = {
  web_form: "Web",
  campaign: "Campaña",
  salesforce: "Salesforce",
  whatsapp: "WhatsApp",
  manual: "Manual",
};

/** +51943565466 → "+51 943 565 466" (solo E.164 limpios; lo demás tal cual). */
function prettyPhone(p?: string | null): string {
  if (!p) return "";
  const m = p.replace(/\s+/g, "").match(/^(\+\d{1,3})(\d{3})(\d{3})(\d{3,4})$/);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}

/** Iniciales humanas (máx 2 palabras). JAMÁS de un teléfono (el bug del "+5"). */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

/**
 * Global incoming-contact overlay. Subscribed to the active-contact stream
 * everywhere in the app — when a voice call, chat, email or task is ringing
 * a POP-UP with backdrop appears (over ANY screen, /agent included) with
 * Accept/Reject. Accepting routes the agent to /agent so the connected
 * contact lands straight on the in-call cockpit.
 *
 * Visuals mirror the "Vista demo" Ring (card + pulse + screen-pop chips),
 * wired to real profile/contact data. Header / icon / accent adapt to the
 * channel (voice · WhatsApp · chat · email · task).
 */
export function IncomingCallOverlay() {
  // Pick the most recent inbound ringing contact — when multiple
  // contacts ring at once (rare but possible in multi-channel) we
  // surface the freshest one. The other ringing tabs will still pulse
  // in the desktop's <ActiveContactsTabStrip>.
  const allContacts = useAllActiveContacts();
  const ringingContact = allContacts
    .filter(
      (c) =>
        c.direction !== "outbound" &&
        (c.state === "connecting" || c.state === "incoming" || c.state === "ringing"),
    )
    .sort((a, b) => b.lastSeenTs - a.lastSeenTs)[0];

  // UX requerido: TODO entrante se muestra como pop-up con overlay (backdrop),
  // en cualquier pantalla — incluido /agent. Aceptar lleva al workspace de la
  // llamada; el <ActiveContactsTabStrip> mantiene las otras tabs pulsando.
  useDebugRender("IncomingCallOverlay.gate", {
    contactId: ringingContact?.contactId,
    state: ringingContact?.state,
    visible: !!ringingContact,
  });

  if (!ringingContact) return null;
  return <IncomingCallOverlayBody contact={ringingContact} />;
}

interface OverlayBodyProps {
  contact: ActiveContact;
}

interface ChannelMeta {
  icon: string;
  label: string;
  color: string;
  tone: "green" | "cyan" | "gold" | "iris";
}

function IncomingCallOverlayBody({ contact }: OverlayBodyProps) {
  const { accept, reject } = useCCP();
  const { profile } = useCustomerProfile(contact.customerPhone ?? null);
  const { lead, checked: leadChecked } = useLeadPeek(contact.customerPhone ?? null);
  const navigate = useNavigate();
  const location = useLocation();

  useDebugRender("IncomingCallOverlay.body", {
    contactId: contact.contactId,
    state: contact.state,
    channel: contact.channel,
    hasProfile: !!profile,
    hasLead: !!lead,
  });

  // ─── Canal → meta (icono ARIA + label + color/tono) ───────────
  const channelKey = (contact.channel || "VOICE").toUpperCase();
  const isChat = channelKey === "CHAT";
  const isEmail = channelKey === "EMAIL";
  const isTask = channelKey === "TASK";
  const isWhatsApp = isChat && contact.attributes?.udep_source === "whatsapp";
  const isVoice = channelKey === "VOICE";

  const meta: ChannelMeta = isWhatsApp
    ? { icon: "wa", label: "WhatsApp entrante", color: "var(--green)", tone: "green" }
    : isChat
      ? { icon: "chat", label: "Chat entrante", color: "var(--cyan)", tone: "cyan" }
      : isEmail
        ? { icon: "mail", label: "Email entrante", color: "var(--gold)", tone: "gold" }
        : isTask
          ? { icon: "check", label: "Tarea entrante", color: "var(--iris)", tone: "iris" }
          : { icon: "arrowIn", label: "Llamada entrante", color: "var(--green)", tone: "green" };

  // Identidad: lead de ARIA (manage-leads) manda sobre el Customer Profile; si
  // ninguno tiene nombre, el título es "Desconocido" y el número pasa a ser la
  // línea protagonista (antes el número hacía de nombre y el avatar mostraba
  // las "iniciales" del teléfono: el bug del "+5").
  const profileName =
    profile?.businessName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
    null;
  const leadName = (lead?.name || "").trim() || null;
  const fullName = leadName || profileName;
  // Mientras el lookup del lead está en vuelo mostramos el número (no un
  // "Desconocido" prematuro que luego parpadee a nombre).
  const callerTitle =
    fullName || (leadChecked ? "Desconocido" : prettyPhone(contact.customerPhone) || "Entrante");
  // Empresa · fuente del lead como línea de texto (nada de arcoíris de chips).
  const leadMeta = [
    lead?.company,
    lead?.source ? LEAD_SOURCE_LABEL[lead.source] || lead.source : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Screen-pop: motivo / nivel puestos por el flow como atributos del contacto.
  const udepIntent = contact.attributes?.udep_intent;
  const udepNivel = contact.attributes?.udep_nivel;
  const intentLabelMap: Record<string, string> = {
    consultar_programa: "Consulta programa",
    solicitar_costos: "Costos / becas",
    agendar_visita: "Visita campus",
    soporte_alumno: "Soporte alumno",
    hablar_con_asesor: "Pide asesor",
  };
  const motivoLabel = udepIntent ? intentLabelMap[udepIntent] || udepIntent : null;
  const hasChips = !!(profile?.partyType || profile?.accountNumber || motivoLabel || udepNivel);

  const handleAccept = () => {
    // Aceptar ESTE contacto (en multi-contacto podría haber varios en cola).
    // Al aceptar, si no estamos en /agent navegamos allí → el contacto pasa a
    // connected y la página entra directo al cockpit en-llamada.
    accept(contact.contactId);
    if (location.pathname !== "/agent") navigate("/agent");
  };
  const handleReject = () => reject(contact.contactId);

  const acceptLabel = isVoice ? "Contestar" : "Aceptar";

  return (
    <div
      className="incoming-overlay inc-overlay"
      data-debug-component="IncomingCallOverlay"
      style={{ position: "fixed", zIndex: 200 }}
    >
      <div className="inc-card" style={{ "--inc-c": meta.color } as CSSProperties}>
        {/* Encabezado editorial: dot pulsante + canal + cola (el color del canal
            vive en el dot y la hairline superior — el card queda neutro). */}
        <div className="inc-head">
          <span className="inc-dot" aria-hidden="true" />
          {meta.label}
          {contact.queueName && <b>· {contact.queueName}</b>}
        </div>

        <div className="inc-hero">
          <span className="inc-ring" aria-hidden="true" />
          <span className="inc-ring" aria-hidden="true" />
          <span className="inc-avatar" aria-hidden="true">
            {fullName ? (
              initialsOf(fullName)
            ) : (
              // Sin nombre humano NO derivamos iniciales (el bug del "+5"):
              // ícono de persona con el tinte suave del canal.
              <Icon name="user" size={32} weight="duotone" />
            )}
          </span>
        </div>

        <div className={`inc-name ${fullName ? "" : "inc-name--unknown"}`}>{callerTitle}</div>
        {fullName
          ? contact.customerPhone && (
              <div className="inc-sub">{prettyPhone(contact.customerPhone)}</div>
            )
          : contact.customerPhone && (
              <div className="inc-phone">{prettyPhone(contact.customerPhone)}</div>
            )}
        {leadMeta && <div className="inc-meta">{leadMeta}</div>}

        {lead ? (
          <span className="inc-badge inc-badge--known">
            <i aria-hidden="true" />
            Lead conocido
          </span>
        ) : leadChecked && !fullName ? (
          <span className="inc-badge inc-badge--none">Sin registro</span>
        ) : null}

        {hasChips && (
          <div className="inc-chips">
            {profile?.partyType && <Pill tone="iris">{profile.partyType}</Pill>}
            {profile?.accountNumber && <Pill tone="cyan">{profile.accountNumber}</Pill>}
            {motivoLabel && <Pill tone="gold">{motivoLabel}</Pill>}
            {udepNivel && <Pill tone="cyan">{udepNivel}</Pill>}
          </div>
        )}

        <div className="inc-divider" aria-hidden="true" />

        <div className="inc-actions">
          <div className="inc-action">
            <button
              type="button"
              className="inc-btn inc-btn--reject"
              onClick={handleReject}
              title="Rechazar"
              aria-label="Rechazar"
            >
              <Icon name="phone" size={22} weight="fill" style={{ transform: "rotate(135deg)" }} />
            </button>
            <span className="inc-action__label">Rechazar</span>
          </div>
          <div className="inc-action">
            <button
              type="button"
              className="inc-btn inc-btn--accept"
              onClick={handleAccept}
              title={acceptLabel}
              aria-label={acceptLabel}
            >
              <Icon name={isVoice ? "phone" : meta.icon} size={24} weight="fill" />
            </button>
            <span className="inc-action__label">{acceptLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
