import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAllActiveContacts } from "@/hooks/useActiveContact";
import { useCCP } from "@/hooks/useCCP";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { Avatar, colorFromName } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

/**
 * Floating call widget — appears in the bottom-right corner whenever
 * the agent has a live contact AND is not on /agent, so they don't lose
 * the call when navigating to dashboards, campaigns, etc.
 *
 * Two visual modes:
 *   - Expanded: avatar + name + timer + Mute / Hold / Hangup + "Volver".
 *     Default state for an active call.
 *   - Minimized: thin pill with a pulse + name + timer. Toggled via
 *     the chevron button. Persists across re-renders via local state.
 *
 * Inbound *ringing* contacts are NOT shown here — those are owned by
 * the global <IncomingCallOverlay>, which already presents Accept /
 * Reject full-screen when the agent is off /agent. The widget kicks in
 * once the call is connected (or while the agent is outbound-dialing).
 */
export function FloatingCallWidget() {
  const location = useLocation();
  const navigate = useNavigate();
  const allContacts = useAllActiveContacts();
  const { muted, onHold, mute, toggleHold, hangup } = useCCP();
  const [minimized, setMinimized] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Pick the freshest contact that is in a state worth showing in the
  // widget. We skip "missed" (handled by MissedCallBanner) and "ended"
  // (handled by wrap-up). Ringing contacts that the agent hasn't accepted
  // are also skipped because the IncomingCallOverlay covers that case.
  const liveContact = useMemo(() => {
    return allContacts
      .filter((c) => {
        const s = c.state;
        if (s === "connected" || s === "onHold") return true;
        // Outbound dialing: agent initiated, no overlay shown for it.
        if (
          c.direction === "outbound" &&
          (s === "connecting" || s === "incoming" || s === "ringing")
        ) {
          return true;
        }
        return false;
      })
      .sort((a, b) => b.lastSeenTs - a.lastSeenTs)[0];
  }, [allContacts]);

  // Pull the customer profile so we can show a real name instead of just
  // the phone when one exists. Hook returns early-null when phone is null.
  const { profile } = useCustomerProfile(liveContact?.customerPhone ?? null);

  // Tick the timer locally so it stays accurate without depending on
  // a parent re-render. Reset whenever the contactId changes.
  useEffect(() => {
    if (!liveContact) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [liveContact?.contactId]);

  // ─── Visibility gates ────────────────────────────────────────────
  // 1) No contact → nothing to show
  // 2) On /agent → the full desktop already shows the softphone, the
  //    widget would be redundant + visually noisy
  // 3) On /login or unauthenticated routes → don't bleed the call into
  //    the auth screen if for some reason it shows
  const onAgentRoute = location.pathname.startsWith("/agent");
  const onAuthRoute = location.pathname.startsWith("/login");

  if (!liveContact) return null;
  if (onAgentRoute) return null;
  if (onAuthRoute) return null;

  const channelKey = (liveContact.channel || "VOICE").toUpperCase();
  const isVoice = channelKey === "VOICE";
  const isChat = channelKey === "CHAT";
  const isEmail = channelKey === "EMAIL";
  const isTask = channelKey === "TASK";
  const isWhatsApp =
    isChat && liveContact.attributes?.udep_source === "whatsapp";

  const channelLabel = isWhatsApp
    ? "WhatsApp"
    : isChat
    ? "Chat"
    : isEmail
    ? "Email"
    : isTask
    ? "Tarea"
    : "Llamada";

  const channelColor = isWhatsApp
    ? "var(--accent-green, #25d366)"
    : isChat
    ? "var(--accent-cyan)"
    : isEmail || isTask
    ? "var(--accent-violet)"
    : "var(--accent-amber)";

  const ChannelIcon = isWhatsApp
    ? Icon.WhatsApp
    : isChat
    ? Icon.Chat
    : isEmail
    ? Icon.Mail
    : isTask
    ? Icon.Note
    : Icon.PhoneIn;

  const fullName =
    profile?.businessName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
    null;
  const callerName =
    fullName || liveContact.customerPhone || "Cliente";
  const avatarColor = colorFromName(callerName);

  const isDialing =
    liveContact.direction === "outbound" &&
    (liveContact.state === "connecting" ||
      liveContact.state === "incoming" ||
      liveContact.state === "ringing");
  const isLive =
    liveContact.state === "connected" || liveContact.state === "onHold";

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  };

  // ─── Minimized pill (compact) ──────────────────────────────────
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label="Expandir control de llamada"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 180,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px 8px 10px",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 999,
          boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
          cursor: "pointer",
          color: "var(--text-1)",
          fontFamily: "var(--font-ui)",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: channelColor,
            color: "#fff",
            position: "relative",
          }}
        >
          <ChannelIcon size={14} />
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: isDialing
                ? "var(--accent-cyan)"
                : onHold
                ? "var(--accent-amber)"
                : "var(--accent-green)",
              boxShadow: "0 0 0 2px var(--bg-1)",
            }}
            className="pulse"
          />
        </span>
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {callerName.length > 18 ? callerName.slice(0, 17) + "…" : callerName}
          </span>
          <span
            className="mono muted"
            style={{ fontSize: 10.5 }}
          >
            {isDialing ? "Marcando…" : fmt(elapsed)}
          </span>
        </span>
      </button>
    );
  }

  // ─── Expanded card (default) ───────────────────────────────────
  return (
    <div
      role="region"
      aria-label="Control de llamada"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        width: 308,
        zIndex: 180,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: 14,
        boxShadow: "0 18px 44px rgba(0,0,0,0.45)",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
      }}
    >
      {/* Top accent strip — color hints at channel */}
      <div
        style={{
          height: 3,
          background: channelColor,
        }}
      />

      {/* Header — caller info + minimize */}
      <div
        style={{
          padding: "12px 12px 10px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Avatar name={callerName} size="md" color={avatarColor} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {callerName}
          </div>
          <div
            className="muted mono"
            style={{
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {liveContact.customerPhone || liveContact.queueName || "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="btn btn--ghost btn--sm btn--icon"
          aria-label="Minimizar"
          title="Minimizar"
        >
          {/* Inline minus icon — primitives.tsx doesn't ship one */}
          <svg
            viewBox="0 0 24 24"
            width={14}
            height={14}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      {/* Status row — channel + timer + state dot */}
      <div
        style={{
          padding: "0 12px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11.5,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: 999,
            background: "var(--bg-2)",
            color: channelColor,
            fontWeight: 500,
          }}
        >
          <ChannelIcon size={11} />
          {channelLabel}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {isDialing ? "··:··" : fmt(elapsed)}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            color: isDialing
              ? "var(--accent-cyan)"
              : onHold
              ? "var(--accent-amber)"
              : "var(--accent-green)",
          }}
        >
          <span
            className="pulse"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          {isDialing ? "Marcando" : onHold ? "En espera" : "En vivo"}
        </span>
      </div>

      {/* Voice controls — only for voice contacts. Chat/email/task
          don't have mute/hold semantics; for them we just show hangup +
          back-to-desktop. */}
      {isVoice && isLive && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
            padding: "0 12px 10px",
          }}
        >
          <button
            type="button"
            className={`softphone__btn ${muted ? "softphone__btn--on" : ""}`}
            onClick={() => mute()}
            title={muted ? "Quitar mute" : "Silenciar mi micrófono"}
            style={{ padding: "8px 4px", fontSize: 11 }}
          >
            {muted ? <Icon.MicOff size={14} /> : <Icon.Mic size={14} />}
            <span>{muted ? "Muted" : "Mute"}</span>
          </button>
          <button
            type="button"
            className={`softphone__btn ${onHold ? "softphone__btn--on" : ""}`}
            onClick={() => toggleHold()}
            title={onHold ? "Reanudar" : "Poner en espera"}
            style={{ padding: "8px 4px", fontSize: 11 }}
          >
            <Icon.Pause size={14} />
            <span>{onHold ? "Espera" : "Hold"}</span>
          </button>
          <button
            type="button"
            className="softphone__btn"
            onClick={() => hangup(liveContact.contactId)}
            title="Colgar"
            style={{
              padding: "8px 4px",
              fontSize: 11,
              color: "var(--accent-red)",
              borderColor: "var(--accent-red-soft)",
            }}
          >
            <Icon.Hangup size={14} />
            <span>Colgar</span>
          </button>
        </div>
      )}

      {/* Non-voice / non-live: a single end button so the agent can
          still abort the contact from outside the desktop. */}
      {(!isVoice || !isLive) && (
        <div style={{ padding: "0 12px 10px" }}>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => hangup(liveContact.contactId)}
            style={{
              width: "100%",
              height: 34,
              justifyContent: "center",
              fontSize: 12,
            }}
          >
            <Icon.Hangup size={13} />
            {isDialing
              ? "Cancelar marcado"
              : isChat
              ? "Finalizar chat"
              : isEmail
              ? "Cerrar email"
              : isTask
              ? "Cerrar tarea"
              : "Colgar"}
          </button>
        </div>
      )}

      {/* Footer — back to desktop */}
      <div
        style={{
          padding: "10px 12px",
          background: "var(--bg-2)",
          borderTop: "1px solid var(--border-1)",
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/agent")}
          className="btn"
          style={{
            width: "100%",
            height: 34,
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <Icon.Activity size={13} />
          Volver al desktop
        </button>
      </div>
    </div>
  );
}
