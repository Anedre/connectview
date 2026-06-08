import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useAllActiveContacts,
  useContactFocus,
  useMissedContacts,
  type ActiveContact,
  type MissedContact,
} from "@/hooks/useActiveContact";
import { useCCP } from "@/hooks/useCCP";
import { useOmnichannelNotifierContext } from "@/context/OmnichannelNotifierContext";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";

/**
 * Channel meta — icon + accent CSS tokens for each Connect channel.
 * The CSS tokens land on the tab via the `--ch` / `--ch-soft` custom
 * properties; the rest of the styling lives in index.css under
 * `.vox-ct*`. Keeping it data-driven lets us colour the channel rail,
 * icon background, and inline channel label from a single source of
 * truth.
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
    label: "Voz",
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

function metaFor(channel: string, attributes?: Record<string, string>) {
  const key = (channel || "VOICE").toUpperCase();
  if (key === "CHAT" && attributes?.udep_source === "whatsapp") {
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
  pulse?: boolean;
} | null {
  const s = contact.state;
  if (isRingingState(s)) {
    return { label: "Suena", color: "var(--accent-amber)", pulse: true };
  }
  if (s === "connected") {
    return { label: "Activo", color: "var(--accent-green)", pulse: true };
  }
  if (s === "onhold") {
    return { label: "Espera", color: "var(--accent-cyan)" };
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

/** Per-tab live duration leaf. Recomputes every second based on
 *  `connectedAtMs` so the timer stays accurate across re-renders of
 *  the parent (re-mounting would reset the local clock; this avoids
 *  that by deriving from the wall-clock anchor). */
function LiveDuration({ startedAtMs }: { startedAtMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startedAtMs) return null;
  const elapsed = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return <>{`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`}</>;
}

interface TabProps {
  contact: ActiveContact;
  focused: boolean;
  unread: number;
  onClick: () => void;
}

function ContactTab({ contact, focused, unread, onClick }: TabProps) {
  const meta = metaFor(contact.channel, contact.attributes);
  const Icn = meta.Icn;
  const ringing = isRingingState(contact.state);
  const missed = contact.state === "missed";
  const badge = stateBadge(contact);
  const channelKey = (contact.channel || "VOICE").toUpperCase();
  const isVoice = channelKey === "VOICE";

  const classNames = [
    "vox-ct",
    focused && "vox-ct--focused",
    ringing && "vox-ct--ringing",
    missed && "vox-ct--missed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames}
      style={
        {
          "--ch": meta.accent,
          "--ch-soft": meta.accentSoft,
        } as React.CSSProperties
      }
      title={`${meta.label} · ${customerLabel(contact)} · ${contact.state || "—"}`}
    >
      <span className="vox-ct__icon">
        <Icn />
        {unread > 0 && (
          <span
            className="vox-ct__unread"
            title={`${unread} mensaje${unread === 1 ? "" : "s"} sin leer`}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </span>

      <div className="vox-ct__body">
        <span className="vox-ct__name">{customerLabel(contact)}</span>
        <span className="vox-ct__meta">
          <span className="vox-ct__meta-channel">{meta.label}</span>
          {/* Live timer — voice connected only. Chat / email get a
              state badge instead since duration is less meaningful. */}
          {isVoice && contact.state === "connected" && contact.connectedAtMs && (
            <>
              <span className="vox-ct__meta-sep">·</span>
              <span className="vox-ct__meta-time">
                <LiveDuration startedAtMs={contact.connectedAtMs} />
              </span>
            </>
          )}
          {badge && (
            <>
              <span className="vox-ct__meta-sep">·</span>
              <span
                className="vox-ct__state"
                style={{ color: badge.color }}
              >
                <span
                  className={`vox-ct__state-dot${
                    badge.pulse ? " vox-ct__state-dot--pulse" : ""
                  }`}
                />
                {badge.label}
              </span>
            </>
          )}
        </span>
      </div>
    </button>
  );
}

/**
 * Missed-contact tab — distinct red theming so it can't be confused
 * with active ones. Auto-expires after 30s (TTL in the provider) or
 * when dismissed via the X / accepted via callback.
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
  const meta = metaFor(missed.channel, missed.attributes);
  const Icn = meta.Icn;
  const elapsed = Math.max(0, Math.floor((Date.now() - missed.missedAt) / 1000));
  const channel = (missed.channel || "VOICE").toUpperCase();
  const isVoice = channel === "VOICE";
  const canCallback = isVoice && !!missed.customerPhone;

  const handleCallback = async () => {
    if (!missed.customerPhone || callingBack) return;
    setCallingBack(true);
    try {
      await placeCall(missed.customerPhone);
      toast.success("Llamando…", {
        description: `Devolviendo llamada a ${missed.customerPhone}`,
      });
      onDismiss();
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
      className="vox-ct vox-ct--missed"
      style={
        {
          "--ch": "var(--accent-red)",
          "--ch-soft": "var(--accent-red-soft)",
          cursor: "default",
          maxWidth: 320,
        } as React.CSSProperties
      }
      title={`Contacto perdido · ${missed.customerPhone || missed.queueName || "—"} · hace ${elapsed}s`}
    >
      <span className="vox-ct__icon" style={{ background: "var(--accent-red)", color: "white" }}>
        <Icn />
      </span>
      <div className="vox-ct__body">
        <span className="vox-ct__name">
          {missed.customerPhone || missed.queueName || "Cliente"}
        </span>
        <span className="vox-ct__meta">
          <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>
            Perdida
          </span>
          <span className="vox-ct__meta-sep">·</span>
          <span>hace {elapsed}s</span>
        </span>
      </div>
      {canCallback && (
        <button
          type="button"
          onClick={handleCallback}
          disabled={callingBack}
          className="vox-ct__cb"
          title="Devolver la llamada"
        >
          <Icon.PhoneIn size={11} />
          {callingBack ? "…" : "Devolver"}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        title="Descartar"
        className="vox-ct__close"
        aria-label="Descartar"
      >
        <Icon.Close size={12} />
      </button>
    </div>
  );
}

/**
 * Horizontal strip of all the agent's current contacts + missed
 * tabs. Click a tab → focus that contact (rest of desktop re-points).
 * Scrolls horizontally when there are more tabs than fit.
 */
export function ActiveContactsTabStrip() {
  const contacts = useAllActiveContacts();
  const { focusedContactId, focus } = useContactFocus();
  const { missedContacts, dismissMissed } = useMissedContacts();
  const { unreadCount } = useOmnichannelNotifierContext();

  // Sort: focused first, ringing next, then by channel order.
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

  if (contacts.length === 0 && missedContacts.length === 0) return null;

  // Only show the count label when there are 2+ tabs — a single tab
  // doesn't need a "1 atención" prefix that just clutters the bar.
  const total = contacts.length + missedContacts.length;
  const showCount = total >= 2;

  return (
    <div className="vox-strip" data-debug-component="ActiveContactsTabStrip">
      {showCount && (
        <div className="vox-strip__count">
          {total} {total === 1 ? "atención" : "atenciones"}
        </div>
      )}
      {sorted.map((c) => (
        <ContactTab
          key={c.contactId}
          contact={c}
          focused={c.contactId === focusedContactId}
          unread={unreadCount[c.contactId] || 0}
          onClick={() => focus(c.contactId)}
        />
      ))}
      {missedContacts
        .filter((m) => !contacts.some((c) => c.contactId === m.contactId))
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
