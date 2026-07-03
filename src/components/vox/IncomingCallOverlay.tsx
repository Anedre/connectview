import { useNavigate, useLocation } from "react-router-dom";
import {
  useAllActiveContacts,
  type ActiveContact,
} from "@/hooks/useActiveContact";
import { useCCP } from "@/hooks/useCCP";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { Av, Icon, Pill } from "@/components/aria";
import { useDebugRender } from "@/lib/debugTrace";

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
        (c.state === "connecting" || c.state === "incoming" || c.state === "ringing")
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
  const navigate = useNavigate();
  const location = useLocation();

  useDebugRender("IncomingCallOverlay.body", {
    contactId: contact.contactId,
    state: contact.state,
    channel: contact.channel,
    hasProfile: !!profile,
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

  const fullName =
    profile?.businessName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
    null;
  const callerName =
    fullName ||
    contact.customerPhone ||
    (isChat || isEmail || isTask ? "Cliente nuevo" : "Cliente entrante");
  const callerSub = [contact.customerPhone, contact.queueName]
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
  const hasChips = !!(
    profile?.partyType ||
    profile?.accountNumber ||
    motivoLabel ||
    udepNivel
  );

  const handleAccept = () => {
    // Aceptar ESTE contacto (en multi-contacto podría haber varios en cola).
    // Al aceptar, si no estamos en /agent navegamos allí → el contacto pasa a
    // connected y la página entra directo al cockpit en-llamada.
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
      <div
        className="card card--pop ring-pulse"
        style={{
          padding: 32,
          textAlign: "center",
          maxWidth: 440,
          width: "100%",
          margin: "0 20px",
          borderColor: `color-mix(in srgb, ${meta.color} 45%, var(--border-1))`,
        }}
      >
        <Pill tone={meta.tone} icon={meta.icon} style={{ margin: "0 auto" }}>
          {meta.label}
          {contact.queueName ? ` · ${contact.queueName}` : ""}
        </Pill>

        <div style={{ margin: "20px auto 14px", width: "fit-content" }}>
          <Av name={callerName} size={84} radius={26} color={meta.color} />
        </div>

        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>
          {callerName}
        </div>
        {callerSub && (
          <div className="mono dim" style={{ fontSize: 13, marginTop: 4 }}>
            {callerSub}
          </div>
        )}

        {hasChips && (
          <div
            className="row gap6 wrap"
            style={{ marginTop: 12, justifyContent: "center" }}
          >
            {profile?.partyType && <Pill tone="iris">{profile.partyType}</Pill>}
            {profile?.accountNumber && (
              <Pill tone="cyan">{profile.accountNumber}</Pill>
            )}
            {motivoLabel && <Pill tone="gold">{motivoLabel}</Pill>}
            {udepNivel && <Pill tone="cyan">{udepNivel}</Pill>}
          </div>
        )}

        <div
          className="row gap12"
          style={{ marginTop: 24, justifyContent: "center" }}
        >
          <button
            type="button"
            className="btn"
            onClick={handleReject}
            title="Rechazar"
            style={{
              background: "var(--red)",
              color: "#fff",
              height: 52,
              width: 52,
              borderRadius: "50%",
              padding: 0,
            }}
          >
            <Icon
              name="phone"
              size={22}
              weight="fill"
              style={{ transform: "rotate(135deg)" }}
            />
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleAccept}
            title="Aceptar"
            style={{
              background: meta.color,
              color: "#fff",
              height: 52,
              padding: "0 26px",
              borderRadius: 99,
              fontWeight: 750,
            }}
          >
            <Icon name={isVoice ? "phone" : meta.icon} size={20} weight="fill" />
            {isVoice ? "Contestar" : "Aceptar"}
          </button>
        </div>
      </div>
    </div>
  );
}
