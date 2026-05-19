import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentState } from "@/types/connect";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ConnectAgentState {
  name: string;
  type: string;
  agentStateARN?: string;
}

interface CCPContextValue {
  agentState: AgentState;
  agentName: string;
  availableStates: ConnectAgentState[];
  isInitialized: boolean;
  error: string | null;
  muted: boolean;
  onHold: boolean;
  recording: boolean;
  mute: (next?: boolean) => void;
  toggleHold: (next?: boolean) => void;
  /** Hang up / end the specified contact. When `contactId` is omitted,
   *  operates on whichever contact Streams considers the agent's
   *  current one (legacy single-contact behaviour). */
  hangup: (contactId?: string) => void;
  /** Accept the specified contact. Pass `contactId` explicitly when
   *  multiple contacts may be ringing — otherwise the first ringing
   *  one in Streams' list wins. */
  accept: (contactId?: string) => void;
  /** Reject the specified contact. See `accept` for the contactId rules. */
  reject: (contactId?: string) => void;
  /** Toggle the local "Grabando" indicator AND (if possible) tell
   *  Streams to suspend/resume the actual recording on the live
   *  contact via `contact.suspendRecording()` / `resumeRecording()`.
   *  Falls back to local-only toggle if the Streams API is not
   *  available on the contact (e.g. non-voice or stale snapshot). */
  toggleRecording: () => void;
  changeAgentState: (state: ConnectAgentState) => void;
  /** Send DTMF digits on the currently active voice contact. The
   *  string can contain 0-9, *, #. Sends them sequentially with the
   *  default inter-digit delay. */
  sendDigits: (digits: string) => void;
  /** Transfer the focused (or specified) contact to a queue. Uses
   *  Streams' `contact.addConnection` with a queue endpoint and then
   *  drops the agent leg so the contact ends up routed to the queue
   *  via the configured outbound flow. */
  transferToQueue: (
    queueArn: string,
    contactId?: string
  ) => Promise<void>;
  /** Push key/value attributes onto the currently-attached contact (sent
   *  via streams `contact.addAttributes` so they land on the CTR). */
  setContactAttributes: (attrs: Record<string, string>) => void;
  /** Place an outbound call to a phone number. Returns a promise that
   *  resolves once Streams accepts the request (the call itself is
   *  asynchronous — listen on the contact subscription for state). */
  placeCall: (phoneNumber: string) => Promise<void>;
  /** Fetch the list of "quick connects" available to the agent — these
   *  are the destinations the Connect admin pre-configured (queues,
   *  agents, phone numbers) and appear in the CCP's Quick connects
   *  menu. Returns Streams endpoint snapshots (`name`, `type`,
   *  `endpointARN`, etc). */
  getQuickConnects: () => Promise<QuickConnectEntry[]>;
  /** Place an outbound contact against a Streams Endpoint snapshot —
   *  the one you'd get back from `getQuickConnects()`. Wraps
   *  `agent.connect(endpoint)`. */
  connectToEndpoint: (endpoint: unknown) => Promise<void>;
}

/** Minimal projection of a Streams endpoint used by the Quick Connects
 *  UI. We keep the raw streams object on `_raw` so the connect call
 *  doesn't have to reconstruct it. */
export interface QuickConnectEntry {
  name: string;
  type: string;
  endpointARN?: string;
  phoneNumber?: string;
  queue?: string;
  _raw: unknown;
}

const CCPContext = createContext<CCPContextValue | null>(null);

/**
 * CCPProvider — single subscription point for amazon-connect-streams agent
 * + contact lifecycle. Mounted once at the app shell so every component that
 * needs to read or drive the softphone shares the same refs and state.
 *
 * Replaces the per-component `useCCP()` hook that previously re-subscribed
 * 3× (sidebar, topbar, agent desktop) and had its own `contactRef` — which
 * left buttons inert when the contact arrived before the page mounted.
 */
export function CCPProvider({ children }: { children: ReactNode }) {
  const [agentState, setAgentState] = useState<AgentState>("Init");
  const [agentName, setAgentName] = useState("");
  const [availableStates, setAvailableStates] = useState<ConnectAgentState[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [recording, setRecording] = useState(true);
  const agentRef = useRef<any>(null);
  const contactRef = useRef<any>(null);

  const attachToContact = useCallback((contact: any) => {
    if (!contact) return;
    contactRef.current = contact;
    const refreshHold = () => {
      try {
        const activeConn = contact.getActiveInitialConnection?.();
        const hold = activeConn?.isOnHold?.();
        if (typeof hold === "boolean") setOnHold(hold);
      } catch {
        /* noop */
      }
    };
    refreshHold();
    try { contact.onConnecting?.(refreshHold); } catch { /* noop */ }
    try { contact.onAccepted?.(refreshHold); } catch { /* noop */ }
    try { contact.onConnected?.(refreshHold); } catch { /* noop */ }
    try { contact.onRefresh?.(refreshHold); } catch { /* noop */ }
    try { contact.onACW?.(refreshHold); } catch { /* noop */ }
    try {
      contact.onEnded?.(() => {
        if (contactRef.current === contact) {
          contactRef.current = null;
          setOnHold(false);
          setMuted(false);
        }
      });
    } catch {
      /* noop */
    }
    try {
      contact.onDestroy?.(() => {
        if (contactRef.current === contact) {
          contactRef.current = null;
        }
      });
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (typeof (globalThis as any).connect === "undefined") return;
    const conn = (globalThis as any).connect;

    // CRITICAL: chatjs defaults to us-west-2 for the Connect Participant API,
    // even after `setGlobalConfig({region})`. Streams internally calls
    // ChatSession.create() WITHOUT a region option, and the streams build we
    // have packaged doesn't pass our setGlobalConfig through. Our instance is
    // in us-east-1, so the participant token is region-scoped to us-east-1
    // and every chatjs API call lands a 403.
    //
    // Brute-force fix: monkey-patch ChatSession.create to inject region
    // explicitly into every session that's spun up. Retry until ChatSession
    // is registered on the global (Streams loads chatjs lazily).
    const CONNECT_REGION = import.meta.env.VITE_AWS_REGION || "us-east-1";
    const applyChatJsRegion = () => {
      const CS = conn.ChatSession;
      if (!CS) return false;
      try {
        if (CS.setGlobalConfig) {
          CS.setGlobalConfig({
            region: CONNECT_REGION,
            loggerConfig: {
              useDefaultLogger: true,
              level: CS.LogLevel?.INFO ?? "INFO",
            },
          });
        }
        // Wrap .create so the region option is always injected, regardless
        // of how the caller (Streams internals) invokes it.
        if (CS.create && !CS.__voxRegionPatched) {
          const original = CS.create.bind(CS);
          CS.create = (input: any) => {
            const patched = {
              ...(input || {}),
              options: {
                region: CONNECT_REGION,
                ...((input && input.options) || {}),
              },
            };
            return original(patched);
          };
          CS.__voxRegionPatched = true;
        }
        return true;
      } catch {
        return false;
      }
    };
    applyChatJsRegion();
    const chatRegionPoller = setInterval(() => {
      if (applyChatJsRegion()) {
        clearInterval(chatRegionPoller);
      }
    }, 250);
    setTimeout(() => clearInterval(chatRegionPoller), 30_000);

    try {
      conn.agent((agent: any) => {
        agentRef.current = agent;
        setAgentName(agent.getName());
        setIsInitialized(true);

        const currentState = agent.getState();
        setAgentState(currentState.name as AgentState);

        try {
          const states = agent.getAgentStates?.() ?? [];
          setAvailableStates(
            states.map((s: any) => ({
              name: s.name,
              type: s.type,
              agentStateARN: s.agentStateARN,
            }))
          );
        } catch {
          /* noop */
        }

        agent.onStateChange((stateChange: any) => {
          setAgentState(stateChange.newState as AgentState);
        });
        agent.onMuteToggle?.(({ muted: m }: { muted: boolean }) => setMuted(m));
        agent.onError(() => {
          setError("Agent connection error");
          setAgentState("Error");
        });

        // Attach to ANY contact already on the agent (the global
        // `connect.contact()` subscription only fires for *new* contacts,
        // so without this the softphone buttons stay inert if the call
        // arrived before this provider mounted).
        try {
          const existing = agent.getContacts?.() ?? [];
          for (const c of existing) {
            attachToContact(c);
          }
        } catch {
          /* noop */
        }
      });

      conn.contact?.((contact: any) => {
        attachToContact(contact);
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to subscribe to agent"
      );
    }
  }, [attachToContact]);

  // Helper: pick the live contact even if the ref slipped — try the
  // refs first, then re-query the agent. Critical for buttons to work
  // reliably across re-mounts.
  //
  // When `targetId` is provided we look up *that specific contact* —
  // used by the multi-contact tab strip so accept/reject/hangup hit
  // the right one even when the agent has several contacts going at
  // once. When omitted we fall back to "any live contact" which is the
  // single-contact behaviour the rest of the app depended on before.
  const currentContact = useCallback(
    (targetId?: string) => {
      const a = agentRef.current;
      if (targetId && a) {
        try {
          const list = a.getContacts?.() ?? [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = list.find(
            (c: any) => c.getContactId?.() === targetId
          );
          if (target) {
            attachToContact(target);
            return target;
          }
        } catch {
          /* noop — fall through to the legacy path */
        }
      }
      if (contactRef.current) return contactRef.current;
      if (!a) return null;
      try {
        const list = a.getContacts?.() ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const live = list.find((c: any) => {
          const st = c.getState?.()?.type;
          return st && st !== "ended" && st !== "destroyed";
        });
        if (live) {
          attachToContact(live);
          return live;
        }
      } catch {
        /* noop */
      }
      return null;
    },
    [attachToContact]
  );

  const mute = useCallback(
    (next?: boolean) => {
      const a = agentRef.current;
      if (!a) return;
      const target = typeof next === "boolean" ? next : !muted;
      try {
        if (target) a.mute?.();
        else a.unmute?.();
        setMuted(target);
      } catch {
        /* noop */
      }
    },
    [muted]
  );

  const toggleHold = useCallback(
    (next?: boolean) => {
      const c = currentContact();
      if (!c) return;
      const target = typeof next === "boolean" ? next : !onHold;
      try {
        const activeConn = c.getActiveInitialConnection?.();
        if (!activeConn) return;
        if (target) activeConn.hold?.();
        else activeConn.resume?.();
        setOnHold(target);
      } catch {
        /* noop */
      }
    },
    [onHold, currentContact]
  );

  const hangup = useCallback(
    (contactId?: string) => {
      const c = currentContact(contactId);
      if (!c) return;
      try {
        const state = c.getState?.()?.type;
        // Missed / ended contacts don't have an active connection to
        // destroy — they're "post-conversation" from Streams' POV.
        // The right call is `contact.clear()` which releases the
        // contact from the agent's slot. This is what Connect's
        // native CCP "Close contact" button does for missed chats.
        if (state === "missed" || state === "ended") {
          c.clear?.({
            success: () => {
              /* noop */
            },
            failure: () => {
              /* noop — non-fatal */
            },
          });
          return;
        }
        const conn = c.getActiveInitialConnection?.() || c.getInitialConnection?.();
        conn?.destroy?.();
      } catch {
        /* noop */
      }
    },
    [currentContact]
  );

  // Streams plays the ringtone via a separate audio element managed by the
  // CCP iframe. accept()/reject() update the contact state but don't always
  // pause that audio in time — the agent then hears the ringtone keep
  // playing for several seconds after they've already taken the call.
  // We hard-mute every <audio>/<video> element on the page after the
  // action, then unmute non-ringtone elements so the actual softphone /
  // chat audio still works.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stopRingtone = useCallback(() => {
    try {
      // 1) Try the streams API path first — agent.mute() on the ringtone
      //    sub-system. The exact symbol differs across versions of streams.
      //    eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conn = (globalThis as any).connect;
      const core = conn?.core;
      // Stop currently-playing ringtone media if streams exposes it.
      try {
        core?.getRingtoneEngine?.()?.stopRingtone?.();
      } catch {
        /* noop */
      }
      try {
        core?.softphoneManager?.getRingtoneSelf?.()?.pause?.();
      } catch {
        /* noop */
      }
      // 2) Fallback: walk the DOM and pause every audio element. Ringtone
      //    elements have src containing "ringtone" or are inside the hidden
      //    ccp-container iframe. The active softphone audio elements have
      //    a srcObject (WebRTC stream) and no src URL — we leave those.
      const audios = Array.from(document.querySelectorAll("audio"));
      for (const a of audios) {
        const isWebRtcStream = !!a.srcObject;
        if (isWebRtcStream) continue; // active softphone audio — leave it
        try {
          a.pause();
          a.currentTime = 0;
        } catch {
          /* noop */
        }
      }
      // 3) Same for any audio elements inside the CCP iframe.
      const iframe = document.querySelector(
        "#ccp-container iframe"
      ) as HTMLIFrameElement | null;
      try {
        const idoc = iframe?.contentDocument;
        if (idoc) {
          const iAudios = Array.from(idoc.querySelectorAll("audio"));
          for (const a of iAudios) {
            if ((a as HTMLAudioElement).srcObject) continue;
            try {
              a.pause();
              (a as HTMLAudioElement).currentTime = 0;
            } catch {
              /* noop */
            }
          }
        }
      } catch {
        // Cross-origin — iframe contentDocument throws. Streams' internal
        // ringtone stop should have handled it above.
      }
    } catch {
      /* swallow */
    }
  }, []);

  const accept = useCallback(
    (contactId?: string) => {
      const c = currentContact(contactId);
      if (!c) return;
      try {
        c.accept?.({
          success: () => {
            // Belt-and-suspenders: kill the ringtone on success.
            stopRingtone();
          },
          failure: () => {
            /* noop */
          },
        });
      } catch {
        /* noop */
      }
      // Also stop immediately — don't wait for the streams round-trip. The
      // user's expectation is that the ringtone stops the moment they click
      // accept, not 1-2s later after the iframe acknowledges.
      stopRingtone();
    },
    [currentContact, stopRingtone]
  );

  const reject = useCallback(
    (contactId?: string) => {
      const c = currentContact(contactId);
      if (!c) return;
      try {
        c.reject?.({
          success: () => stopRingtone(),
          failure: () => {
            /* noop */
          },
        });
      } catch {
        /* noop */
      }
      stopRingtone();
    },
    [currentContact, stopRingtone]
  );

  const toggleRecording = useCallback(() => {
    setRecording((r) => {
      const next = !r;
      // Best-effort: tell Streams to actually suspend/resume the
      // recording on the live contact. If the API isn't available
      // we fall back to a UI-only toggle (the original behaviour),
      // which at least makes the button feel responsive.
      try {
        const c = currentContact();
        if (c) {
          if (next) {
            // Resume — was previously paused.
            c.resumeRecording?.({
              success: () => {},
              failure: (err: unknown) => {
                console.warn("resumeRecording failed:", err);
              },
            });
          } else {
            c.suspendRecording?.({
              success: () => {},
              failure: (err: unknown) => {
                console.warn("suspendRecording failed:", err);
              },
            });
          }
        }
      } catch (err) {
        console.warn("toggleRecording Streams call threw:", err);
      }
      return next;
    });
  }, [currentContact]);

  /**
   * Send DTMF digits on the live voice contact. Useful when the agent
   * needs to interact with an IVR (e.g. press 1 for English) during a
   * transferred call. Each digit is sent sequentially via Streams'
   * `sendDigits` on the active connection.
   */
  const sendDigits = useCallback(
    (digits: string) => {
      const c = currentContact();
      if (!c) return;
      try {
        const conn =
          c.getActiveInitialConnection?.() || c.getInitialConnection?.();
        if (!conn) return;
        // Streams accepts the whole string at once — it handles the
        // per-digit pacing internally.
        conn.sendDigits?.(digits, {
          success: () => {},
          failure: (err: unknown) => {
            console.warn("sendDigits failed:", err);
          },
        });
      } catch (err) {
        console.warn("sendDigits threw:", err);
      }
    },
    [currentContact]
  );

  /**
   * Transfer the contact to a queue. We open a new connection to a
   * queue endpoint (`connect.Endpoint.byQueueARN`), then disconnect
   * the agent leg so the customer is left in the new queue. This is
   * the Streams idiom for blind queue transfers.
   */
  const transferToQueue = useCallback(
    async (queueArn: string, contactId?: string) => {
      return new Promise<void>((resolve, reject) => {
        const c = currentContact(contactId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conn = (globalThis as any).connect;
        if (!c || !conn?.Endpoint) {
          reject(new Error("Streams no listo"));
          return;
        }
        try {
          const endpoint = conn.Endpoint.byQueueARN(queueArn);
          c.addConnection?.(endpoint, {
            success: () => {
              // Drop the agent leg so the customer is fully transferred.
              const agentConn =
                c.getAgentConnection?.() || c.getActiveInitialConnection?.();
              try {
                agentConn?.destroy?.();
              } catch {
                /* noop */
              }
              resolve();
            },
            failure: (err: unknown) => {
              const msg =
                err instanceof Error
                  ? err.message
                  : typeof err === "string"
                  ? err
                  : "Transfer falló";
              reject(new Error(msg));
            },
          });
        } catch (err) {
          reject(
            err instanceof Error ? err : new Error("Transfer falló")
          );
        }
      });
    },
    [currentContact]
  );

  /**
   * Place an outbound call. Wraps the streams `agent.connect()` call —
   * the promise resolves when Streams accepts the request, which doesn't
   * mean the customer has answered. Listen on the contact subscription
   * for the call lifecycle (connecting → connected → ended).
   */
  const placeCall = useCallback(async (phoneNumber: string) => {
    const a = agentRef.current;
    const conn = (globalThis as any).connect;
    if (!a || !conn?.Endpoint) {
      throw new Error("Amazon Connect aún no está listo");
    }
    return new Promise<void>((resolve, reject) => {
      try {
        const endpoint = conn.Endpoint.byPhoneNumber(phoneNumber);
        a.connect(endpoint, {
          success: () => resolve(),
          failure: (err: any) => {
            const msg =
              err?.message ||
              (typeof err === "string" ? err : "No se pudo iniciar la llamada");
            setError(msg);
            reject(new Error(msg));
          },
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "No se pudo iniciar la llamada";
        setError(msg);
        reject(new Error(msg));
      }
    });
  }, []);

  /**
   * Fetch quick-connects available to this agent. Streams exposes them
   * per-queue via `agent.getEndpoints(queueARNs, cb)`, so we fan out
   * across all queues in the agent's routing profile and de-dupe by
   * `endpointARN` (the same quick connect can sit on multiple queues).
   *
   * Returns an empty list (not a thrown error) when the agent isn't
   * ready yet or has no quick connects configured — the caller renders
   * a clean empty state instead of an error banner.
   */
  const getQuickConnects = useCallback(async (): Promise<
    QuickConnectEntry[]
  > => {
    const a = agentRef.current;
    if (!a) return [];
    let queueArns: string[] = [];
    try {
      const queues = a.getRoutingProfile?.()?.queues ?? [];
      queueArns = queues
        .map((q: { queueARN?: string; queueId?: string }) => q.queueARN)
        .filter((arn: string | undefined): arn is string => !!arn);
    } catch {
      /* noop */
    }
    if (queueArns.length === 0) return [];
    return new Promise<QuickConnectEntry[]>((resolve) => {
      try {
        a.getEndpoints?.(queueArns, {
          success: (data: { endpoints?: unknown[] }) => {
            const endpoints = data?.endpoints ?? [];
            const seen = new Set<string>();
            const out: QuickConnectEntry[] = [];
            for (const ep of endpoints) {
              const e = ep as {
                name?: string;
                type?: string;
                endpointARN?: string;
                phoneNumber?: string;
                queue?: string;
              };
              const key = e.endpointARN || `${e.name}|${e.type}`;
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({
                name: e.name || "(sin nombre)",
                type: e.type || "phone_number",
                endpointARN: e.endpointARN,
                phoneNumber: e.phoneNumber,
                queue: e.queue,
                _raw: ep,
              });
            }
            // Sort: agents first, then queues, then phone numbers.
            const rank = (t: string) =>
              t === "agent" ? 0 : t === "queue" ? 1 : 2;
            out.sort((x, y) => {
              const r = rank(x.type) - rank(y.type);
              if (r !== 0) return r;
              return x.name.localeCompare(y.name);
            });
            resolve(out);
          },
          failure: () => resolve([]),
        });
      } catch {
        resolve([]);
      }
    });
  }, []);

  /**
   * Generic outbound connect against a Streams Endpoint snapshot (as
   * returned by `getQuickConnects`). Used by the Quick Connects menu —
   * the `_raw` field on each entry holds the original streams endpoint
   * object that `agent.connect` expects.
   */
  const connectToEndpoint = useCallback(
    async (endpoint: unknown) => {
      const a = agentRef.current;
      if (!a) throw new Error("Amazon Connect aún no está listo");
      return new Promise<void>((resolve, reject) => {
        try {
          a.connect(endpoint, {
            success: () => resolve(),
            failure: (err: unknown) => {
              const msg =
                err instanceof Error
                  ? err.message
                  : typeof err === "string"
                  ? err
                  : "No se pudo iniciar el contacto";
              setError(msg);
              reject(new Error(msg));
            },
          });
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : "No se pudo iniciar el contacto";
          setError(msg);
          reject(new Error(msg));
        }
      });
    },
    []
  );

  /**
   * Set contact attributes on the currently-attached contact. Used by the
   * wrap-up screen to persist disposition (stage / sub-stage / valoración)
   * + tags so they show up on the CTR + downstream analytics.
   */
  const setContactAttributes = useCallback(
    (attrs: Record<string, string>) => {
      const c = currentContact();
      if (!c) return;
      try {
        // streams contact.addAttributes accepts { [key]: value } and
        // returns a promise via success/failure callbacks.
        c.addAttributes?.(attrs, {
          success: () => {},
          failure: (err: any) => {
            setError(err?.message || "No se pudieron guardar los atributos");
          },
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "No se pudieron guardar los atributos"
        );
      }
    },
    [currentContact]
  );

  const changeAgentState = useCallback((state: ConnectAgentState) => {
    const a = agentRef.current;
    if (!a || !state) return;
    try {
      a.setState(state, {
        success: () => {
          setAgentState(state.name as AgentState);
        },
        failure: (err: any) => {
          setError(err?.message || "No se pudo cambiar el estado");
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado");
    }
  }, []);

  // Memoize the context value. Without this, every render of
  // CCPProvider (triggered by any of the state setters above —
  // onHold, muted, agentState, etc) produces a NEW object identity
  // and forces every consumer of `useCCP()` to re-render even when
  // none of the fields actually changed. That re-render cascade is a
  // big contributor to the parpadeo on the agent desktop.
  const value = useMemo<CCPContextValue>(
    () => ({
      agentState,
      agentName,
      availableStates,
      isInitialized,
      error,
      muted,
      onHold,
      recording,
      mute,
      toggleHold,
      hangup,
      accept,
      reject,
      toggleRecording,
      changeAgentState,
      setContactAttributes,
      placeCall,
      sendDigits,
      transferToQueue,
      getQuickConnects,
      connectToEndpoint,
    }),
    [
      agentState,
      agentName,
      availableStates,
      isInitialized,
      error,
      muted,
      onHold,
      recording,
      mute,
      toggleHold,
      hangup,
      accept,
      reject,
      toggleRecording,
      changeAgentState,
      setContactAttributes,
      placeCall,
      sendDigits,
      transferToQueue,
      getQuickConnects,
      connectToEndpoint,
    ]
  );

  return <CCPContext.Provider value={value}>{children}</CCPContext.Provider>;
}

export function useCCP(): CCPContextValue {
  const ctx = useContext(CCPContext);
  if (!ctx) {
    // Outside a provider — return inert defaults so the app still renders
    // (e.g. during login screen before the CCP iframe is ready).
    return {
      agentState: "Init",
      agentName: "",
      availableStates: [],
      isInitialized: false,
      error: null,
      muted: false,
      onHold: false,
      recording: true,
      mute: () => {},
      toggleHold: () => {},
      hangup: () => {},
      accept: () => {},
      reject: () => {},
      toggleRecording: () => {},
      changeAgentState: () => {},
      setContactAttributes: () => {},
      sendDigits: () => {},
      transferToQueue: async () => {},
      placeCall: async () => {},
      getQuickConnects: async () => [],
      connectToEndpoint: async () => {},
    };
  }
  return ctx;
}
