import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useAllActiveContacts,
  useContactFocus,
  useMissedContacts,
  type ActiveContact,
  type MissedContact,
} from "@/hooks/useActiveContact";
import { useCCP } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";

/**
 * Channel meta for tabs. Each entry maps the contact channel to:
 *  - the icon component
 *  - an accent color (mainly used for the chip background tint
 *    and the active-tab border)
 *  - a fallback label shown when the contact has no customer name
 */
const CHANNEL_META: Record<
  string,
  {
    Icn: typeof Icon.Phone;
    accent: string;
    accentSoft: string;
    label: string;
  }
> = {
  VOICE: {
    Icn: Icon.Phone,
    accent: "var(--accent-green)",
    accentSoft: "var(--accent-green-soft)",
    label: "Llamada",
  },
  CHAT: {
    Icn: Icon.Chat,
    accent: "var(--accent-cyan)",
    accentSoft: "var(--accent-cyan-soft)",
    label: "Chat",
  },
  EMAIL: {
    Icn: Icon.Mail,
    accent: "var(--accent-amber)",
    accentSoft: "var(--accent-amber-soft)",
    label: "Email",
  },
  TASK: {
    Icn: Icon.Note,
    accent: "var(--accent-violet)",
    accentSoft: "var(--accent-violet-soft)",
    label: "Tarea",
  },
};

function metaFor(contact: ActiveContact) {
  const key = (contact.channel || "VOICE").toUpperCase();
  if (
    key === "CHAT" &&
    contact.attributes?.udep_source === "whatsapp"
  ) {
    return {
      ...CHANNEL_META.CHAT,
      Icn: Icon.WhatsApp,
      accent: "var(--accent-green)",
      accentSoft: "var(--accent-green-soft)",
      label: "WhatsApp",
    };
  }
  return CHANNEL_META[key] ?? CHANNEL_META.VOICE;
}

function isRingingState(s: string) {
  return s === "ringing" || s === "incoming" || s === "connecting";
}

function customerLabel(contact: ActiveContact): string {
  if (contact.customerPhone) return contact.customerPhone;
  if (contact.queueName) return contact.queueName;
  return "Contacto entrante";
}

function stateBadge(contact: ActiveContact): {
  label: string;
  color: string;
} | null {
  const s = contact.state;
  if (isRingingState(s)) {
    return { label: "Suena", color: "var(--accent-amber)" };
  }
  if (s === "connected") {
    return { label: "Activo", color: "var(--accent-green)" };
  }
  if (s === "onhold") {
    return { label: "En espera", color: "var(--accent-cyan)" };
  }
  if (s === "acw") {
    return { label: "Wrap-up", color: "var(--accent-violet)" };
  }
  if (s === "missed") {
    return { label: "Perdida", color: "var(--accent-red)" };
  }
  if (s === "ended") {
    return { label: "Cerrado", color: "var(--text-3)" };
  }
  return null;
}

function isMissedState(s: string) {
  return s === "missed";
}

interface TabProps {
  contact: ActiveContact;
  focused: boolean;
  onClick: () => void;
}

function ContactTab({ contact, focused, onClick }: TabProps) {
  const meta = metaFor(contact);
  const Icn = meta.Icn;
  const ringing = isRingingState(contact.state);
  const missed = isMissedState(contact.state);
  const badge = stateBadge(contact);
  // Missed contacts get the same red treatment as the
  // historical-missed pill — they're alive but blocked, and the
  // agent has to close them explicitly.
  const tabBorder = missed
    ? "var(--accent-red)"
    : focused
    ? meta.accent
    : "var(--border-1)";
  const tabBg = missed
    ? "var(--accent-red-soft)"
    : focused
    ? meta.accentSoft
    : "var(--bg-1)";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`contact-tab${focused ? " contact-tab--focused" : ""}${
        ringing ? " contact-tab--ringing" : ""
      }${missed ? " contact-tab--missed-live" : ""}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px 6px 8px",
        minHeight: 36,
        borderRadius: 8,
        border: `1px solid ${tabBorder}`,
        background: tabBg,
        color: "var(--text-1)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        transition: "background 0.12s ease, border-color 0.12s ease",
        maxWidth: 240,
        position: "relative",
      }}
      title={`${meta.label} · ${customerLabel(contact)} · ${contact.state || "—"}`}
    >
      {/* Channel icon — colored circle */}
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: 999,
          background: meta.accentSoft,
          color: meta.accent,
          flexShrink: 0,
        }}
      >
        <Icn size={12} />
      </span>

      {/* Main label */}
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          alignItems: "flex-start",
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 160,
          }}
        >
          {customerLabel(contact)}
        </span>
        {badge && (
          <span
            style={{
              fontSize: 10,
              color: badge.color,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            <span
              className={ringing ? "pulse" : ""}
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: badge.color,
                marginRight: 4,
                verticalAlign: "middle",
              }}
            />
            {badge.label}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Tab for a missed contact (state="missed"). Distinct red styling so
 * it doesn't get confused with active tabs. Auto-disappears after 30 s
 * (TTL controlled by the provider), or when the agent dismisses via
 * the X / callback buttons.
 *
 * Actions:
 *   📞 Devolver — places an outbound call back to the missed customer
 *                 (voice channel only — chat/email outbound is more
 *                  involved and lives in a different flow).
 *   👁 Ver perfil — opens the Customer 360° drawer for this phone.
 *   ✕ Descartar — removes the tab from the strip immediately.
 */
function MissedTab({
  missed,
  onDismiss,
}: {
  missed: MissedContact;
  onDismiss: () => void;
}) {
  const { placeCall } = useCCP();
  const [callingBack, setCallingBack] = useState(false);

  const meta = metaFor({
    contactId: missed.contactId,
    channel: missed.channel,
    state: "missed",
    customerPhone: missed.customerPhone,
    queueName: missed.queueName,
    direction: "inbound",
    attributes: missed.attributes,
    lastSeenTs: missed.missedAt,
  });
  const Icn = meta.Icn;
  const elapsed = Math.max(0, Math.floor((Date.now() - missed.missedAt) / 1000));
  const channel = (missed.channel || "VOICE").toUpperCase();
  const isVoice = channel === "VOICE";
  // For voice we can place a callback. For chat/email outbound is a
  // different flow we don't have yet — disable the button and explain
  // via tooltip.
  const canCallback = isVoice && !!missed.customerPhone;

  const handleCallback = async () => {
    if (!missed.customerPhone || callingBack) return;
    setCallingBack(true);
    try {
      await placeCall(missed.customerPhone);
      toast.success("Llamando…", {
        description: `Devolviendo llamada a ${missed.customerPhone}`,
      });
      onDismiss(); // remove the tab — the new outbound contact takes over
    } catch (err) {
      toast.error("No se pudo iniciar la llamada", {
        description: err instanceof Error ? err.message : "Error desconocido",
      });
    } finally {
      setCallingBack(false);
    }
  };

  return (
    <div
      className="contact-tab contact-tab--missed"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 4px 6px 8px",
        minHeight: 36,
        borderRadius: 8,
        border: "1px solid var(--accent-red)",
        background: "var(--accent-red-soft)",
        color: "var(--text-1)",
        fontFamily: "inherit",
        fontSize: 12,
        maxWidth: 320,
      }}
      title={`Contacto perdido · ${missed.customerPhone || missed.queueName || "—"} · hace ${elapsed}s`}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "var(--accent-red)",
          color: "white",
          flexShrink: 0,
        }}
      >
        <Icn size={12} />
      </span>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          alignItems: "flex-start",
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 160,
          }}
        >
          {missed.customerPhone || missed.queueName || "Cliente"}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--accent-red)",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          Perdida · hace {elapsed}s
        </span>
      </span>
      {/* Callback button (voice only) */}
      <button
        type="button"
        onClick={handleCallback}
        disabled={!canCallback || callingBack}
        title={
          isVoice
            ? canCallback
              ? "Devolver llamada"
              : "Sin teléfono asociado"
            : "Devolución solo disponible para voz"
        }
        style={{
          marginLeft: 2,
          padding: "3px 6px",
          background: canCallback ? "var(--accent-green)" : "transparent",
          border: canCallback
            ? "1px solid var(--accent-green)"
            : "1px solid var(--border-1)",
          color: canCallback ? "white" : "var(--text-3)",
          cursor: canCallback && !callingBack ? "pointer" : "not-allowed",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          gap: 3,
          fontSize: 10,
          fontWeight: 500,
          opacity: canCallback ? 1 : 0.45,
        }}
      >
        <Icon.PhoneIn size={10} />
        {callingBack ? "…" : "Devolver"}
      </button>
      {/* Dismiss */}
      <button
        type="button"
        onClick={onDismiss}
        title="Descartar"
        style={{
          marginLeft: 2,
          padding: 2,
          background: "transparent",
          border: "none",
          color: "var(--accent-red)",
          cursor: "pointer",
          borderRadius: 4,
          display: "grid",
          placeItems: "center",
          opacity: 0.7,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
      >
        <Icon.Close size={12} />
      </button>
    </div>
  );
}

/**
 * Horizontal-wrap strip of every contact the agent currently has.
 * Click a tab → that contact becomes the focused one (the rest of the
 * desktop re-points to it). Ringing tabs pulse to signal a new contact
 * needing attention without stealing focus.
 *
 * The strip wraps to multiple rows when there are too many tabs to fit
 * on one — per the user's preference we never hide a contact behind a
 * "+N más" overflow chip.
 */
export function ActiveContactsTabStrip() {
  const contacts = useAllActiveContacts();
  const { focusedContactId, focus } = useContactFocus();
  const { missedContacts, dismissMissed } = useMissedContacts();

  // Sort so the focused tab stays first, then ringing, then by channel.
  // Stable order so tabs don't jump around mid-conversation.
  const sorted = useMemo(() => {
    const channelOrder: Record<string, number> = {
      VOICE: 0,
      CHAT: 1,
      EMAIL: 2,
      TASK: 3,
    };
    return [...contacts].sort((a, b) => {
      if (a.contactId === focusedContactId) return -1;
      if (b.contactId === focusedContactId) return 1;
      const aRing = isRingingState(a.state) ? 0 : 1;
      const bRing = isRingingState(b.state) ? 0 : 1;
      if (aRing !== bRing) return aRing - bRing;
      const ac = channelOrder[(a.channel || "").toUpperCase()] ?? 9;
      const bc = channelOrder[(b.channel || "").toUpperCase()] ?? 9;
      if (ac !== bc) return ac - bc;
      return a.contactId.localeCompare(b.contactId);
    });
  }, [contacts, focusedContactId]);

  useDebugRender("ActiveContactsTabStrip", {
    count: contacts.length,
    missedCount: missedContacts.length,
    focusedContactId,
  });

  // Render nothing when there's literally nothing to show.
  if (contacts.length === 0 && missedContacts.length === 0) return null;

  // Header label switches based on what's in the strip.
  let header: string;
  if (contacts.length === 0) {
    header =
      missedContacts.length === 1
        ? "1 perdida"
        : `${missedContacts.length} perdidas`;
  } else if (missedContacts.length === 0) {
    header = contacts.length === 1 ? "1 atención" : `${contacts.length} atenciones`;
  } else {
    header = `${contacts.length} ${contacts.length === 1 ? "atención" : "atenciones"} · ${missedContacts.length} perdida${missedContacts.length === 1 ? "" : "s"}`;
  }

  return (
    <div
      data-debug-component="ActiveContactsTabStrip"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border-1)",
        background: "var(--bg-1)",
        maxHeight: 100,
        overflowY: "auto",
      }}
    >
      <div
        className="muted mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          alignSelf: "center",
          marginRight: 4,
        }}
      >
        {header}
      </div>
      {sorted.map((c) => (
        <ContactTab
          key={c.contactId}
          contact={c}
          focused={c.contactId === focusedContactId}
          onClick={() => focus(c.contactId)}
        />
      ))}
      {/* Dedup: if a missed contact is also alive in the active list
          (typical for chat / WhatsApp / email — they stay attached
          until cleared), only render the active tab. The notifier
          + banner still fire from the missedContacts feed. We only
          render a standalone MissedTab here for missed contacts
          that Streams already dropped from the active list (voice). */}
      {missedContacts
        .filter(
          (m) => !contacts.some((c) => c.contactId === m.contactId)
        )
        .map((m) => (
          <MissedTab
            key={`missed-${m.contactId}`}
            missed={m}
            onDismiss={() => dismissMissed(m.contactId)}
          />
        ))}
    </div>
  );
}
