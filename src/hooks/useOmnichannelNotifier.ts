import { useEffect, useRef, useCallback, useState } from "react";
import {
  useAllActiveContacts,
  useContactFocus,
  type ActiveContact,
} from "@/hooks/useActiveContact";

/**
 * useOmnichannelNotifier — single-source notifier for the multi-contact
 * desktop. Responsibilities:
 *
 *  1. **Browser notifications** for two events:
 *     - A *new* contact arrives (call ringing, chat opens, email lands).
 *       Fires once per contactId-state transition into ringing/incoming.
 *     - A *customer message* arrives in a chat the agent is NOT currently
 *       focused on. So the agent can be on a voice call and still know a
 *       WhatsApp customer just replied.
 *
 *  2. **Unread-count tracking** per chat. Resets to 0 when that contact
 *     becomes focused. Surfaced as a Map<contactId, number> so the
 *     ActiveContactsTabStrip can render a badge.
 *
 *  3. **Sound alert** — short subtle beep for new contacts / unfocused
 *     messages, generated via WebAudio so we don't ship an MP3.
 *
 * Permission is requested lazily on first relevant event (so the page
 * doesn't slap users with a permission prompt on initial load).
 */

interface UseOmnichannelNotifierResult {
  /** Map: contactId → number of unread customer messages */
  unreadCount: Record<string, number>;
  /** Permission state — "granted" / "denied" / "default" */
  permission: NotificationPermission;
  /** Explicitly ask for notification permission (e.g. from a button). */
  requestPermission: () => Promise<NotificationPermission>;
}

const NEW_CONTACT_TITLE: Record<string, string> = {
  VOICE: "📞 Llamada entrante",
  CHAT: "💬 Chat entrante",
  EMAIL: "📧 Email nuevo",
  TASK: "📋 Tarea nueva",
};

function newContactBody(c: ActiveContact): string {
  const isWA = c.channel?.toUpperCase() === "CHAT" && c.attributes?.udep_source === "whatsapp";
  const channelLabel = isWA ? "WhatsApp" : c.channel?.toLowerCase() || "contacto";
  const who = c.customerPhone || c.queueName || "Cliente";
  return `${who} (${channelLabel})`;
}

// Pre-built WebAudio "ding" so we don't request a network resource and so
// browsers can play it inside a user-gesture stack from earlier in the
// session (the focus click that opened the desktop).
function playDing(kind: "incoming" | "message") {
  try {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC: typeof AudioContext | undefined = w.AudioContext || w.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Distinct timbres so the agent learns: high-double = new contact,
    // low-single = message in an existing chat.
    if (kind === "incoming") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.12);
    } else {
      osc.frequency.setValueAtTime(620, ctx.currentTime);
    }
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.42);
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch {
    /* WebAudio not available — silently skip */
  }
}

function isRingingState(s: string): boolean {
  return s === "ringing" || s === "incoming" || s === "connecting";
}

export function useOmnichannelNotifier(): UseOmnichannelNotifierResult {
  const contacts = useAllActiveContacts();
  const { focusedContactId } = useContactFocus();
  const [unreadCount, setUnreadCount] = useState<Record<string, number>>({});
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  // Track which contacts we've already announced (to avoid re-firing on
  // every snapshot — state hops are noisy).
  const announcedRef = useRef<Set<string>>(new Set());
  // Track which streams controllers we've already wired onMessage on
  // (so re-mounting AgentDesktopPage doesn't stack listeners).
  const wiredRef = useRef<Set<string>>(new Set());

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "denied" as const;
    if (Notification.permission !== "default") return Notification.permission;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  // Lazy permission request — on the first relevant event we ask.
  const ensurePermission = useCallback(async () => {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const r = await Notification.requestPermission();
    setPermission(r);
    return r === "granted";
  }, []);

  // ─── 1) Detect new incoming contacts ────────────────────────────
  useEffect(() => {
    for (const c of contacts) {
      const key = `${c.contactId}:${c.state}`;
      if (announcedRef.current.has(key)) continue;
      // Only fire on the INITIAL ringing/incoming transition. We mark
      // every state we've seen so we never re-announce.
      announcedRef.current.add(key);
      if (!isRingingState(c.state)) continue;

      // Don't re-announce a contact we've already seen at all (e.g. the
      // ring state flipped from ringing → connecting → ringing in a beat).
      const wasAnnouncedAlready = Array.from(announcedRef.current).some(
        (k) => k !== key && k.startsWith(`${c.contactId}:`),
      );
      // Note: the .add above adds the new key BEFORE we check, so we
      // expect at minimum the just-added entry. The "already announced"
      // guard checks if there's a DIFFERENT entry, meaning a prior state.
      // For first sighting that other entry doesn't exist; for re-rings
      // it does.
      if (wasAnnouncedAlready) continue;

      playDing("incoming");
      ensurePermission().then((ok) => {
        if (!ok) return;
        try {
          const title = NEW_CONTACT_TITLE[c.channel?.toUpperCase() || ""] || "Nuevo contacto";
          const notif = new Notification(title, {
            body: newContactBody(c),
            tag: `contact-${c.contactId}`,
            icon: "/icon-192.png",
          });
          notif.onclick = () => {
            window.focus();
            notif.close();
          };
        } catch {
          /* ignore */
        }
      });
    }
  }, [contacts, ensurePermission]);

  // ─── 2) Subscribe to message events for ALL active chat contacts ──
  // We wire onMessage on every streams chat controller exactly once.
  // Each new customer message bumps the unread count for that contact
  // (unless it's the focused one). It also fires a browser notification
  // and plays the "message" ding.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (window as unknown as { connect?: any }).connect;
    if (!c?.agent) return;
    let agent: { getContacts?: () => unknown[] } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent = new (c as any).Agent();
    } catch {
      return;
    }
    const wired = wiredRef.current;
    const liveIds = new Set(contacts.map((x) => x.contactId));

    // Wire any new chat contact we haven't wired yet
    for (const contact of contacts) {
      if (wired.has(contact.contactId)) continue;
      if ((contact.channel || "").toUpperCase() !== "CHAT") continue;
      const streamsContact = (agent?.getContacts?.() || []).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (x: any) => x.getContactId?.() === contact.contactId,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chatSession = (streamsContact as any)?.getAgentConnection?.()?.getMediaController?.();
      if (!chatSession) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chatSession.onMessage?.((event: any) => {
          const data = event?.data ?? event;
          const role = data?.ParticipantRole || data?.participantRole;
          const type = data?.Type || data?.type;
          if (type !== "MESSAGE" && type !== "ATTACHMENT") return;
          if (role !== "CUSTOMER") return;
          // Bump unread iff the contact ISN'T currently focused.
          // We read focusedContactId via the closure-captured ref so this
          // listener stays correct as the focus changes.
          // We don't reset to zero here — that happens in the focus effect.

          const focus = (focusRef as React.MutableRefObject<string | null>).current;
          if (focus === contact.contactId) return;
          setUnreadCount((prev) => ({
            ...prev,
            [contact.contactId]: (prev[contact.contactId] || 0) + 1,
          }));
          playDing("message");
          ensurePermission().then((ok) => {
            if (!ok) return;
            try {
              const isWA = contact.attributes?.udep_source === "whatsapp";
              const title = isWA ? "💚 WhatsApp · nuevo mensaje" : "💬 Chat · nuevo mensaje";
              const body =
                (typeof data.Content === "string" && data.Content) ||
                contact.customerPhone ||
                "Mensaje del cliente";
              const notif = new Notification(title, {
                body,
                tag: `msg-${contact.contactId}`,
                icon: "/icon-192.png",
              });
              notif.onclick = () => {
                window.focus();
                // Re-focus this contact via the focus hook. We can't call
                // the hook here so we dispatch a synthetic event the
                // ActiveContactsTabStrip listens for.
                window.dispatchEvent(
                  new CustomEvent("vox:focus-contact", {
                    detail: { contactId: contact.contactId },
                  }),
                );
                notif.close();
              };
            } catch {
              /* ignore */
            }
          });
        });
        wired.add(contact.contactId);
      } catch {
        /* controller maybe not ready yet — try again next snapshot */
      }
    }

    // Garbage-collect wired entries for contacts that disappeared
    for (const wid of Array.from(wired)) {
      if (!liveIds.has(wid)) {
        wired.delete(wid);
        setUnreadCount((prev) => {
          if (!(wid in prev)) return prev;
          const next = { ...prev };
          delete next[wid];
          return next;
        });
      }
    }
  }, [contacts, ensurePermission]);

  // ─── 3) Reset unread when a contact becomes focused ──────────────
  // Also keep a ref of the focused id so the message listeners (which
  // capture the closure at wire time) can read the latest value.
  const focusRef = useRef<string | null>(null);
  useEffect(() => {
    focusRef.current = focusedContactId;
    if (!focusedContactId) return;
    setUnreadCount((prev) => {
      if (!(focusedContactId in prev)) return prev;
      const next = { ...prev };
      delete next[focusedContactId];
      return next;
    });
  }, [focusedContactId]);

  return { unreadCount, permission, requestPermission };
}
