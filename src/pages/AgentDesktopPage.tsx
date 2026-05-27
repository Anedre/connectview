import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useCCP } from "@/hooks/useCCP";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { roleLabelOf } from "@/types/auth";
import { useActiveContact } from "@/hooks/useActiveContact";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { useDebugRender, traceChange } from "@/lib/debugTrace";
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
import { AgentNotesPanel } from "@/components/workspace/AgentNotesPanel";
import { AIAssistPanel } from "@/components/workspace/AIAssistPanel";
import { AICoachPanel } from "@/components/workspace/AICoachPanel";
import { CasesPanel } from "@/components/workspace/CasesPanel";
import { DTMFKeypadModal } from "@/components/workspace/DTMFKeypadModal";
import { TransferQueueModal } from "@/components/workspace/TransferQueueModal";
import { Customer360MoreMenu } from "@/components/workspace/Customer360MoreMenu";
import { LiveSummaryModal } from "@/components/workspace/LiveSummaryModal";
import { QuickNoteModal } from "@/components/workspace/QuickNoteModal";
import { OutboundActionsMenu } from "@/components/workspace/OutboundActionsMenu";
import { CustomerBrowser } from "@/components/workspace/CustomerBrowser";
import { ScheduleCallbackModal } from "@/components/workspace/ScheduleCallbackModal";
import { CallbackHistoryDrawer } from "@/components/workspace/CallbackHistoryDrawer";
import { WrapUpView } from "@/components/vox/WrapUpView";
import {
  Avatar,
  colorFromName,
} from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

const STATE_STYLE: Record<string, { fg: string; bg: string; label: string }> = {
  Init:             { fg: "var(--text-3)",      bg: "var(--bg-3)",             label: "Inicio" },
  Available:        { fg: "var(--accent-green)",bg: "var(--accent-green-soft)",label: "Disponible" },
  Busy:             { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)", label: "En llamada" },
  AfterCallWork:    { fg: "var(--accent-amber)",bg: "var(--accent-amber-soft)",label: "ACW" },
  CallingCustomer:  { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)", label: "Marcando" },
  Offline:          { fg: "var(--text-3)",      bg: "var(--bg-3)",             label: "Offline" },
  Error:            { fg: "var(--accent-red)",  bg: "var(--accent-red-soft)",  label: "Error" },
  // Connect moves the agent into one of these state names after a
  // missed routed contact. They all mean "blocked from receiving new
  // contacts until the agent manually returns to Available."
  MissedCallAgent:  { fg: "var(--accent-red)",  bg: "var(--accent-red-soft)",  label: "Contacto perdido" },
  MissedCall:       { fg: "var(--accent-red)",  bg: "var(--accent-red-soft)",  label: "Contacto perdido" },
  "Missed Call Agent": { fg: "var(--accent-red)", bg: "var(--accent-red-soft)", label: "Contacto perdido" },
};

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
  onTick,
}: {
  active: boolean;
  resetKey: string;
  /** Wall-clock ms when the contact CONNECTED. If provided, elapsed
   *  is derived as `floor((now - startedAtMs) / 1000)` so switching
   *  tabs doesn't reset the displayed time. */
  startedAtMs?: number | null;
  onTick?: React.MutableRefObject<number>;
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
      if (onTick) onTick.current = 0;
      return;
    }
    const initial =
      startedAtMs && startedAtMs > 0
        ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
        : 0;
    setElapsed(initial);
    if (onTick) onTick.current = initial;
    const id = setInterval(() => {
      setElapsed(() => {
        const next =
          startedAtMs && startedAtMs > 0
            ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
            : 0;
        if (onTick) onTick.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey, startedAtMs, onTick]);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  // "📅 Agendar callback" — agent promises to call the customer back at a
  // future time. Submits to schedule-callback Lambda; the dispatcher
  // Lambda fires the outbound call at the agreed time.
  const [scheduleCallbackOpen, setScheduleCallbackOpen] = useState(false);
  // Bumped each time the modal successfully schedules a callback so
  // the drawer below re-fetches without waiting for the next 60s poll.
  const [callbackRefreshKey, setCallbackRefreshKey] = useState(0);

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
  const stateToken = STATE_STYLE[agentState] ?? STATE_STYLE.Init;

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

  // Caller display
  const profileFullName =
    profile?.businessName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
    null;
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

  if (showWrapUp && pendingWrap) {
    return (
      <OmnichannelNotifierProvider>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
      <MissedCallBanner />
      <ActiveContactsTabStrip />
      <div className="call" style={{ flex: 1, minHeight: 0 }}>
      {/* ──────────────────────────────────────────────────────────
         LEFT — Softphone (always rendered)
      ────────────────────────────────────────────────────────── */}
      <div className="call__panel" data-debug-component="SoftphonePanel">
        <div className="softphone__caller">
          <Avatar
            name={activeContact ? callerName : agentName || user?.username || "Agente"}
            size="lg"
            color={
              activeContact ? callerAvatarColor : colorFromName(agentName || user?.username || "Vox")
            }
          />
          <div className="softphone__name">
            {activeContact ? callerName : agentName || user?.username || "Agente"}
          </div>
          <div className="softphone__num mono">
            {activeContact ? callerSecondary : `Listo · ${roleLabelOf(user?.highestRole)}`}
          </div>
          <div
            className="row"
            style={{ gap: 6, marginTop: 4, flexWrap: "wrap", justifyContent: "center" }}
          >
            {profileAccountType && (
              <span className="chip chip--violet">{profileAccountType}</span>
            )}
            <span
              className="chip"
              style={{
                background: stateToken.bg,
                color: stateToken.fg,
                borderColor: "transparent",
              }}
            >
              <span className="dot" /> {stateToken.label}
            </span>
          </div>
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <div className="softphone__timer">
              <CallTimer
                active={isConnected}
                resetKey={rawContact?.contactId || ""}
                startedAtMs={rawContact?.connectedAtMs ?? null}
                onTick={elapsedRef}
              />
            </div>
            <div className="lbl">
              {isActive ? (
                <>
                  Duración ·{" "}
                  {isChat ? (
                    <span style={{ color: "var(--accent-cyan)" }}>
                      💬 {channelLabel}
                    </span>
                  ) : isEmail ? (
                    <span style={{ color: "var(--accent-amber)" }}>
                      📧 {channelLabel}
                    </span>
                  ) : isTask ? (
                    <span style={{ color: "var(--accent-violet)" }}>
                      📋 {channelLabel}
                    </span>
                  ) : recording ? (
                    <span style={{ color: "var(--accent-red)" }}>● Grabando</span>
                  ) : (
                    <span className="muted">Sin grabación</span>
                  )}
                </>
              ) : isIncoming ? (
                <span style={{ color: "var(--accent-green)" }}>
                  {isChat ? `${channelLabel} entrante` : "Llamada entrante"}
                </span>
              ) : isDialing ? (
                <span style={{ color: "var(--accent-cyan)" }}>Marcando…</span>
              ) : (
                <span className="muted">
                  {activeContact
                    ? `Sin ${channelLabel.toLowerCase()} activo`
                    : "Sin contacto activo"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Voice-only controls — only render for VOICE channel AND when
            there's an active contact. We deliberately don't show a
            "ghost" toolbar of disabled Mute/Hold/Teclado buttons when
            there's no call — that read as broken UI. The dialer takes
            over the same vertical space instead. CHAT controls live
            inside the ChatThreadPanel composer in the center. */}
        {!isChat && !isEmail && !isTask && !!activeContact && (
          <>
            <div className="softphone__controls">
              <button
                className={`softphone__btn ${muted ? "softphone__btn--on" : ""}`}
                onClick={() => mute()}
                disabled={!isActive}
              >
                {muted ? <Icon.MicOff /> : <Icon.Mic />}
                <span>{muted ? "Mute on" : "Mute"}</span>
              </button>
              <button
                className={`softphone__btn ${onHold ? "softphone__btn--on" : ""}`}
                onClick={() => toggleHold()}
                disabled={!isActive}
              >
                <Icon.Pause />
                <span>{onHold ? "En espera" : "Espera"}</span>
              </button>
              <button
                className={`softphone__btn ${dtmfOpen ? "softphone__btn--on" : ""}`}
                onClick={() => setDtmfOpen(true)}
                disabled={!isActive}
                title="Enviar tonos DTMF (0-9, *, #)"
              >
                <Icon.Pad />
                <span>Teclado</span>
              </button>
              <button
                className="softphone__btn"
                onClick={() => setTransferOpen(true)}
                disabled={!isActive}
                title="Transferir a otra cola"
              >
                <Icon.Transfer />
                <span>Transferir</span>
              </button>
              <button
                className="softphone__btn"
                disabled
                title="Conferencia · próximamente"
                aria-disabled="true"
              >
                <Icon.Users />
                <span>Conferencia</span>
              </button>
              <button
                className={`softphone__btn ${recording ? "softphone__btn--on" : ""}`}
                onClick={toggleRecording}
                disabled={!isActive}
              >
                <Icon.Record />
                <span>{recording ? "Grabando" : "Pausada"}</span>
              </button>
            </div>
            {/* Schedule callback — full-width prominent action below the
                voice controls. Available during an active voice call so
                the agent can promise to call back at a future time
                without leaving the call. */}
            {activeContact?.customerPhone && (
              <div style={{ padding: "0 14px 14px" }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setScheduleCallbackOpen(true)}
                  disabled={!isActive}
                  style={{
                    width: "100%",
                    height: 38,
                    justifyContent: "center",
                    fontSize: 12.5,
                  }}
                  title="Prometer un follow-up para más tarde (llamada / email / WhatsApp)"
                >
                  📅 Agendar follow-up
                </button>
              </div>
            )}
          </>
        )}

        {/* Chat-specific quick actions (only for CHAT contacts). */}
        {isChat && isActive && (
          <>
            <div className="softphone__controls" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button
                className="softphone__btn"
                onClick={() => setTransferOpen(true)}
                title="Transferir el chat a otra cola"
              >
                <Icon.Transfer />
                <span>Transferir</span>
              </button>
              <button
                className="softphone__btn"
                onClick={() => setQuickNoteOpen(true)}
                title="Añadir nota rápida"
              >
                <Icon.Note />
                <span>Nota</span>
              </button>
            </div>
            {/* Agenda callback also from chat — common when a WhatsApp
                lead asks "¿me llaman más tarde?". Needs a phone, which
                the chat contact may not always carry (e.g. webchat) so
                we hide it when there's none. */}
            {activeContact?.customerPhone && (
              <div style={{ padding: "0 14px 14px" }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setScheduleCallbackOpen(true)}
                  style={{
                    width: "100%",
                    height: 38,
                    justifyContent: "center",
                    fontSize: 12.5,
                  }}
                  title="Prometer un follow-up para más tarde"
                >
                  📅 Agendar follow-up
                </button>
              </div>
            )}
          </>
        )}

        {!activeContact && !isIncoming && (
          <>
            {/* Empty-state hint above the outbound actions menu — gives
                the column a clear purpose when there's no call: "this
                is where you start one". The pill buttons below mirror
                the native Amazon Connect CCP outbound menu. */}
            <div
              style={{
                padding: "12px 14px 0",
                fontSize: 11.5,
                color: "var(--text-3)",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {agentState === "Available"
                ? "Listo para recibir contactos · inicia uno manualmente abajo"
                : agentState === "Offline"
                ? "Cambia tu estado a Available para recibir contactos"
                : "Sin contacto activo"}
            </div>
            <OutboundActionsMenu />
          </>
        )}

        {/* Contact Lens sentiment — voice-only, and only while there's
            an active contact. Without a call there's nothing to score,
            so showing an empty "Aparecerá cuando…" placeholder reads as
            dead chrome. */}
        {!isChat && !isEmail && !isTask && !!activeContact && (
        <div style={{ padding: 14, borderTop: "1px solid var(--border-1)" }}>
          <div className="section-title">Sentiment en vivo</div>
          {sentTotal > 0 && (sentimentCounts.pos + sentimentCounts.neu + sentimentCounts.neg) > 0 ? (
            <>
              <div className="sentiment-bar">
                <div className="pos" style={{ width: `${(sentimentCounts.pos / sentTotal) * 100}%` }} />
                <div className="neu" style={{ width: `${(sentimentCounts.neu / sentTotal) * 100}%` }} />
                <div className="neg" style={{ width: `${(sentimentCounts.neg / sentTotal) * 100}%` }} />
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--accent-green)" }}>
                  ● Pos {sentimentCounts.pos}
                </span>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  ● Neu {sentimentCounts.neu}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--accent-red)" }}>
                  ● Neg {sentimentCounts.neg}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                Score actual:{" "}
                <span
                  className="mono"
                  style={{
                    color:
                      sentScore > 0.1
                        ? "var(--accent-green)"
                        : sentScore < -0.1
                        ? "var(--accent-red)"
                        : "var(--text-2)",
                  }}
                >
                  {sentScore >= 0 ? "+" : ""}
                  {sentScore.toFixed(2)}
                </span>
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 11.5 }}>
              Aparecerá cuando Contact Lens detecte segmentos.
            </div>
          )}
        </div>
        )}

        {/* Bottom action bar — only render when there's an actual
            contact to act on. If the agent has nothing going, the
            dialer above is the affordance to start something; a
            standalone disabled "Colgar llamada" button at the bottom
            was misleading. */}
        {(isIncoming || !!activeContact) && (
        <div
          style={{
            marginTop: "auto",
            padding: 14,
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            gap: 8,
          }}
        >
          {isIncoming ? (
            <>
              <button
                className="btn btn--danger"
                style={{ flex: 1, height: 44, justifyContent: "center" }}
                onClick={() => reject(activeContact?.contactId)}
              >
                Rechazar
              </button>
              <button
                className="btn btn--success"
                style={{ flex: 1, height: 44, justifyContent: "center" }}
                onClick={() => accept(activeContact?.contactId)}
              >
                <Icon.PhoneIn size={14} /> Atender
              </button>
            </>
          ) : (
            <button
              className="btn btn--danger"
              style={{ width: "100%", height: 44, justifyContent: "center" }}
              onClick={() => {
                // For chat we can also be stuck in "connecting" with a stale
                // contact (e.g. server-side stop-contact already happened).
                // hangup() still works, plus we dismiss locally so the panel
                // doesn't keep showing the ghost contact.
                hangup(activeContact?.contactId);
                if (isChat && activeContact?.contactId) {
                  dismissWrap(activeContact.contactId);
                }
              }}
              // For chat / email / task, enable the end button whenever
              // there is a contact at all (not only when connected) so the
              // agent can always exit a stuck wire-up.
              disabled={
                isChat || isEmail || isTask
                  ? !activeContact
                  : !isActive && !isDialing
              }
            >
              <Icon.Hangup size={14} />{" "}
              {isDialing
                ? "Cancelar marcado"
                : isChat
                ? "Finalizar chat"
                : isEmail
                ? "Cerrar email"
                : isTask
                ? "Cerrar tarea"
                : "Colgar llamada"}
            </button>
          )}
        </div>
        )}
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
              <button
                type="button"
                className="btn btn--danger"
                style={{ minHeight: 38, padding: "0 16px" }}
                onClick={() => hangup(activeContact.contactId)}
              >
                <Icon.Hangup size={13} /> Cerrar contacto
              </button>
              {channelKey === "VOICE" && activeContact.customerPhone && (
                <button
                  type="button"
                  className="btn btn--success"
                  style={{ minHeight: 38, padding: "0 16px" }}
                  onClick={async () => {
                    try {
                      await placeCall(activeContact.customerPhone!);
                    } catch {
                      /* error toast handled by SoftphoneDialer ergo */
                    }
                  }}
                >
                  <Icon.PhoneIn size={13} /> Devolver llamada
                </button>
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
                <span className="chip chip--cyan">
                  <span
                    className="pulse"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "currentColor",
                    }}
                  />
                  Stream
                </span>
              )}
              {activeContact && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setSummaryOpen(true)}
                  title="Generar resumen de la conversación"
                >
                  <Icon.Send size={12} /> Resumen
                </button>
              )}
            </div>

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

        {/* AI panels (Coach + Assist) rely on the Contact Lens voice
            transcript. Hide them for chat AND email — their own panels
            already occupy the full center, and Q has nothing useful
            to add to an email thread anyway. */}
        {!isChat && !isEmail && (
          <div style={{ borderTop: "1px solid var(--border-1)", padding: 14 }}>
            {activeContact ? (
              <>
                <AICoachPanel
                  contactId={activeContact.contactId}
                  transcriptSegmentCount={liveData?.totalSegments || 0}
                  isActive={!!isActive}
                  sentiment={liveData?.overallSentiment}
                />
                <div style={{ height: 10 }} />
                <AIAssistPanel
                  contactId={activeContact.contactId}
                  customerPhone={activeContact.customerPhone}
                  latestCustomerUtterance={latestCustomerUtterance}
                />
              </>
            ) : (
              <div className="q-card">
                <div className="q-card__head">
                  <Icon.Sparkles size={14} /> Amazon Q · Asistente
                </div>
                <div className="q-card__body">
                  Cuando entre una llamada, Q generará sugerencias contextuales, citas
                  de la base de conocimiento y la siguiente mejor acción a tomar.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────
         RIGHT — Customer 360° (always rendered)
      ────────────────────────────────────────────────────────── */}
      <div className="call__panel" data-debug-component="Customer360Panel">
        <div className="call__panel-head">
          <Icon.User size={16} />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            Cliente 360°
          </div>
          {activeContact && (
            <Customer360MoreMenu
              customerPhone={activeContact.customerPhone}
              contactId={activeContact.contactId}
              onRefreshProfile={() => setProfileRefreshKey((k) => k + 1)}
            />
          )}
        </div>
        <div className="call__panel-body">
          <div className="c360">
            {activeContact ? (
              <>
                {/* The Vox-style 360° panel: hero + 2x2 stats + contacto +
                    productos (si hay attribute) + interacciones recientes
                    timeline. */}
                <CustomerProfilePanel
                  phone={activeContact.customerPhone}
                  isActive={!!isActive}
                  refreshKey={profileRefreshKey}
                />

                <div>
                  <div className="section-title">Casos · Amazon Connect</div>
                  <CasesPanel
                    contactId={activeContact.contactId}
                    customerPhone={activeContact.customerPhone}
                  />
                </div>

                <div>
                  <div className="section-title">Notas del agente</div>
                  <AgentNotesPanel
                    contactId={activeContact.contactId}
                    agentUsername={user?.username || ""}
                  />
                </div>
              </>
            ) : (
              <>
                {/* Idle browser: when there's no active contact the agent
                    can still search Connect Customer Profiles by phone /
                    email / name, view a profile, and edit its fields.
                    Keeps the right column useful between calls instead
                    of showing a static "aparece al recibir una llamada"
                    placeholder. */}
                <CustomerBrowser />
              </>
            )}
          </div>
        </div>
      </div>

      </div>
      <CallbackHistoryDrawer refreshKey={callbackRefreshKey} />
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
      <ScheduleCallbackModal
        open={scheduleCallbackOpen}
        onClose={() => setScheduleCallbackOpen(false)}
        phone={activeContact?.customerPhone ?? null}
        customerName={callerName}
        assignedAgentUserId={user?.userId || ""}
        onScheduled={() => setCallbackRefreshKey((k) => k + 1)}
      />
    </div>
    </OmnichannelNotifierProvider>
  );
}
