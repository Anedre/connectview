import { useNavigate, useLocation } from "react-router-dom";
import {
  useAllActiveContacts,
  type ActiveContact,
} from "@/hooks/useActiveContact";
import { useCCP } from "@/hooks/useCCP";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";

/**
 * Global incoming-contact overlay. Subscribed to the active-contact stream
 * everywhere in the app — when a voice call, chat, email or task is ringing
 * a modal pops up with Accept/Reject. Accepting routes the agent to /agent
 * so they have the full workspace.
 *
 * The header / icon / chip / wording all adapt to the contact's channel:
 *   - VOICE  → "Llamada entrante" with phone ringing icon
 *   - CHAT (with udep_source=whatsapp) → "WhatsApp entrante" with WA icon
 *   - CHAT (generic) → "Chat entrante" with chat bubble
 *   - EMAIL → "Email entrante"
 *   - TASK  → "Tarea entrante"
 */
/**
 * Thin visibility gate. The previous version of this component called
 * `useCustomerProfile` (which fires a fetch when the phone changes)
 * unconditionally — including during an active chat where the overlay
 * is hidden. That meant every contact attribute update re-fetched the
 * profile for the customer 360° even though the overlay wasn't shown.
 *
 * Splitting it like this lets us early-return cheaply when the overlay
 * isn't ringing and only mount the expensive inner body (with its
 * fetch hook and channel-aware rendering) during the actual ringing
 * window.
 */
export function IncomingCallOverlay() {
  const location = useLocation();
  // Pick the most recent inbound ringing contact — when multiple
  // contacts ring at once (rare but possible in multi-channel) we
  // surface the freshest one. The other ringing tabs will still pulse
  // in the desktop's <ActiveContactsTabStrip>.
  const allContacts = useAllActiveContacts();
  const ringingContact = allContacts
    .filter(
      (c) =>
        c.direction !== "outbound" &&
        (c.state === "connecting" || c.state === "incoming" || c.state === "ringing")
    )
    .sort((a, b) => b.lastSeenTs - a.lastSeenTs)[0];

  // Per the user's UX requirement: the full-screen modal only appears
  // when the agent is OUTSIDE the agent desktop (it's a notification
  // to pull them in). Inside /agent, the <ActiveContactsTabStrip>
  // already shows the ringing tab pulsing, which is a discreet enough
  // indicator while keeping the agent's current attention intact.
  const onAgentRoute = location.pathname.startsWith("/agent");

  useDebugRender("IncomingCallOverlay.gate", {
    contactId: ringingContact?.contactId,
    state: ringingContact?.state,
    onAgentRoute,
    visible: !!ringingContact && !onAgentRoute,
  });

  if (!ringingContact) return null;
  if (onAgentRoute) return null;
  return <IncomingCallOverlayBody contact={ringingContact} />;
}

interface OverlayBodyProps {
  contact: ActiveContact;
}

function IncomingCallOverlayBody({ contact }: OverlayBodyProps) {
  const { accept, reject } = useCCP();
  const { profile } = useCustomerProfile(contact.customerPhone ?? null);
  const navigate = useNavigate();
  const location = useLocation();

  useDebugRender("IncomingCallOverlay.body", {
    contactId: contact.contactId,
    state: contact.state,
    channel: contact.channel,
    hasProfile: !!profile,
  });

  // ─── Channel awareness ────────────────────────────────────────
  const channelKey = (contact.channel || "VOICE").toUpperCase();
  const isChat = channelKey === "CHAT";
  const isEmail = channelKey === "EMAIL";
  const isTask = channelKey === "TASK";
  const isWhatsApp =
    isChat && contact.attributes?.udep_source === "whatsapp";

  // Header label + icon per channel
  const ringerIcon = isWhatsApp ? (
    <Icon.WhatsApp size={32} />
  ) : isChat ? (
    <Icon.Chat size={32} />
  ) : isEmail ? (
    <Icon.Mail size={32} />
  ) : isTask ? (
    <Icon.Note size={32} />
  ) : (
    <Icon.PhoneIn size={32} />
  );
  const headerLabel = isWhatsApp
    ? "WhatsApp entrante"
    : isChat
    ? "Chat entrante"
    : isEmail
    ? "Email entrante"
    : isTask
    ? "Tarea entrante"
    : "Llamada entrante";

  // Brand-tinted accent for the icon background — green for WhatsApp,
  // cyan for chat, violet for email/task, default amber for voice.
  const accentColor = isWhatsApp
    ? "var(--accent-green, #25d366)"
    : isChat
    ? "var(--accent-cyan)"
    : isEmail || isTask
    ? "var(--accent-violet)"
    : undefined;

  const acceptIcon = isWhatsApp ? (
    <Icon.WhatsApp size={22} />
  ) : isChat ? (
    <Icon.Chat size={22} />
  ) : isEmail ? (
    <Icon.Mail size={22} />
  ) : isTask ? (
    <Icon.Note size={22} />
  ) : (
    <Icon.PhoneIn size={22} />
  );

  const fullName =
    profile?.businessName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
    null;
  const callerName =
    fullName ||
    contact.customerPhone ||
    (isChat || isEmail || isTask ? "Cliente nuevo" : "Cliente entrante");
  const callerSub = contact.customerPhone
    ? `${contact.customerPhone} · ${contact.queueName || ""}`
    : contact.queueName || "";

  // UDEP-specific quick-context chips (motivo / nivel) when the flow set
  // them as contact attributes. Lets the agent see at a glance what the
  // chat is about *before* they accept.
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

  const handleAccept = () => {
    // Target this specific contact — in multi-contact mode the agent
    // could have several contacts queued up, and we want to accept
    // the one the overlay is showing, not whichever Streams returns
    // first.
    accept(contact.contactId);
    if (location.pathname !== "/agent") navigate("/agent");
  };
  const handleReject = () => reject(contact.contactId);

  return (
    <div
      className="incoming-overlay"
      data-debug-component="IncomingCallOverlay"
      style={{ position: "fixed", zIndex: 200 }}
    >
      <div className="incoming">
        <div
          className="incoming__ring"
          style={accentColor ? { color: accentColor } : undefined}
        >
          {ringerIcon}
        </div>
        <div
          className="muted mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {headerLabel} · {contact.queueName || channelKey}
        </div>
        <div className="incoming__name">{callerName}</div>
        <div className="incoming__sub">{callerSub}</div>
        <div
          className="row"
          style={{ justifyContent: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}
        >
          {profile?.partyType && (
            <span className="chip chip--violet">{profile.partyType}</span>
          )}
          {profile?.accountNumber && (
            <span className="chip chip--cyan mono" style={{ fontSize: 10.5 }}>
              {profile.accountNumber}
            </span>
          )}
          {motivoLabel && (
            <span className="chip chip--amber">{motivoLabel}</span>
          )}
          {udepNivel && (
            <span className="chip chip--cyan">{udepNivel}</span>
          )}
        </div>
        <div className="incoming__actions">
          <button
            className="incoming__btn incoming__btn--reject"
            onClick={handleReject}
            title={isChat || isEmail || isTask ? "Rechazar" : "Rechazar"}
          >
            <Icon.Hangup size={22} />
          </button>
          <button
            className="incoming__btn incoming__btn--accept"
            onClick={handleAccept}
            title="Aceptar"
            style={
              accentColor
                ? { background: accentColor, borderColor: accentColor }
                : undefined
            }
          >
            {acceptIcon}
          </button>
        </div>
      </div>
    </div>
  );
}
