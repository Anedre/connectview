import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Mail, ClipboardList, Phone } from "lucide-react";
import { useCCP } from "@/hooks/useCCP";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { roleLabelOf } from "@/types/auth";
import { useActiveContact } from "@/hooks/useActiveContact";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { useMicLevels } from "@/hooks/useMicLevels";
import { useDebugRender, traceChange } from "@/lib/debugTrace";
import { getApiEndpoints } from "@/lib/api";
import { ActiveContactsTabStrip } from "@/components/workspace/ActiveContactsTabStrip";
import { OmnichannelNotifierProvider } from "@/context/OmnichannelNotifierContext";
import { MissedCallBanner } from "@/components/workspace/MissedCallBanner";
import { MissedHistoryDrawer } from "@/components/workspace/MissedHistoryDrawer";
import { CustomerProfilePanel } from "@/components/workspace/CustomerProfilePanel";
import { LiveTranscriptPanel } from "@/components/workspace/LiveTranscriptPanel";
import { ChatThreadPanel } from "@/components/workspace/ChatThreadPanel";
import { EmailThreadPanel } from "@/components/workspace/EmailThreadPanel";
import { MyCampaignLeadsPanel } from "@/components/workspace/MyCampaignLeadsPanel";
import { useMyCampaignLeads } from "@/hooks/useMyCampaignLeads";
import { AIAssistPanel } from "@/components/workspace/AIAssistPanel";
import { AICoachPanel } from "@/components/workspace/AICoachPanel";
import { DTMFKeypadModal } from "@/components/workspace/DTMFKeypadModal";
import { TransferQueueModal } from "@/components/workspace/TransferQueueModal";
import { Customer360MoreMenu } from "@/components/workspace/Customer360MoreMenu";
import { LiveSummaryModal } from "@/components/workspace/LiveSummaryModal";
import { QuickNoteModal } from "@/components/workspace/QuickNoteModal";
import { AgentIdleCockpit } from "@/components/workspace/AgentIdleCockpit";
import { MomentsPanel } from "@/components/workspace/MomentsPanel";
import { CustomerBrowser } from "@/components/workspace/CustomerBrowser";
import { WrapUpView } from "@/components/vox/WrapUpView";
import {
  Avatar,
  colorFromName,
} from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
// ARIA design-system primitives — used to re-skin the Agent Desktop content
// (pills, cards, buttons, KPIs) without touching the live softphone logic.
import { Av, Btn, Card, Pill, Icon as AIcon } from "@/components/aria";
import { AgentStatePill } from "@/components/vox/AgentStatePill";
import { ConferenceModal } from "@/components/workspace/ConferenceModal";
import { displayCustomerName } from "@/lib/customerName";
// Cockpit estilo handoff: MODO DEMO (data mock, self-contained) + CallBar
// horizontal reutilizado en el rediseño del estado EN-LLAMADA REAL.
import {
  AgentCockpitDemo,
  DEMO_STATES,
  type DemoState,
  CallBar as CockpitCallBar,
} from "@/components/workspace/aria-cockpit";

/** CSS color token for the channel-coded glow ring behind the caller
 *  avatar in the softphone hero. Each channel gets its own accent so
 *  the agent can read "what kind of contact this is" at a glance. */
function channelAccent(channel: string | null | undefined): string {
  const c = (channel || "VOICE").toUpperCase();
  if (c === "CHAT") return "var(--accent-cyan-soft)";
  if (c === "EMAIL") return "var(--accent-amber-soft)";
  if (c === "TASK") return "var(--accent-violet-soft)";
  return "var(--accent-green-soft)";
}
function channelAccentSolid(channel: string | null | undefined): string {
  const c = (channel || "VOICE").toUpperCase();
  if (c === "CHAT") return "var(--accent-cyan)";
  if (c === "EMAIL") return "var(--accent-amber)";
  if (c === "TASK") return "var(--accent-violet)";
  return "var(--accent-green)";
}

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * Isolated call-timer leaf. Holds its own per-second tick so the
 * parent doesn't re-render every second.
 *
 * In single-contact mode the elapsed counter is "ms since this leaf
 * mounted" — which was fine when the agent had ONE contact. In
 * multi-contact mode (voice + chat + email), switching the focused
 * tab re-mounts the leaf with a different `resetKey`, which made the
 * timer reset to 00:00 every time the agent switched away and back.
 *
 * Fix: when the parent passes a `startedAtMs` wall-clock anchor (e.g.
 * the streams contact's connection timestamp), compute elapsed from
 * that anchor — so the displayed time matches the REAL call duration
 * regardless of how many times the agent switched tabs.
 *
 * onTick still publishes the latest second so the wrap-up snapshot
 * can read it without subscribing.
 */
const CallTimerInner = ({
  active,
  resetKey,
  startedAtMs,
  onTickRef,
}: {
  active: boolean;
  resetKey: string;
  /** Wall-clock ms when the contact CONNECTED. If provided, elapsed
   *  is derived as `floor((now - startedAtMs) / 1000)` so switching
   *  tabs doesn't reset the displayed time. */
  startedAtMs?: number | null;
  onTickRef?: React.MutableRefObject<number>;
}) => {
  const [elapsed, setElapsed] = useState(() => {
    if (!active) return 0;
    if (startedAtMs && startedAtMs > 0) {
      return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    }
    return 0;
  });
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      if (onTickRef) onTickRef.current = 0;
      return;
    }
    const initial =
      startedAtMs && startedAtMs > 0
        ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
        : 0;
    setElapsed(initial);
    if (onTickRef) onTickRef.current = initial;
    const id = setInterval(() => {
      setElapsed(() => {
        const next =
          startedAtMs && startedAtMs > 0
            ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
            : 0;
        if (onTickRef) onTickRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey, startedAtMs, onTickRef]);
  return <>{active ? fmtElapsed(elapsed) : "--:--"}</>;
};
const CallTimer = memo(CallTimerInner);

function EmptyPanel({
  icon: IconCmp,
  title,
  body,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: 200,
        color: "var(--text-3)",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div>
        <IconCmp size={26} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--text-2)" }}>
          {title}
        </div>
        <div style={{ marginTop: 4, fontSize: 11.5 }}>{body}</div>
      </div>
    </div>
  );
}

/** Barra compacta superior para canales no-voz (WhatsApp / Email /
 *  Tarea) en el rediseño EN-LLAMADA. Espeja el `ChannelBar` de la
 *  "Vista demo" (mismas clases .card--pop / Av / Pill / Btn) pero
 *  cableada a los handlers REALES del softphone. El botón "Cerrar/
 *  Finalizar" dispara hangup(); "Transferir/Nota" abren los modales
 *  reales; "Llamar" (solo chat con teléfono) dispara placeCall(). */
function ChannelBarReal({
  channel,
  label,
  name,
  secondary,
  avatarColor,
  canCall,
  onCall,
  onClose,
  onTransfer,
  onNote,
  timer,
}: {
  channel: string;
  label: string;
  name: string;
  secondary: string;
  avatarColor: string;
  canCall?: boolean;
  onCall?: () => void;
  onClose: () => void;
  onTransfer?: () => void;
  onNote?: () => void;
  timer?: React.ReactNode;
}) {
  const meta: { tone: "green" | "gold" | "iris"; icon: string; color: string; close: string } =
    channel === "CHAT"
      ? { tone: "green", icon: "wa", color: "var(--green)", close: "Finalizar" }
      : channel === "EMAIL"
      ? { tone: "gold", icon: "mail", color: "var(--gold)", close: "Cerrar correo" }
      : { tone: "iris", icon: "check", color: "var(--iris)", close: "Cerrar tarea" };

  return (
    <div className="card card--pop" style={{ padding: "12px 18px", marginBottom: 16 }}>
      <div className="row between wrap gap12">
        <div className="row gap12" style={{ minWidth: 0 }}>
          <Av name={name} size={44} color={avatarColor} />
          <div style={{ minWidth: 0 }}>
            <div className="row gap8" style={{ fontSize: 15, fontWeight: 700 }}>
              <span className="truncate" style={{ maxWidth: 220 }}>
                {name}
              </span>
              <Pill tone={meta.tone} icon={meta.icon}>
                {label}
              </Pill>
            </div>
            {secondary && (
              <div className="muted mono" style={{ fontSize: 12, marginTop: 2 }}>
                {secondary}
              </div>
            )}
          </div>
        </div>
        <div className="row gap10 wrap" style={{ alignItems: "center" }}>
          {timer && (
            <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
              {timer}
            </div>
          )}
          {onNote && (
            <Btn variant="ghost" size="sm" icon="plus" onClick={onNote}>
              Nota
            </Btn>
          )}
          {onTransfer && (
            <Btn variant="ghost" size="sm" icon="route" onClick={onTransfer}>
              Transferir
            </Btn>
          )}
          {canCall && onCall && (
            <Btn variant="soft" size="sm" icon="phone" onClick={onCall}>
              Llamar
            </Btn>
          )}
          <Btn variant="primary" size="sm" icon="check" onClick={onClose}>
            {meta.close}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function AgentDesktopPage() {
  const {
    agentState,
    agentName,
    muted,
    onHold,
    recording,
    mute,
    toggleHold,
    hangup,
    accept,
    reject,
    toggleRecording,
    placeCall,
  } = useCCP();
  const { user } = useConnectAuth();
  // `rawContact` is the unfiltered streams snapshot — used only for
  // state-machine bookkeeping (capturing last-contact for the wrap-up,
  // detecting ACW). For everything UI-facing we use `activeContact`
  // below, which filters out contacts the agent already dismissed.
  const rawContact = useActiveContact();

  // Manual-mode preview leads: polled in the background so the idle
  // panel (when no active contact) can swap from EmptyPanel →
  // MyCampaignLeadsPanel when there's something pre-assigned to call.
  const { leads: myLeads } = useMyCampaignLeads(5000);
  const myLeadsCount = myLeads.length;

  // Contact Lens real-time transcript only exists for VOICE contacts (it's
  // an audio-analytics product). Skip the polling Lambda entirely for chat
  // / email / task to avoid spurious 5xx noise in the console.
  // Use `rawContact` here so subscriptions stay alive until the contact
  // actually disappears from streams — the dismissed-contact filter runs
  // below for display purposes only.
  const isVoice =
    (rawContact?.channel || "VOICE").toUpperCase() === "VOICE";
  const { data: liveData } = useLiveTranscript(
    rawContact && isVoice ? rawContact.contactId : null
  );
  // The Customer 360° "Refrescar perfil" menu item bumps this counter,
  // which both `useCustomerProfile` calls (here for the softphone header
  // and inside <CustomerProfilePanel/> for the right column) consume to
  // invalidate their cache without the phone changing.
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const { profile } = useCustomerProfile(
    rawContact?.customerPhone ?? null,
    profileRefreshKey
  );
  const latestCustomerUtterance = liveData?.segments
    .filter((s) => s.participant === "CUSTOMER")
    .slice(-1)[0]?.content;

  // Call timer — held inside the <CallTimer> leaf so the per-second
  // tick doesn't re-render the rest of the page. The latest value is
  // pushed into `elapsedRef` so the wrap-up snapshot can read it
  // without subscribing to state.
  const elapsedRef = useRef(0);
  const isConnected = rawContact?.state === "connected";

  // Snapshot of the last contact + its duration so wrap-up can still render
  // the contact info after `useActiveContact` clears the live ref.
  const lastContactRef = useRef<{
    contactId: string;
    customerPhone: string | null;
    queueName: string | undefined;
    duration: number;
    channel: string;
  } | null>(null);
  useEffect(() => {
    // Capture the contact for wrap-up whenever we know about a real
    // contactId — connected, on-hold, or ended. Uses rawContact so that
    // even contacts the agent has already dismissed (and thus filtered
    // out of `activeContact`) are still captured here if they re-appear
    // during the same session.
    if (rawContact?.contactId) {
      lastContactRef.current = {
        contactId: rawContact.contactId,
        customerPhone: rawContact.customerPhone,
        queueName: rawContact.queueName,
        channel: rawContact.channel,
        duration:
          lastContactRef.current?.contactId === rawContact.contactId
            ? Math.max(lastContactRef.current.duration, elapsedRef.current)
            : elapsedRef.current,
      };
    }
  }, [rawContact]);
  // Set of contactIds for which the agent already dismissed the wrap-up
  // screen. Persisted to localStorage so reopening the desktop / refreshing
  // the page doesn't bounce the agent back into a stale wrap-up from a
  // contact that ended in a previous session.
  const DISMISSED_KEY = "vox.wrapUp.dismissedContactIds";
  const [wrapDismissedIds, setWrapDismissedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      return new Set(arr);
    } catch {
      return new Set<string>();
    }
  });
  const dismissWrap = (cid: string | undefined) => {
    if (!cid) return;
    setWrapDismissedIds((curr) => {
      if (curr.has(cid)) return curr;
      const next = new Set(curr);
      next.add(cid);
      // Cap the persisted list so it doesn't grow unbounded.
      const arr = Array.from(next).slice(-100);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
      } catch {
        /* ignore quota errors */
      }
      return new Set(arr);
    });

    // Also tell Streams to clear the contact from the agent's view. Without
    // this, the disconnected contact lingers in the agent snapshot for ~30s
    // and the UI flicks back into the "ghost contact" state right after the
    // wrap-up is dismissed (you saw it as the page "going back then forward
    // by itself"). contact.clear() is the canonical end-of-ACW signal.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (globalThis as any).connect;
      if (c) {
         
        const ag = new c.Agent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const target = (ag.getContacts?.() || []).find((x: any) => x.getContactId?.() === cid);
        target?.clear?.({
          success: () => {
            /* noop */
          },
          failure: () => {
            /* noop — non-fatal */
          },
        });
      }
    } catch {
      /* swallow — clear() is best-effort */
    }
  };

  // ─── Action modals (DTMF keypad, transfer, summary, quick note) ──
  // Each of these toggles a small overlay that drives one of the
  // softphone toolbar / header buttons. Held here so a single state
  // dispatch closes them all if the agent navigates away.
  const [dtmfOpen, setDtmfOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [conferenceOpen, setConferenceOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // "Volver al inicio" durante una llamada: muestra el marcador sin colgar
  // (la llamada sigue viva); un banner permite regresar al cockpit.
  const [homeWhileInCall, setHomeWhileInCall] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);

  // ─── MODO "Vista demo" ───────────────────────────────────────────
  // Toggle discreto en el header. Cuando está ON, el Agent Desktop
  // renderiza el cockpit del handoff con DATA MOCK (AgentCockpitDemo)
  // para poder VER todos los estados sin una llamada real. Cuando está
  // OFF, el softphone/CCP funciona EXACTAMENTE como siempre — cero
  // cambios de comportamiento. Persistimos la elección para QA/demo.
  const DEMO_KEY = "vox.agentDesktop.demoView";
  const [demoOn, setDemoOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DEMO_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [demoState, setDemoState] = useState<DemoState>("active");
  const setDemo = (on: boolean) => {
    setDemoOn(on);
    try {
      localStorage.setItem(DEMO_KEY, on ? "1" : "0");
    } catch {
      /* ignore quota / disabled storage */
    }
  };
  // Agendar follow-up/tarea ahora vive SOLO en el launcher global "Tasks"
  // (debajo de Copilot) — se quitaron los atajos in-call del softphone.

  // Right-rail tab: 'cliente' (Customer 360° — con sus sub-pestañas Perfil/
  // Historial/Notas/Casos) | 'coach' (Claude Coach). Ambos paneles quedan
  // MONTADOS entre cambios (display:none) para que los fetches disparados por
  // la transcripción no se detengan cuando el agente cambia de pestaña.
  const [rightRailTab, setRightRailTab] = useState<"cliente" | "coach">("cliente");
  const [coachBlockCount, setCoachBlockCount] = useState(0);
  const [coachPulse, setCoachPulse] = useState(false);
  const prevCoachCountRef = useRef(0);
  const handleCoachBlocksChange = (count: number) => {
    setCoachBlockCount(count);
    // Pulse the tab badge when new blocks arrive (count increases) and
    // we're NOT already on the Coach tab — no point pulsing what the
    // agent is already looking at.
    if (count > prevCoachCountRef.current && rightRailTab !== "coach") {
      setCoachPulse(true);
      setTimeout(() => setCoachPulse(false), 1800);
    }
    prevCoachCountRef.current = count;
  };

  // Hide the CCP iframe — we drive everything via streams API
  useEffect(() => {
    const ccp = document.getElementById("ccp-container");
    if (ccp) {
      ccp.setAttribute(
        "style",
        "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);pointer-events:none;"
      );
    }
    return () => {
      const reset = document.getElementById("ccp-container");
      if (reset) reset.setAttribute("style", "");
    };
  }, []);

  // Guard against accidental refresh during a connected voice call —
  // the WebRTC peer dies with the page and Streams' first few snapshots
  // can leave the agent silently muted while audio renegotiates. The
  // user has to acknowledge this with the browser's native dialog.
  useEffect(() => {
    const hasLiveAudio =
      !!rawContact &&
      (rawContact.channel || "VOICE").toUpperCase() === "VOICE" &&
      (rawContact.state === "connected" || rawContact.state === "onhold");
    if (!hasLiveAudio) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome ignores the custom message but still shows the prompt
      // when this is set.
      e.returnValue = "Tienes una llamada en curso. ¿Cerrar?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [rawContact]);

  // Mic reconnect probe — after a refresh during a live call, Streams
  // re-attaches but the WebRTC peer is brand new. Toast the agent once
  // so they know to verify audio is flowing (and offer a manual mute
  // toggle as a cheap "kick the tires" reset).
  const reconnectToastFiredRef = useRef(false);
  useEffect(() => {
    if (reconnectToastFiredRef.current) return;
    const inCall =
      rawContact?.state === "connected" &&
      (rawContact.channel || "VOICE").toUpperCase() === "VOICE";
    if (!inCall) return;
    // Only fire if the page just loaded and there was a stored timer for
    // this contact — i.e. this is a post-refresh restoration, not a
    // fresh call. Cheap check: sessionStorage has the contactId already.
    let isRestoration = false;
    try {
      const raw = sessionStorage.getItem("vox.callTimers");
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, number>;
        if (rawContact?.contactId && obj[rawContact.contactId]) {
          const storedAt = obj[rawContact.contactId];
          // If we know the contact connected more than 10s ago AND the
          // page just loaded, this is a restoration.
          if (Date.now() - storedAt > 10_000) isRestoration = true;
        }
      }
    } catch {
      /* ignore */
    }
    if (!isRestoration) return;
    reconnectToastFiredRef.current = true;
    // Lazy import to keep this side-effect out of the main bundle path.
    import("sonner").then(({ toast }) => {
      toast.warning("Reconectando audio…", {
        description:
          "Recargaste durante una llamada. Prueba el micrófono dándole Mute → Mute off.",
        duration: 7000,
      });
    });
  }, [rawContact?.contactId, rawContact?.state, rawContact?.channel]);

  // Previously we filtered `rawContact` by `wrapDismissedIds` so an
  // agent who finished the wrap-up wouldn't keep seeing the ghost
  // contact. With the multi-contact tab strip that filter is now
  // counter-productive: the strip shows the contact, the workspace
  // hides it, and clicking the tab looks broken. The wrap-up screen
  // still uses `wrapDismissedIds` to avoid re-prompting; the workspace
  // simply renders whatever Streams currently surfaces.
  const activeContact = rawContact;

  // "Incoming" here means inbound + ringing — the agent has to decide whether
  // to accept. Outbound calls also pass through "connecting" but the agent
  // already initiated them, so we treat them differently.
  const isRinging =
    activeContact?.state === "connecting" ||
    activeContact?.state === "incoming" ||
    activeContact?.state === "ringing";
  const isOutbound = activeContact?.direction === "outbound";
  const isIncoming = isRinging && !isOutbound;
  const isDialing = isRinging && isOutbound;
  const isActive = activeContact?.state === "connected";
  // Missed but still attached (typical for chat / WhatsApp / email
  // — the contact stays in the agent's slot blocking new routing
  // until they call contact.clear()). The workspace shows a special
  // "close-only" view in this case.
  const isMissed = activeContact?.state === "missed";
  // ACW state needs the raw contact so the wrap-up screen still appears
  // the very first time the contact ends (before any dismiss has happened).
  const isACW = rawContact?.state === "ended" || agentState === "AfterCallWork";
  // Channel-color token used by the new softphone hero glow ring.
  const channelGlow = channelAccent(activeContact?.channel);
  const channelSolid = channelAccentSolid(activeContact?.channel);

  // ─── Channel awareness ─────────────────────────────────────────
  // The desktop UI was originally built around voice (mute / hold /
  // record / Contact Lens transcript). For chat (WhatsApp / Connect
  // chat widget) we render a different center panel and hide the
  // voice-only controls.
  const channelKey = (activeContact?.channel || "VOICE").toUpperCase();
  const isChat = channelKey === "CHAT";
  const isEmail = channelKey === "EMAIL";
  const isTask = channelKey === "TASK";
  // Friendly label that respects the WhatsApp source attribute when
  // present (set by the UDEP-Main-Inbound flow as `udep_source`).
  const channelLabel = isChat
    ? activeContact?.attributes?.udep_source === "whatsapp"
      ? "WhatsApp"
      : "Chat"
    : isEmail
    ? "Email"
    : isTask
    ? "Tarea"
    : "Llamada";

  // Sentiment aggregation from real transcript
  const sentimentCounts = useMemo(() => {
    const counts = { pos: 0, neu: 0, neg: 0 };
    (liveData?.segments ?? []).forEach((s) => {
      const sent = s.sentiment ?? "NEUTRAL";
      if (sent === "POSITIVE") counts.pos += 1;
      else if (sent === "NEGATIVE") counts.neg += 1;
      else counts.neu += 1;
    });
    return counts;
  }, [liveData?.segments]);
  const sentTotal = sentimentCounts.pos + sentimentCounts.neu + sentimentCounts.neg || 1;
  const sentScore =
    (sentimentCounts.pos - sentimentCounts.neg) / Math.max(1, sentTotal);
  // Sentiment -1..1 mapeado a 0..100 para el medidor del CallBar. Cuando
  // aún no hay segmentos, mostramos el centro (50) en vez de saltar.
  const hasSentiment =
    sentimentCounts.pos + sentimentCounts.neu + sentimentCounts.neg > 0;
  const sentMeter = hasSentiment ? Math.round((sentScore + 1) * 50) : 50;

  // ¿Llamada de VOZ conectada y en foco? → dispara el rediseño en-llamada
  // (CallBar horizontal + grid de 3 columnas). El resto de canales/estados
  // (chat, email, idle, entrante) conserva el layout .call de 3 paneles.
  const isVoiceInCall = isActive && channelKey === "VOICE";
  // Rama que muestra el cockpit de voz: en llamada O marcando (saliente).
  // Marcar entra DIRECTO al cockpit (con "Marcando…"), sin pantalla aparte.
  const showVoiceCockpit = isVoiceInCall || (isDialing && channelKey === "VOICE");

  // Ondas REALES del CallBar: nivel del micrófono del agente en vivo (17
  // barras, igual que WAVE_BARS). Sólo se abre el mic en llamada conectada y
  // con audio activo (no mute / no espera); si no, cae a la animación CSS.
  const micLevels = useMicLevels(isVoiceInCall && !muted && !onHold, 17);

  // Al terminar la llamada, salir del modo "inicio durante llamada".
  useEffect(() => {
    if (!showVoiceCockpit && homeWhileInCall) setHomeWhileInCall(false);
  }, [showVoiceCockpit, homeWhileInCall]);

  // Caller display — uses the smart resolver: person name first, then
  // BusinessName only if it doesn't look like a Salesforce-synced
  // account number (e.g. "70498978"), then email / phone.
  const profileFullName = profile
    ? displayCustomerName(
        {
          firstName: profile.firstName,
          lastName: profile.lastName,
          businessName: profile.businessName,
          email: profile.email,
          phoneNumber: profile.phoneNumber,
        },
        ""
      ) || null
    : null;
  const callerName =
    profileFullName ||
    activeContact?.customerPhone ||
    (isIncoming ? "Cliente entrante" : "Sin contacto");
  const callerAvatarColor = colorFromName(callerName);
  const callerSecondary = activeContact?.customerPhone
    ? `${activeContact.customerPhone} · ${activeContact.queueName || ""}`
    : activeContact?.queueName || "Esperando ruteo";
  const profileAccountType = profile?.partyType;

  // ─────────────────────────────────────────────────────────────
  // Wrap-up screen takes over the whole page when the call ends.
  // We LATCH the decision: once isACW becomes true for a contact, the
  // wrap-up stays mounted until the agent dismisses it, even if Streams'
  // snapshot briefly oscillates the contact's state back to "connecting"
  // (which happens because two pollers — snapshot + API fallback — can
  // disagree about state for a couple of seconds after disconnect).
  // ─────────────────────────────────────────────────────────────
  const lastContactId = lastContactRef.current?.contactId;
  // Latched wrap-up state. Once a contact enters ACW we freeze a snapshot
  // of its info and keep the wrap-up view mounted until the agent
  // explicitly dismisses it — even if Streams' state oscillates back to
  // "connecting" for a beat, or a new contact pushes lastContactRef.
  const [pendingWrap, setPendingWrap] = useState<{
    contactId: string;
    customerPhone: string | null;
    queueName: string | undefined;
    duration: number;
    channel: string;
  } | null>(null);
  useEffect(() => {
    if (
      isACW &&
      lastContactId &&
      !wrapDismissedIds.has(lastContactId) &&
      !isIncoming
    ) {
      // Latch with the current lastContactRef snapshot.
      const snap = lastContactRef.current;
      if (snap && snap.contactId === lastContactId) {
        setPendingWrap((cur) =>
          cur?.contactId === lastContactId ? cur : { ...snap }
        );
      }
    }
  }, [isACW, lastContactId, wrapDismissedIds, isIncoming]);
  // Clear the latch when a NEW contactId becomes the live one AND we're
  // no longer in ACW for the old one — that's the agent moving on.
  useEffect(() => {
    if (
      pendingWrap &&
      lastContactId &&
      lastContactId !== pendingWrap.contactId &&
      !isACW
    ) {
      setPendingWrap(null);
    }
  }, [lastContactId, pendingWrap, isACW]);

  // Auto-registra la interacción en el lead apenas el contacto entra en ACW
  // (terminó), SIN depender de que el agente tipifique → toda llamada/chat cuenta
  // como "última interacción". Una vez por contacto. Si luego tipifica, esa gestión
  // queda como la última y el timeline deduplica por contactId.
  const loggedInteractionRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!pendingWrap || !pendingWrap.customerPhone) return;
    if (loggedInteractionRef.current.has(pendingWrap.contactId)) return;
    loggedInteractionRef.current.add(pendingWrap.contactId);
    const ep = getApiEndpoints();
    if (!ep?.salesforceSync) return;
    fetch(ep.salesforceSync, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerPhone: pendingWrap.customerPhone,
        channel: pendingWrap.channel === "CHAT" ? "WhatsApp" : pendingWrap.channel,
        contactId: pendingWrap.contactId,
        durationSeconds: pendingWrap.duration,
        untyped: true,
      }),
    }).catch(() => {
      /* best-effort — el registro de la interacción no debe romper el flujo */
    });
  }, [pendingWrap]);

  const showWrapUp =
    !!pendingWrap &&
    !wrapDismissedIds.has(pendingWrap.contactId) &&
    !isIncoming;

  // ─── DEBUG INSTRUMENTATION ────────────────────────────────────
  // Tracks every render plus diffs on the bag of derived state that
  // governs which "screen" the desktop shows. When the page flickers
  // between two views, the diff log here points straight at which
  // variable flipped. Activate with `?debug=1` in the URL.
  useDebugRender("AgentDesktopPage", {
    rawContactId: rawContact?.contactId,
    rawState: rawContact?.state,
    rawPhone: rawContact?.customerPhone,
    rawChannel: rawContact?.channel,
    activeContactId: activeContact?.contactId,
    isACW,
    isIncoming,
    isActive,
    isDialing,
    pendingWrap: pendingWrap?.contactId,
    showWrapUp,
    dismissedCount: wrapDismissedIds.size,
  });
  traceChange("AgentDesktopPage.screen", {
    screen: showWrapUp
      ? "wrap-up"
      : activeContact
      ? `active(${activeContact.channel}, ${activeContact.state})`
      : "empty",
    isACW,
    isIncoming,
    isActive,
  });

  // Header compacto del Agent Desktop — vive por encima de la tira de
  // contactos. Lleva el toggle "Vista demo" (siempre visible, útil para
  // demo/QA) y, cuando el demo está activo, el segmentador de estados.
  const cockpitHeader = (
    <div className="vox-ad__head">
      <div className="row gap12" style={{ alignItems: "center", flexWrap: "wrap" }}>
        {demoOn && (
          <div className="stateseg" role="tablist" aria-label="Estado demo del agente">
            {DEMO_STATES.map(([id, label, ic]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-pressed={demoState === id}
                onClick={() => setDemoState(id)}
              >
                <AIcon name={ic} size={13} />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="row gap8" style={{ alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Vista demo
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={demoOn}
          aria-label="Alternar vista demo"
          onClick={() => setDemo(!demoOn)}
          title={
            demoOn
              ? "Volver al softphone real"
              : "Ver el cockpit con datos de ejemplo (no toca la llamada real)"
          }
          className="vox-ad__switch"
          data-on={demoOn ? "true" : "false"}
        >
          <span className="vox-ad__switch-knob" />
        </button>
      </div>
    </div>
  );

  // MODO DEMO — reemplaza todo el softphone real por el cockpit mock.
  // Self-contained: no monta hooks/modales del CCP; sólo el header sigue
  // vivo para poder apagar el demo.
  if (demoOn) {
    return (
      <OmnichannelNotifierProvider>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {cockpitHeader}
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <div className="page" style={{ maxWidth: "none", paddingTop: 14 }}>
              <AgentCockpitDemo state={demoState} onState={setDemoState} />
            </div>
          </div>
        </div>
      </OmnichannelNotifierProvider>
    );
  }

  if (showWrapUp && pendingWrap) {
    return (
      <OmnichannelNotifierProvider>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {cockpitHeader}
          <MissedCallBanner />
          <ActiveContactsTabStrip />
          <div style={{ flex: 1, minHeight: 0 }}>
            <WrapUpView
              contactId={pendingWrap.contactId}
              customerPhone={pendingWrap.customerPhone}
              queueName={pendingWrap.queueName}
              durationSeconds={pendingWrap.duration}
              channel={pendingWrap.channel}
              onFinish={() => {
                dismissWrap(pendingWrap.contactId);
                setPendingWrap(null);
              }}
            />
          </div>
        </div>
      </OmnichannelNotifierProvider>
    );
  }

  return (
    <OmnichannelNotifierProvider>
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
      data-debug-component="AgentDesktopPage"
    >
      {cockpitHeader}
      <MissedCallBanner />
      <ActiveContactsTabStrip />
      {/* ENTRANTE (voz): el screen-pop es un POP-UP con overlay GLOBAL
         (<IncomingCallOverlay/>) que interrumpe cualquier pantalla; ahí se
         acepta/rechaza. De fondo mostramos el idle (rama de más abajo)
         mientras suena. Aceptar → connected → cockpit en-llamada directo. */}
      {/* VOZ (marcando o en llamada) → entra DIRECTO al cockpit. Marcar no
         muestra una pantalla aparte: el CallBar dice "Marcando…" y al
         conectar arranca el timer. "Volver al inicio" (homeWhileInCall)
         muestra el marcador SIN colgar; un banner permite regresar. El resto
         de canales/estados usa el layout .call de abajo. */}
      {showVoiceCockpit ? (
        homeWhileInCall ? (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <div className="page fadeup" style={{ maxWidth: "none", paddingTop: 12 }}>
              <button
                type="button"
                onClick={() => setHomeWhileInCall(false)}
                className="card card__pad row between"
                style={{
                  alignItems: "center",
                  marginBottom: 16,
                  width: "100%",
                  cursor: "pointer",
                  textAlign: "left",
                  borderColor: "color-mix(in srgb,var(--green) 45%,var(--border-1))",
                  background: "linear-gradient(100deg,var(--green-soft),transparent 60%)",
                }}
              >
                <span className="row gap12" style={{ alignItems: "center", minWidth: 0 }}>
                  <span className="dot dot--live" style={{ background: "var(--green)" }} />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 14 }}>
                      Llamada en curso · {callerName}
                    </b>
                    <div className="dim" style={{ fontSize: 12 }}>
                      Estás en el marcador — la llamada sigue activa. Toca para volver.
                    </div>
                  </span>
                </span>
                <span className="btn btn--primary btn--sm">
                  <AIcon name="phone" size={14} /> Volver a la llamada
                </span>
              </button>
              <AgentIdleCockpit />
            </div>
          </div>
        ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div className="page fadeup" style={{ maxWidth: "none", paddingTop: 12 }}>
            <CockpitCallBar
              name={callerName}
              phone={activeContact?.customerPhone}
              prog={activeContact?.queueName || undefined}
              statusLabel={isConnected ? "En llamada" : "Marcando…"}
              avatarColor={callerAvatarColor}
              sentiment={hasSentiment ? sentMeter : null}
              audioOn={!onHold && !muted}
              levels={isVoiceInCall && !muted && !onHold ? micLevels : undefined}
              hold={onHold}
              muted={muted}
              onMute={() => mute()}
              onHold={() => toggleHold()}
              onHome={() => setHomeWhileInCall(true)}
              onTransfer={() => setTransferOpen(true)}
              onConference={() => setConferenceOpen(true)}
              onEnd={() => hangup(activeContact?.contactId)}
              timer={
                <CallTimer
                  active={isConnected}
                  resetKey={rawContact?.contactId || ""}
                  startedAtMs={rawContact?.connectedAtMs ?? null}
                  onTickRef={elapsedRef}
                />
              }
              rightExtra={
                <button
                  type="button"
                  onClick={toggleRecording}
                  title={recording ? "Pausar grabación" : "Reanudar grabación"}
                  className="row gap6 center"
                  style={{
                    fontWeight: 700,
                    fontSize: 12,
                    color: recording ? "var(--accent-red)" : "var(--text-3)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span
                    className={recording ? "dot dot--live" : "dot"}
                    style={{ background: recording ? "var(--accent-red)" : "var(--text-3)" }}
                  />
                  {recording ? "REC" : "Grabar"}
                </button>
              }
            />

            <div className="agent-grid">
              {/* Columna 1 — Cliente 360° (real) + Momentos clave (Contact Lens) */}
              <div className="col gap16">
                <Card
                  title="Cliente 360°"
                  icon="user"
                  extra={
                    <Customer360MoreMenu
                      customerPhone={activeContact?.customerPhone ?? null}
                      contactId={activeContact?.contactId ?? null}
                      onRefreshProfile={() => setProfileRefreshKey((k) => k + 1)}
                    />
                  }
                >
                  <CustomerProfilePanel
                    phone={activeContact?.customerPhone ?? null}
                    isActive={!!isActive}
                    refreshKey={profileRefreshKey}
                    contactId={activeContact?.contactId ?? null}
                    agentUsername={user?.username || ""}
                  />
                </Card>
                <MomentsPanel liveData={liveData} />
              </div>

              {/* Columna 2 — Transcripción en vivo (burbujas por sentimiento, Contact Lens) */}
              <Card
                title="Transcripción en vivo"
                icon="mic"
                bodyStyle={{ maxHeight: "calc(100dvh - 300px)", overflowY: "auto" }}
                extra={
                  <span className="row gap8" style={{ alignItems: "center" }}>
                    {liveData && liveData.totalSegments > 0 && (
                      <Pill tone="cyan" icon="dot">
                        Contact Lens
                      </Pill>
                    )}
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="sparkle"
                      onClick={() => setSummaryOpen(true)}
                      title="Generar resumen de la conversación"
                    >
                      Resumen
                    </Btn>
                  </span>
                }
              >
                <LiveTranscriptPanel
                  contactId={activeContact?.contactId ?? null}
                  isActive={!!isActive}
                />
              </Card>

              {/* Columna 3 — Copiloto (asistente real) */}
              <div className="col gap16">
                <AIAssistPanel
                  contactId={activeContact?.contactId ?? null}
                  customerPhone={activeContact?.customerPhone ?? null}
                  latestCustomerUtterance={latestCustomerUtterance}
                />
                <AICoachPanel
                  contactId={activeContact?.contactId ?? null}
                  customerPhone={activeContact?.customerPhone ?? null}
                  transcriptSegmentCount={liveData?.totalSegments || 0}
                  isActive={!!isActive}
                  sentiment={liveData?.overallSentiment}
                  inline
                  onBlocksChange={handleCoachBlocksChange}
                />
              </div>
            </div>
          </div>
        </div>
        )
      ) : (!activeContact && !isIncoming) ||
        (isIncoming && channelKey === "VOICE") ? (
        /* IDLE REAL — cabina a ANCHO COMPLETO, idéntica al `Dialer` de la
           "Vista demo": card "Iniciar contacto" (Marcador/Buscar/Más
           acciones) + Disponible/Pausar · Perdidas · Siguiente en cola ·
           Mis leads · Tareas. También es el FONDO mientras suena un entrante
           de voz (el pop-up <IncomingCallOverlay/> va encima). Todo el wiring
           real (placeCall, leads, perdidas, estado) vive en <AgentIdleCockpit/>. */
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div className="page fadeup" style={{ maxWidth: "none", paddingTop: 12 }}>
            {/* Barra de identidad del agente — conserva el pill de estado
                real (AgentStatePill) visible sobre la cabina. */}
            <div
              className="card card__pad row between"
              style={{ alignItems: "center", marginBottom: 16 }}
            >
              <div className="row gap12" style={{ alignItems: "center", minWidth: 0 }}>
                <Avatar
                  name={agentName || user?.username || "Agente"}
                  size="md"
                  color={colorFromName(agentName || user?.username || "Vox")}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                    {agentName || user?.username || "Agente"}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {roleLabelOf(user?.highestRole)}
                  </div>
                </div>
              </div>
              <AgentStatePill />
            </div>
            <AgentIdleCockpit />
          </div>
        </div>
      ) : isActive && (isChat || isEmail || isTask) ? (
        /* EN-LLAMADA REAL (WhatsApp / Email / Tarea) — MISMO diseño demo
           que la voz: barra compacta por canal + `.agent-grid` de 3
           columnas (Cliente 360° | panel real del canal | Copiloto).
           Se reutilizan los paneles REALES (ChatThreadPanel /
           EmailThreadPanel) con sus handlers intactos (enviar mensaje,
           cerrar, adjuntar…). El Coach de voz no aplica a estos canales
           (degrada honesto). Cerrar/Finalizar dispara los MISMOS handlers
           del softphone (hangup + dismissWrap para chat). */
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div className="page fadeup" style={{ maxWidth: "none", paddingTop: 12 }}>
            <ChannelBarReal
              channel={channelKey}
              label={channelLabel}
              name={callerName}
              secondary={
                isEmail
                  ? activeContact?.customerPhone || activeContact?.queueName || ""
                  : activeContact?.queueName || activeContact?.customerPhone || ""
              }
              avatarColor={callerAvatarColor}
              canCall={
                channelKey === "CHAT" && !!activeContact?.customerPhone
              }
              onCall={async () => {
                if (!activeContact?.customerPhone) return;
                try {
                  await placeCall(activeContact.customerPhone);
                } catch {
                  /* toast lo maneja el dialer */
                }
              }}
              onClose={() => {
                if (!activeContact) return;
                hangup(activeContact.contactId);
                if (isChat && activeContact.contactId) {
                  dismissWrap(activeContact.contactId);
                }
              }}
              onTransfer={
                isChat ? () => setTransferOpen(true) : undefined
              }
              onNote={isChat ? () => setQuickNoteOpen(true) : undefined}
              timer={
                <CallTimer
                  active={isConnected}
                  resetKey={rawContact?.contactId || ""}
                  startedAtMs={rawContact?.connectedAtMs ?? null}
                  onTickRef={elapsedRef}
                />
              }
            />

            <div className="agent-grid">
              {/* Columna 1 — Cliente 360° real */}
              <div className="col gap16">
                <Card
                  title="Cliente 360°"
                  icon="user"
                  extra={
                    <Customer360MoreMenu
                      customerPhone={activeContact?.customerPhone ?? null}
                      contactId={activeContact?.contactId ?? null}
                      onRefreshProfile={() => setProfileRefreshKey((k) => k + 1)}
                    />
                  }
                >
                  <CustomerProfilePanel
                    phone={activeContact?.customerPhone ?? null}
                    isActive={!!isActive}
                    refreshKey={profileRefreshKey}
                    contactId={activeContact?.contactId ?? null}
                    agentUsername={user?.username || ""}
                  />
                </Card>
              </div>

              {/* Columna 2 — panel real del canal */}
              <Card
                title={
                  isChat
                    ? `Conversación · ${channelLabel}`
                    : isEmail
                    ? "Correo · Email"
                    : "Tarea · seguimiento"
                }
                icon={isChat ? "wa" : isEmail ? "mail" : "check"}
                pad={false}
                bodyStyle={{
                  display: "flex",
                  flexDirection: "column",
                  // Altura acotada por viewport para que los paneles reales
                  // (que usan height:100% + flex:1 en su scroll interno) se
                  // rendericen correctamente dentro del grid.
                  height: "clamp(420px, 64vh, 760px)",
                }}
              >
                {isChat && activeContact ? (
                  <ChatThreadPanel
                    contactId={activeContact.contactId}
                    channel={activeContact.channel}
                    customerName={callerName}
                    channelLabel={channelLabel}
                    customerPhone={activeContact.customerPhone}
                    agentName={agentName || user?.username}
                    queueName={activeContact.queueName}
                  />
                ) : isEmail && activeContact ? (
                  <EmailThreadPanel
                    contactId={activeContact.contactId}
                    customerName={callerName}
                  />
                ) : (
                  /* TASK — no hay panel real dedicado; mostramos la info
                     real del contacto de tarea (sin inventar checklist). */
                  <div style={{ padding: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>
                      {callerName}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {activeContact?.queueName || "Tarea de Connect"}
                    </div>
                    {activeContact?.attributes &&
                      Object.entries(activeContact.attributes).filter(
                        ([k]) => !k.startsWith("_")
                      ).length > 0 && (
                        <div
                          className="col"
                          style={{ gap: 8, marginTop: 14, fontSize: 13 }}
                        >
                          {Object.entries(activeContact.attributes)
                            .filter(([k]) => !k.startsWith("_"))
                            .map(([k, v]) => (
                              <div key={k} className="row between">
                                <span className="muted">{k}</span>
                                <b style={{ maxWidth: "60%", textAlign: "right" }}>
                                  {String(v)}
                                </b>
                              </div>
                            ))}
                        </div>
                      )}
                  </div>
                )}
              </Card>

              {/* Columna 3 — Copiloto real (el Coach de voz no aplica) */}
              <div className="col gap16">
                <AIAssistPanel
                  contactId={activeContact?.contactId ?? null}
                  customerPhone={activeContact?.customerPhone ?? null}
                  latestCustomerUtterance={latestCustomerUtterance}
                />
                <Card title="Coach · Claude" icon="bot" accent="var(--iris)">
                  <div
                    className="muted"
                    style={{ fontSize: 12.5, lineHeight: 1.5 }}
                  >
                    El coach en vivo analiza la transcripción de Contact Lens,
                    disponible solo en llamadas de voz.
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="call" style={{ flex: 1, minHeight: 0 }}>
      {/* ──────────────────────────────────────────────────────────
         LEFT — Softphone v2 (modernized)
      ────────────────────────────────────────────────────────── */}
      <div className="call__panel call__panel--v2" data-debug-component="SoftphonePanel">
        {/* Agent identity strip — always on top with quick state pill */}
        <div className="vox-sp__agentbar">
          <Avatar
            name={agentName || user?.username || "Agente"}
            size="sm"
            color={colorFromName(agentName || user?.username || "Vox")}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="vox-sp__agentbar-name">
              {agentName || user?.username || "Agente"}
            </div>
            <div className="vox-sp__agentbar-role">
              {roleLabelOf(user?.highestRole)}
            </div>
          </div>
          <AgentStatePill />
        </div>

        {/* Hero — caller or idle */}
        {activeContact || isIncoming ? (
          <div
            className="vox-sp__hero"
            style={{ ["--ch" as string]: channelGlow }}
          >
            <div className="vox-sp__avatar-wrap">
              <span
                className={`vox-sp__avatar-ring ${
                  isIncoming || isDialing
                    ? "vox-sp__avatar-ring--pulse"
                    : ""
                }`}
                style={{ ["--ch" as string]: channelSolid }}
              />
              <Avatar
                name={callerName}
                size="lg"
                color={callerAvatarColor}
              />
            </div>
            <div className="vox-sp__name">{callerName}</div>
            <div className="vox-sp__sub">{callerSecondary}</div>
            <div className="vox-sp__pills">
              {profileAccountType && (
                <Pill tone="iris">{profileAccountType}</Pill>
              )}
              <span
                className="pill"
                style={{
                  background: channelGlow,
                  color: channelSolid,
                  borderColor: "transparent",
                }}
              >
                {isChat ? (
                  <><MessageCircle size={13} /> Chat</>
                ) : isEmail ? (
                  <><Mail size={13} /> Email</>
                ) : isTask ? (
                  <><ClipboardList size={13} /> Tarea</>
                ) : (
                  <><Phone size={13} /> Voz</>
                )}
              </span>
              {isActive && !isChat && !isEmail && !isTask && (
                <span
                  className="pill pill--outline"
                  title="Calidad de conexión"
                >
                  <span className="vox-sp__quality">
                    <span /><span /><span />
                  </span>
                  HD
                </span>
              )}
            </div>
            <div className="vox-sp__timerwrap">
              <div className="vox-sp__timer">
                <CallTimer
                  active={isConnected}
                  resetKey={rawContact?.contactId || ""}
                  startedAtMs={rawContact?.connectedAtMs ?? null}
                  onTickRef={elapsedRef}
                />
              </div>
              <div className="vox-sp__timerlbl">
                {isActive ? (
                  <>
                    {isChat || isEmail || isTask ? (
                      <span>Duración</span>
                    ) : (
                      <>
                        <span>Duración</span>
                        <span
                          className={`vox-sp__audio ${muted ? "vox-sp__audio--muted" : ""}`}
                          aria-hidden="true"
                        >
                          <span /><span /><span /><span /><span />
                        </span>
                        {recording && (
                          <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>
                            ● REC
                          </span>
                        )}
                      </>
                    )}
                  </>
                ) : isIncoming ? (
                  <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>
                    {isChat ? `${channelLabel} entrante` : "Llamada entrante"}
                  </span>
                ) : isDialing ? (
                  <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                    Marcando…
                  </span>
                ) : (
                  <span className="muted">
                    {activeContact
                      ? `Sin ${channelLabel.toLowerCase()} activo`
                      : "Sin contacto"}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Idle hero — agent identity surfaced as the focus when no
             contact is attached. Color the glow amber to signal "open
             for business" without competing with the call channels. */
          <div
            className="vox-sp__hero"
            style={{ ["--ch" as string]: "var(--accent-amber-soft)" }}
          >
            <div className="vox-sp__avatar-wrap">
              <span
                className="vox-sp__avatar-ring"
                style={{ ["--ch" as string]: "var(--accent-amber)" }}
              />
              <Avatar
                name={agentName || user?.username || "Vox"}
                size="lg"
                color={colorFromName(agentName || user?.username || "Vox")}
              />
            </div>
            <div className="vox-sp__name">
              {agentName || user?.username || "Agente"}
            </div>
            <div className="vox-sp__sub">
              {agentState === "Available"
                ? "Listo para recibir contactos"
                : agentState === "Offline"
                ? "Estás offline"
                : "Sin contacto activo"}
            </div>
          </div>
        )}

        {/* Primary controls — hierarchy: 3 circular buttons for the
            agent's most-used actions. End is the central red anchor.
            Hidden when there's no contact (the empty state shows the
            outbound actions grid instead). */}
        {isIncoming ? (
          <div className="vox-sp__primary">
            <button
              type="button"
              className="vox-sp__pbtn"
              onClick={() => reject(activeContact?.contactId)}
              title="Rechazar"
              style={{ color: "var(--accent-red)" }}
            >
              <Icon.Hangup size={22} />
              <span className="vox-sp__pbtn-lbl">Rechazar</span>
            </button>
            <button
              type="button"
              className="vox-sp__pbtn vox-sp__pbtn--accept"
              onClick={() => accept(activeContact?.contactId)}
              title="Atender"
            >
              <Icon.PhoneIn size={26} />
              <span
                className="vox-sp__pbtn-lbl"
                style={{ color: "var(--accent-green)", fontWeight: 600 }}
              >
                Atender
              </span>
            </button>
          </div>
        ) : isActive && !isChat && !isEmail && !isTask ? (
          <div className="vox-sp__primary">
            <button
              type="button"
              className={`vox-sp__pbtn ${muted ? "vox-sp__pbtn--on" : ""}`}
              onClick={() => mute()}
              title={muted ? "Activar mic" : "Silenciar"}
            >
              {muted ? <Icon.MicOff /> : <Icon.Mic />}
              <span className="vox-sp__pbtn-lbl">{muted ? "Mic off" : "Mute"}</span>
            </button>
            <button
              type="button"
              className="vox-sp__pbtn vox-sp__pbtn--end"
              onClick={() => hangup(activeContact?.contactId)}
              title="Colgar"
            >
              <Icon.Hangup size={26} />
              <span
                className="vox-sp__pbtn-lbl"
                style={{ color: "var(--accent-red)", fontWeight: 600 }}
              >
                Colgar
              </span>
            </button>
            <button
              type="button"
              className={`vox-sp__pbtn ${onHold ? "vox-sp__pbtn--on" : ""}`}
              onClick={() => toggleHold()}
              title={onHold ? "Reanudar" : "Poner en espera"}
            >
              <Icon.Pause />
              <span className="vox-sp__pbtn-lbl">
                {onHold ? "En espera" : "Espera"}
              </span>
            </button>
          </div>
        ) : isDialing ? (
          <div className="vox-sp__primary">
            <button
              type="button"
              className="vox-sp__pbtn vox-sp__pbtn--end"
              onClick={() => hangup(activeContact?.contactId)}
              title="Cancelar marcado"
            >
              <Icon.Hangup size={22} />
              <span
                className="vox-sp__pbtn-lbl"
                style={{ color: "var(--accent-red)", fontWeight: 600 }}
              >
                Cancelar
              </span>
            </button>
          </div>
        ) : activeContact && (isChat || isEmail || isTask) ? (
          <div className="vox-sp__primary">
            <button
              type="button"
              className="vox-sp__pbtn vox-sp__pbtn--end"
              onClick={() => {
                hangup(activeContact.contactId);
                if (isChat && activeContact.contactId) {
                  dismissWrap(activeContact.contactId);
                }
              }}
              title={`Cerrar ${channelLabel.toLowerCase()}`}
            >
              <Icon.Hangup size={22} />
              <span
                className="vox-sp__pbtn-lbl"
                style={{ color: "var(--accent-red)", fontWeight: 600 }}
              >
                {isChat ? "Finalizar" : "Cerrar"}
              </span>
            </button>
          </div>
        ) : null}

        {/* Secondary controls — voice 3x2 grid */}
        {isActive && !isChat && !isEmail && !isTask && (
          <div className="vox-sp__secondary">
            <button
              type="button"
              className={`vox-sp__sbtn ${dtmfOpen ? "vox-sp__sbtn--on" : ""}`}
              onClick={() => setDtmfOpen(true)}
              title="Enviar DTMF"
            >
              <Icon.Pad />
              <span>Teclado</span>
            </button>
            <button
              type="button"
              className="vox-sp__sbtn"
              onClick={() => setTransferOpen(true)}
              title="Transferir a otra cola"
            >
              <Icon.Transfer />
              <span>Transferir</span>
            </button>
            <button
              type="button"
              className="vox-sp__sbtn"
              onClick={() => setConferenceOpen(true)}
              title="Añadir un 3er participante (conferencia)"
            >
              <Icon.Users />
              <span>Conferencia</span>
            </button>
            <button
              type="button"
              className={`vox-sp__sbtn ${recording ? "vox-sp__sbtn--rec" : ""}`}
              onClick={toggleRecording}
              title={recording ? "Pausar grabación" : "Reanudar grabación"}
            >
              <Icon.Record />
              <span>{recording ? "Grabando" : "Pausada"}</span>
            </button>
            <button
              type="button"
              className="vox-sp__sbtn"
              onClick={() => setSummaryOpen(true)}
              title="Resumen IA de la llamada"
            >
              <Icon.Sparkles />
              <span>Resumen IA</span>
            </button>
          </div>
        )}

        {/* Chat secondary — 2 or 3 columns depending on phone availability */}
        {isChat && isActive && (
          <div
            className="vox-sp__secondary"
            style={{ gridTemplateColumns: "repeat(2, 1fr)" }}
          >
            <button
              type="button"
              className="vox-sp__sbtn"
              onClick={() => setTransferOpen(true)}
              title="Transferir el chat"
            >
              <Icon.Transfer />
              <span>Transferir</span>
            </button>
            <button
              type="button"
              className="vox-sp__sbtn"
              onClick={() => setQuickNoteOpen(true)}
              title="Nota rápida"
            >
              <Icon.Note />
              <span>Nota</span>
            </button>
          </div>
        )}

        {/* Sentiment — slim, voice-only, requires data */}
        {!isChat && !isEmail && !isTask && !!activeContact &&
          sentTotal > 1 &&
          sentimentCounts.pos + sentimentCounts.neu + sentimentCounts.neg > 0 && (
            <div className="vox-sp__sentiment">
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--text-3)",
                  fontWeight: 600,
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>Sentiment en vivo</span>
                <span
                  className="mono"
                  style={{
                    color:
                      sentScore > 0.1
                        ? "var(--accent-green)"
                        : sentScore < -0.1
                        ? "var(--accent-red)"
                        : "var(--text-2)",
                    fontSize: 11,
                    letterSpacing: 0,
                  }}
                >
                  {sentScore >= 0 ? "+" : ""}
                  {sentScore.toFixed(2)}
                </span>
              </div>
              <div className="vox-sp__sentiment-bar">
                <div
                  className="pos"
                  style={{
                    width: `${(sentimentCounts.pos / sentTotal) * 100}%`,
                    background: "var(--accent-green)",
                  }}
                />
                <div
                  className="neu"
                  style={{
                    width: `${(sentimentCounts.neu / sentTotal) * 100}%`,
                    background: "var(--text-3)",
                  }}
                />
                <div
                  className="neg"
                  style={{
                    width: `${(sentimentCounts.neg / sentTotal) * 100}%`,
                    background: "var(--accent-red)",
                  }}
                />
              </div>
              <div className="vox-sp__sentiment-row">
                <span style={{ color: "var(--accent-green)" }}>
                  ● {sentimentCounts.pos}
                </span>
                <span style={{ color: "var(--text-3)" }}>
                  ● {sentimentCounts.neu}
                </span>
                <span style={{ color: "var(--accent-red)" }}>
                  ● {sentimentCounts.neg}
                </span>
              </div>
            </div>
          )}

        {/* El estado IDLE (sin contacto) ahora se intercepta antes que este
            layout .call y se renderiza a ancho completo con <AgentIdleCockpit/>
            (cabina estilo demo). Este softphone .call__panel--v2 sólo queda
            para canales no-voz activos (chat/email/tarea) y el estado missed,
            donde siempre hay un contacto — de ahí que ya no se muestre el
            cockpit idle embebido aquí. */}
      </div>

      {/* ──────────────────────────────────────────────────────────
         CENTER — Channel-aware: ChatThreadPanel for CHAT, LiveTranscript
         for VOICE. Hidden chrome (header / Resumen button) for chat
         since the ChatThreadPanel renders its own header.
      ────────────────────────────────────────────────────────── */}
      <div className="call__panel" data-debug-component="CenterPanel">
        {isMissed && activeContact ? (
          /* Focused contact is in "missed" state — the conversation
             never started but the contact still occupies a slot in
             the agent's concurrency (true for chat/WhatsApp/email).
             `flex: 1 + minHeight: 0` makes this view fill exactly the
             center column's available height (the parent panel sets
             `display: flex; flex-direction: column` so flex children
             stretch). With `justifyContent: center` the buttons sit
             in the middle of the viewport, never below the fold. */
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              padding: 20,
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              background:
                "radial-gradient(circle at 50% 0%, var(--accent-red-soft) 0%, transparent 70%)",
            }}
          >
            <div
              style={{
                display: "grid",
                placeItems: "center",
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--accent-red)",
                color: "white",
                flexShrink: 0,
              }}
            >
              <Icon.Hangup size={22} />
            </div>
            <div style={{ maxWidth: 420 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--text-1)",
                  marginBottom: 4,
                }}
              >
                {channelLabel} perdido
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.5,
                }}
              >
                No aceptaste a tiempo. Sigue ocupando un espacio en tu
                concurrencia hasta que lo cierres.
              </div>
              {activeContact.customerPhone && (
                <div
                  className="mono"
                  style={{
                    marginTop: 8,
                    fontSize: 12.5,
                    color: "var(--text-1)",
                  }}
                >
                  {activeContact.customerPhone}
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 10, marginTop: 4, flexShrink: 0 }}>
              <Btn
                variant="soft"
                icon="phone"
                style={{ color: "var(--red)" }}
                onClick={() => hangup(activeContact.contactId)}
              >
                Cerrar contacto
              </Btn>
              {channelKey === "VOICE" && activeContact.customerPhone && (
                <Btn
                  variant="primary"
                  icon="arrowIn"
                  onClick={async () => {
                    try {
                      await placeCall(activeContact.customerPhone!);
                    } catch {
                      /* error toast handled by SoftphoneDialer ergo */
                    }
                  }}
                >
                  Devolver llamada
                </Btn>
              )}
            </div>
          </div>
        ) : isChat && activeContact ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <ChatThreadPanel
              contactId={activeContact.contactId}
              channel={activeContact.channel}
              customerName={callerName}
              channelLabel={channelLabel}
              customerPhone={activeContact.customerPhone}
              agentName={agentName || user?.username}
              queueName={activeContact.queueName}
            />
          </div>
        ) : isEmail && activeContact ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <EmailThreadPanel
              contactId={activeContact.contactId}
              customerName={callerName}
            />
          </div>
        ) : (
          <>
            <div className="call__panel-head">
              <Icon.Activity size={16} style={{ color: "var(--accent-cyan)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Transcripción en vivo · Contact Lens
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {activeContact
                    ? liveData?.totalSegments
                      ? `${liveData.totalSegments} segmentos · stream activo`
                      : "Esperando primer segmento…"
                    : "Sin contacto activo"}
                </div>
              </div>
              {liveData && liveData.totalSegments > 0 && (
                <Pill tone="cyan" icon="dot">
                  Stream
                </Pill>
              )}
              {activeContact && (
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="sparkle"
                  onClick={() => setSummaryOpen(true)}
                  title="Generar resumen de la conversación"
                >
                  Resumen
                </Btn>
              )}
            </div>

            {/* Momentos clave — hitos de Contact Lens (categorías/issues) de la
                llamada de voz. Se auto-oculta si Contact Lens aún no marcó
                ninguno (no inventa data). */}
            {activeContact && !isChat && !isEmail && !isTask && (
              <div style={{ padding: "12px 14px 0" }}>
                <MomentsPanel liveData={liveData} />
              </div>
            )}

            <div className="call__panel-body">
              {activeContact ? (
                <LiveTranscriptPanel
                  contactId={activeContact.contactId}
                  isActive={!!isActive}
                />
              ) : myLeadsCount > 0 ? (
                // Manual-mode campaigns leave the live-transcript pane
                // empty (no call yet). Use the space to surface
                // pre-assigned leads with Call / Skip buttons so the
                // agent has something actionable instead of an empty
                // state.
                <MyCampaignLeadsPanel />
              ) : (
                <EmptyPanel
                  icon={Icon.Activity}
                  title="La transcripción aparecerá aquí en vivo"
                  body="Contact Lens enviará segmentos en tiempo real cuando entre una llamada."
                />
              )}
            </div>
          </>
        )}

        {/* Asistente Q · knowledge-base search. The Coach moved to the
            right rail as a tab next to Cliente 360°, so the agent's
            transcript area is no longer pushed down by 6-block coach
            cards. The Assist panel stays here because it's small
            (single search row + N cards), and the search-then-read
            workflow benefits from being directly below the transcript
            it's reacting to. Hide for chat / email — their own panels
            already occupy the full center. */}
        {!isChat && !isEmail && (
          <div style={{ borderTop: "1px solid var(--border-1)", padding: 14 }}>
            {activeContact ? (
              <AIAssistPanel
                contactId={activeContact.contactId}
                customerPhone={activeContact.customerPhone}
                latestCustomerUtterance={latestCustomerUtterance}
              />
            ) : (
              <Card
                title="Copiloto · Asistente"
                icon="sparkle"
                accent="var(--iris)"
              >
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-2)",
                    lineHeight: 1.5,
                  }}
                >
                  Cuando entre una llamada, el copiloto generará sugerencias
                  contextuales, citas de la base de conocimiento y la siguiente
                  mejor acción a tomar.
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────
         RIGHT — Customer 360° + Coach (tabbed, always rendered)
      ────────────────────────────────────────────────────────── */}
      <div className="call__panel call__panel--v2" data-debug-component="Customer360Panel">
        {/* Pill-style tabs — Cliente · Coach. Ambos paneles quedan MONTADOS
            entre cambios para que los fetches disparados por la transcripción
            sigan corriendo. El Historial pasó a ser una sub-pestaña dentro del
            Cliente 360° (junto con Perfil/Notas/Casos). */}
        <div
          className="c360-tabs"
          style={{ margin: 0, padding: "0 10px", gap: 4 }}
        >
          <button
            type="button"
            aria-pressed={rightRailTab === "cliente"}
            onClick={() => setRightRailTab("cliente")}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <AIcon name="user" size={13} /> Cliente
          </button>
          <button
            type="button"
            aria-pressed={rightRailTab === "coach"}
            onClick={() => setRightRailTab("coach")}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <AIcon name="sparkle" size={13} /> Coach
            {coachBlockCount > 0 && (
              <span
                className={`vox-tab__badge ${coachPulse ? "coach-tab-badge--pulse" : ""}`}
              >
                {coachBlockCount}
              </span>
            )}
          </button>
          {rightRailTab === "cliente" && activeContact && (
            <div style={{ display: "flex", alignItems: "center", paddingLeft: 4 }}>
              <Customer360MoreMenu
                customerPhone={activeContact.customerPhone}
                contactId={activeContact.contactId}
                onRefreshProfile={() => setProfileRefreshKey((k) => k + 1)}
              />
            </div>
          )}
        </div>
        <div className="call__panel-body">
          {/* Cliente 360° — tabbed (Perfil · Historial · Notas · Casos),
              cada sub-pestaña cableada a su panel real. */}
          <div style={{ display: rightRailTab === "cliente" ? "block" : "none" }}>
            {activeContact ? (
              <div style={{ padding: 14 }}>
                <CustomerProfilePanel
                  phone={activeContact.customerPhone}
                  isActive={!!isActive}
                  refreshKey={profileRefreshKey}
                  contactId={activeContact.contactId}
                  agentUsername={user?.username || ""}
                />
              </div>
            ) : (
              <div className="c360">
                <CustomerBrowser />
              </div>
            )}
          </div>

          {/* Coach */}
          <div
            style={{
              display: rightRailTab === "coach" ? "block" : "none",
              padding: 14,
            }}
          >
            {!isChat && !isEmail ? (
              <AICoachPanel
                contactId={activeContact?.contactId ?? null}
                customerPhone={activeContact?.customerPhone ?? null}
                transcriptSegmentCount={liveData?.totalSegments || 0}
                isActive={!!isActive}
                sentiment={liveData?.overallSentiment}
                inline
                onBlocksChange={handleCoachBlocksChange}
              />
            ) : (
              <div
                className="muted"
                style={{ fontSize: 12.5, textAlign: "center", padding: 20 }}
              >
                El coach solo está disponible durante llamadas de voz.
              </div>
            )}
          </div>
        </div>
        <style>{`
          @keyframes coach-tab-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6); }
            50% { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0); }
          }
          .coach-tab-badge--pulse {
            animation: coach-tab-pulse 1s ease-in-out 2;
          }
        `}</style>
      </div>

      </div>
      )}
      {/* El bubble flotante de Tareas se reemplazó por el launcher global
          <TasksLauncher/> (debajo de Copilot, en App.tsx). */}
      <MissedHistoryDrawer />

      {/* Action modals — only one is visible at a time. Each is fully
          unmounted when closed (the `if (!open) return null` inside the
          component) so they don't keep listeners around. */}
      <DTMFKeypadModal open={dtmfOpen} onClose={() => setDtmfOpen(false)} />
      <TransferQueueModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        contactId={activeContact?.contactId ?? null}
        channelLabel={channelLabel.toLowerCase()}
      />
      <LiveSummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        contactId={activeContact?.contactId ?? null}
      />
      <QuickNoteModal
        open={quickNoteOpen}
        onClose={() => setQuickNoteOpen(false)}
        contactId={activeContact?.contactId ?? null}
        agentUsername={user?.username || ""}
      />
      <ConferenceModal
        open={conferenceOpen}
        onClose={() => setConferenceOpen(false)}
        contactId={activeContact?.contactId ?? null}
      />
    </div>
    </OmnichannelNotifierProvider>
  );
}
