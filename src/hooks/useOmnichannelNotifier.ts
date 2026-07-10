import { useEffect, useRef, useCallback, useState, useMemo } from "react";
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

  // Track which contacts we've YA anunciado. Antes la clave era
  // `contactId:state` y el Set crecía sin tope + hacíamos un `.some()` O(n)
  // por cada snapshot. Ahora trackeamos por `contactId` a secas (anunciamos
  // UNA vez por contacto, en su primer sighting en ring) y limpiamos los
  // contactos que ya no están vivos, así el Set no leakea.
  const announcedRef = useRef<Set<string>>(new Set());
  // Track which streams controllers we've already wired onMessage on
  // (so re-mounting AgentDesktopPage doesn't stack listeners).
  const wiredRef = useRef<Set<string>>(new Set());
  // Ref del id enfocado — lo leen los listeners de mensajes (que capturan el
  // closure al momento de cablear) para conocer SIEMPRE el valor más reciente.
  // Declarado Aquí, antes de los efectos que lo usan (antes vivía al final del
  // hook y el efecto de mensajes lo referenciaba por TDZ/orden frágil).
  const focusRef = useRef<string | null>(null);
  // Ref con el último array de contactos. El efecto de suscripción NO depende
  // de `contacts` (cambia ~cada 1s); lee la lista viva desde aquí para resolver
  // atributos/teléfono del contacto que está cableando, sin recablear todo.
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  // Clave ESTABLE del CONJUNTO de contactos de chat (ids ordenados). El efecto
  // de suscripción depende de esto en vez de `contacts`, así solo re-corre
  // cuando entra/sale un chat — no en cada snapshot (~1s) con dings/badges
  // duplicados. Los ya cableados se saltan por `wiredRef`.
  const chatIdsKey = useMemo(
    () =>
      contacts
        .filter((c) => (c.channel || "").toUpperCase() === "CHAT")
        .map((c) => c.contactId)
        .sort()
        .join(","),
    [contacts],
  );

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
    const liveIds = new Set(contacts.map((c) => c.contactId));
    for (const c of contacts) {
      // Solo disparamos en la transición INICIAL a ringing/incoming, y UNA
      // vez por contacto (clave = contactId, no contactId:state). Si el
      // contacto ya fue anunciado, lo saltamos aunque el estado rebote
      // (ringing → connecting → ringing en un instante).
      if (!isRingingState(c.state)) continue;
      if (announcedRef.current.has(c.contactId)) continue;
      announcedRef.current.add(c.contactId);

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
    // Limpiá los contactos que ya no están vivos para que el Set no crezca
    // sin tope a lo largo de una sesión larga (evita el leak de HOOK-M2).
    for (const id of Array.from(announcedRef.current)) {
      if (!liveIds.has(id)) announcedRef.current.delete(id);
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

    const wired = wiredRef.current;

    // Cablea onMessage en cada controlador de chat AÚN NO cableado. Lee la
    // lista VIVA desde contactsRef (no de la dep del efecto) y se salta los ya
    // cableados por `wired`, así nunca duplica listeners aunque re-corra.
    // Devuelve true si quedó algún chat sin cablear (controlador no listo).
    const wirePending = (): boolean => {
      let agent: { getContacts?: () => unknown[] } | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        agent = new (c as any).Agent();
      } catch {
        return false;
      }
      const live = contactsRef.current;
      let pending = false;
      for (const contact of live) {
        if (wired.has(contact.contactId)) continue;
        if ((contact.channel || "").toUpperCase() !== "CHAT") continue;
        const streamsContact = (agent?.getContacts?.() || []).find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (x: any) => x.getContactId?.() === contact.contactId,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chatSession = (streamsContact as any)?.getAgentConnection?.()?.getMediaController?.();
        if (!chatSession) {
          // Controlador todavía no listo — reintentamos en breve.
          pending = true;
          continue;
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          chatSession.onMessage?.((event: any) => {
            const data = event?.data ?? event;
            const role = data?.ParticipantRole || data?.participantRole;
            const type = data?.Type || data?.type;
            if (type !== "MESSAGE" && type !== "ATTACHMENT") return;
            if (role !== "CUSTOMER") return;
            // Sumamos no-leído SOLO si el contacto NO está enfocado. Leemos el
            // id enfocado vía focusRef (no del closure) para seguir correctos
            // cuando cambia el foco. El reset a 0 pasa en el efecto de foco.
            if (focusRef.current === contact.contactId) return;
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
                  // Re-enfoca este contacto vía el hook de foco. No podemos
                  // llamar el hook aquí, así que despachamos un evento sintético
                  // que escucha ActiveContactsTabStrip.
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
          /* controlador quizá no listo — reintentar */
          pending = true;
        }
      }
      return pending;
    };

    // Primer intento inmediato + reintentos ACOTADOS mientras algún chat siga
    // sin controlador listo. Como el efecto ya no depende de `contacts`, estos
    // reintentos reemplazan al viejo "re-corre cada snapshot" para no perder el
    // cableado de un chat cuyo media controller tarda en aparecer.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let attempts = 0;
    const attempt = () => {
      const pending = wirePending();
      if (pending && attempts < 8) {
        attempts += 1;
        timers.push(setTimeout(attempt, 1000));
      }
    };
    attempt();

    // Garbage-collect wired entries for contacts that disappeared
    const liveIds = new Set(contactsRef.current.map((x) => x.contactId));
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

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [chatIdsKey, ensurePermission]);

  // ─── 3) Reset unread when a contact becomes focused ──────────────
  // Mantiene focusRef (declarado arriba) con el id enfocado más reciente para
  // que los listeners de mensajes —que capturan el closure al cablear— lean
  // siempre el valor actual.
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
