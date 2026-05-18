import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  hangup: () => void;
  accept: () => void;
  reject: () => void;
  toggleRecording: () => void;
  changeAgentState: (state: ConnectAgentState) => void;
  /** Push key/value attributes onto the currently-attached contact (sent
   *  via streams `contact.addAttributes` so they land on the CTR). */
  setContactAttributes: (attrs: Record<string, string>) => void;
  /** Place an outbound call to a phone number. Returns a promise that
   *  resolves once Streams accepts the request (the call itself is
   *  asynchronous — listen on the contact subscription for state). */
  placeCall: (phoneNumber: string) => Promise<void>;
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
  const currentContact = useCallback(() => {
    if (contactRef.current) return contactRef.current;
    const a = agentRef.current;
    if (!a) return null;
    try {
      const list = a.getContacts?.() ?? [];
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
  }, [attachToContact]);

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

  const hangup = useCallback(() => {
    const c = currentContact();
    if (!c) return;
    try {
      const conn = c.getActiveInitialConnection?.() || c.getInitialConnection?.();
      conn?.destroy?.();
    } catch {
      /* noop */
    }
  }, [currentContact]);

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

  const accept = useCallback(() => {
    const c = currentContact();
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
  }, [currentContact, stopRingtone]);

  const reject = useCallback(() => {
    const c = currentContact();
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
  }, [currentContact, stopRingtone]);

  const toggleRecording = useCallback(() => {
    setRecording((r) => !r);
  }, []);

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

  const value: CCPContextValue = {
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
  };

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
      placeCall: async () => {},
    };
  }
  return ctx;
}
