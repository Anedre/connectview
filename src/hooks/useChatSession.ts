import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useChatSession — wires amazon-connect-chatjs to the agent's current chat
 * contact and exposes a Redux-light state of messages + a sendMessage
 * action.
 *
 * The chat media controller is acquired from `contact.getAgentConnection()
 * .getMediaController()` (which chatjs adds onto streams when imported).
 *
 * We keep this minimal — message thread, typing indicator, send. Things
 * like attachments / quick-replies can be layered on later.
 */

export interface ChatMessage {
  id: string;
  participantRole: "AGENT" | "CUSTOMER" | "SYSTEM";
  /** "text/plain" or "application/vnd.amazonaws.connect.message.interactive*" etc. */
  contentType: string;
  content: string;
  /** ISO timestamp (ms accuracy if available). */
  timestamp: string;
}

interface UseChatSessionState {
  messages: ChatMessage[];
  /** "connected" when the chat is live. "connecting" while we wire up.
   *  "idle" when no chat contact is active. "ended" after disconnect. */
  status: "idle" | "connecting" | "connected" | "ended";
  customerTyping: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMessage(raw: any): ChatMessage | null {
  // chatjs onMessage / GetTranscript items follow the Amazon Connect
  // Participant API shape. The Type field disambiguates real text
  // messages from system events (typing, joined, left, connection ack,
  // chat ended, transfer, …) — without filtering, every event would
  // get appended to the thread and the UI would feel like it's
  // "refreshing every few seconds".
  const item = raw?.data ?? raw;
  if (!item) return null;

  const type = String(item.Type || item.type || "").toUpperCase();
  const contentType = String(item.ContentType || item.contentType || "text/plain");

  // Only accept real chat messages and attachments. Drop everything else
  // (Connect heartbeats, typing pings, participant joined/left, message
  // receipts, chat ended events).
  const isRealMessage =
    type === "MESSAGE" ||
    type === "ATTACHMENT" ||
    // Some chatjs versions don't set Type — fall back to ContentType.
    (!type && (
      contentType.startsWith("text/") ||
      contentType.startsWith("application/vnd.amazonaws.connect.message")
    ));
  if (!isRealMessage) return null;

  const id = item.Id || item.id;
  // No ID → either a synthetic event we can't dedupe, or a bug. Skip it
  // rather than risk an infinite-grow loop in the messages array.
  if (!id) return null;

  const participantRole = String(item.ParticipantRole || item.participantRole || "SYSTEM").toUpperCase();
  let content = item.Content || item.content || "";

  // If the message is interactive (button response from WhatsApp), the
  // Content is JSON describing the user's selection. Surface a readable
  // form so it shows nicely in the thread.
  if (contentType.includes("interactive") && content) {
    try {
      const parsed = typeof content === "string" ? JSON.parse(content) : content;
      const reply = parsed?.data?.content?.title || parsed?.data?.content?.[0]?.title;
      if (reply) content = reply;
    } catch {
      /* leave raw JSON */
    }
  }

  // Skip empty messages (would render as blank bubbles).
  if (!String(content).trim()) return null;

  const timestamp = item.AbsoluteTime || item.absoluteTime || new Date().toISOString();
  return {
    id,
    participantRole: participantRole === "AGENT" ? "AGENT" : participantRole === "CUSTOMER" ? "CUSTOMER" : "SYSTEM",
    contentType,
    content,
    timestamp,
  };
}

export function useChatSession(contactId: string | null | undefined, channel: string | null | undefined) {
  const [state, setState] = useState<UseChatSessionState>({
    messages: [],
    status: "idle",
    customerTyping: false,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controllerRef = useRef<any>(null);
  // Track the current typing-clear timeout so successive typing events
  // collapse into a single 4-second window instead of stacking up.
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which contactId we've already wired controller subscriptions
  // for. Chat controller listeners (onMessage/onTyping/onEnded) stack on
  // every registration — without this guard a single re-mount or repeated
  // effect run would produce 2× / 3× / N× setState per incoming message,
  // which is exactly what manifests as the chat "flickering" in the UI.
  const subscribedContactIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Streams' getType() returns lowercase ("chat"); other code paths
    // sometimes uppercase it. Normalise so both comparisons succeed.
    const channelNorm = (channel || "").toUpperCase();
    if (!contactId || channelNorm !== "CHAT") {
      setState({ messages: [], status: "idle", customerTyping: false });
      controllerRef.current = null;
      subscribedContactIdRef.current = null;
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, status: "connecting" }));

    // Find the live streams contact by ID and grab its agent connection.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findContact = (): any | null => {
      try {
        if (typeof connect === "undefined") return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agent = new (connect as any).Agent();
        const contacts = agent.getContacts?.() || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return contacts.find((c: any) => c.getContactId?.() === contactId) || null;
      } catch {
        return null;
      }
    };

    let attempts = 0;
    const MAX_ATTEMPTS = 32; // ~8 seconds total (32 * 250ms)
    const wireUp = async () => {
      while (!cancelled && attempts < MAX_ATTEMPTS) {
        const contact = findContact();
        if (!contact) {
          attempts += 1;
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        try {
          const agentConn = contact.getAgentConnection();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const controller: any = await agentConn.getMediaController();
          if (cancelled) return;
          controllerRef.current = controller;

          // Guard: never register subscribers twice for the same contact.
          // chatjs stacks listeners, and duplicates manifest as a flicker
          // (multiple setState calls per incoming message).
          if (subscribedContactIdRef.current === contactId) {
            // Already wired for this contact — just refresh the historical
            // transcript so we don't miss anything if the controller was
            // re-created underneath us. Skip subscribing again.
            try {
              const tx = await controller.getTranscript?.({
                maxResults: 50,
                scanDirection: "BACKWARD",
                sortOrder: "ASCENDING",
              });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const items = tx?.data?.Transcript || tx?.Transcript || [];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const msgs = items
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((it: any) => extractMessage({ data: it }))
                .filter(Boolean) as ChatMessage[];
              setState((s) => {
                const seen = new Set(s.messages.map((m) => m.id));
                const fresh = msgs.filter((m) => !seen.has(m.id));
                if (fresh.length === 0 && s.status === "connected") return s;
                return { ...s, status: "connected", messages: [...s.messages, ...fresh] };
              });
            } catch {
              setState((s) => (s.status === "connected" ? s : { ...s, status: "connected" }));
            }
            return;
          }
          subscribedContactIdRef.current = contactId;

          controller.onMessage?.((event: unknown) => {
            const msg = extractMessage(event);
            if (!msg) return;
            setState((s) => {
              // 1) dedupe on exact Id (most common — same message replayed
              //    by GetTranscript + WebSocket)
              if (s.messages.some((m) => m.id === msg.id)) return s;
              // 2) replace the local echo we may have added optimistically
              //    when the agent sent the message — match by role +
              //    content within a 30-second window.
              if (msg.participantRole === "AGENT") {
                const since = Date.now() - 30_000;
                const echoIdx = s.messages.findIndex((m) => {
                  if (!m.id.startsWith("local-")) return false;
                  if (m.participantRole !== "AGENT") return false;
                  if (m.content !== msg.content) return false;
                  const t = Date.parse(m.timestamp) || 0;
                  return t > since;
                });
                if (echoIdx >= 0) {
                  const next = s.messages.slice();
                  next[echoIdx] = msg;
                  return { ...s, messages: next };
                }
              }
              return { ...s, messages: [...s.messages, msg] };
            });
          });
          controller.onTyping?.((event: unknown) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const item = (event as any)?.data ?? event;
            if (item?.ParticipantRole !== "CUSTOMER") return;
            setState((s) => (s.customerTyping ? s : { ...s, customerTyping: true }));
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(() => {
              setState((s) => ({ ...s, customerTyping: false }));
              typingTimerRef.current = null;
            }, 4000);
          });
          controller.onEnded?.(() => {
            setState((s) => ({ ...s, status: "ended" }));
          });

          // Hydrate historical messages so the agent sees what the
          // customer wrote before they accepted the chat.
          try {
            const tx = await controller.getTranscript?.({
              maxResults: 50,
              scanDirection: "BACKWARD",
              sortOrder: "ASCENDING",
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = tx?.data?.Transcript || tx?.Transcript || [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const msgs = items
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((it: any) => extractMessage({ data: it }))
              .filter(Boolean) as ChatMessage[];
            setState((s) => {
              const seen = new Set(s.messages.map((m) => m.id));
              const fresh = msgs.filter((m) => !seen.has(m.id));
              return { ...s, status: "connected", messages: [...s.messages, ...fresh] };
            });
          } catch {
            setState((s) => ({ ...s, status: "connected" }));
          }
          return;
        } catch {
          attempts += 1;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      // Ran out of retries — the contact is probably stale in the
      // Streams snapshot (e.g. server-side stop-contact happened but the
      // agent's local view didn't catch up). Surface this as "ended" so
      // the panel can show an actionable state instead of spinning.
      if (!cancelled && !controllerRef.current) {
        setState((s) => (s.status === "ended" ? s : { ...s, status: "ended" }));
      }
    };
    wireUp();

    return () => {
      cancelled = true;
      controllerRef.current = null;
      // Note: we intentionally don't reset subscribedContactIdRef here.
      // If the SAME contactId remounts (StrictMode double-mount in dev,
      // or transient activeContact null↔non-null oscillations from
      // useActiveContact's polling), the guard keeps us from re-subscribing
      // to chatjs events — which would otherwise stack listeners and
      // produce the 5×/10×/N× setState-per-message flicker. The guard is
      // cleared only when contactId actually changes (the idle branch
      // above handles null; effect re-run with a new id falls through to
      // the !== check and resets after subscribing to the new contact).
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [contactId, channel]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !controllerRef.current) return;
    try {
      await controllerRef.current.sendMessage({
        contentType: "text/plain",
        message: text,
      });
      // Echo locally — Connect doesn't always replay our own message.
      setState((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: `local-${Date.now()}`,
            participantRole: "AGENT",
            contentType: "text/plain",
            content: text,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
    } catch (e) {
      console.warn("sendMessage failed", e);
    }
  }, []);

  const sendTyping = useCallback(() => {
    try {
      controllerRef.current?.sendEvent?.({
        contentType: "application/vnd.amazonaws.connect.event.typing",
      });
    } catch {
      /* noop */
    }
  }, []);

  /**
   * Upload a file via chatjs' sendAttachment. Connect's limits (as of
   * 2025-Q1): 20 MB max, mime-allowlist excludes executables. We bubble
   * the SDK error message up so the UI can show a toast.
   */
  const sendAttachment = useCallback(async (file: File) => {
    if (!controllerRef.current) {
      throw new Error("Chat no conectado");
    }
    // Soft size guard so a 200MB drop doesn't even hit the API.
    const MAX_BYTES = 20 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      throw new Error("El archivo supera 20 MB (límite de Connect)");
    }
    try {
      await controllerRef.current.sendAttachment({ attachment: file });
      // Optimistic local echo so the agent immediately sees their upload
      // — the websocket replay will dedupe on the real attachment Id.
      setState((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: `local-att-${Date.now()}`,
            participantRole: "AGENT",
            contentType: file.type || "application/octet-stream",
            content: `📎 ${file.name}`,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
    } catch (e) {
      // chatjs surfaces { errorMessage, statusCode } on rejection — pick
      // the most useful field to show the user.
      const err = e as { errorMessage?: string; message?: string };
      throw new Error(
        err.errorMessage || err.message || "No se pudo enviar el adjunto"
      );
    }
  }, []);

  return {
    messages: state.messages,
    status: state.status,
    customerTyping: state.customerTyping,
    sendMessage,
    sendTyping,
    sendAttachment,
  };
}
