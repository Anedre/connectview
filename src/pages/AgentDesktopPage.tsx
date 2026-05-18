import { useEffect, useMemo, useRef, useState } from "react";
import { useCCP } from "@/hooks/useCCP";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useActiveContact } from "@/hooks/useActiveContact";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { CustomerProfilePanel } from "@/components/workspace/CustomerProfilePanel";
import { LiveTranscriptPanel } from "@/components/workspace/LiveTranscriptPanel";
import { ChatThreadPanel } from "@/components/workspace/ChatThreadPanel";
import { AgentNotesPanel } from "@/components/workspace/AgentNotesPanel";
import { AIAssistPanel } from "@/components/workspace/AIAssistPanel";
import { AICoachPanel } from "@/components/workspace/AICoachPanel";
import { CasesPanel } from "@/components/workspace/CasesPanel";
import { WrapUpView } from "@/components/vox/WrapUpView";
import { SoftphoneDialer } from "@/components/vox/SoftphoneDialer";
import {
  Avatar,
  colorFromName,
} from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

const STATE_STYLE: Record<string, { fg: string; bg: string; label: string }> = {
  Init:            { fg: "var(--text-3)",      bg: "var(--bg-3)",            label: "Inicio" },
  Available:       { fg: "var(--accent-green)",bg: "var(--accent-green-soft)",label: "Disponible" },
  Busy:            { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)", label: "En llamada" },
  AfterCallWork:   { fg: "var(--accent-amber)",bg: "var(--accent-amber-soft)",label: "ACW" },
  CallingCustomer: { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)", label: "Marcando" },
  Offline:         { fg: "var(--text-3)",      bg: "var(--bg-3)",             label: "Offline" },
  Error:           { fg: "var(--accent-red)",  bg: "var(--accent-red-soft)",  label: "Error" },
};

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

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
  } = useCCP();
  const { user } = useConnectAuth();
  // `rawContact` is the unfiltered streams snapshot — used only for
  // state-machine bookkeeping (capturing last-contact for the wrap-up,
  // detecting ACW). For everything UI-facing we use `activeContact`
  // below, which filters out contacts the agent already dismissed.
  const rawContact = useActiveContact();

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
  const { profile } = useCustomerProfile(rawContact?.customerPhone ?? null);
  const latestCustomerUtterance = liveData?.segments
    .filter((s) => s.participant === "CUSTOMER")
    .slice(-1)[0]?.content;

  // Call timer — only counts while the call is connected
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!rawContact || rawContact.state !== "connected") {
      return;
    }
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [rawContact?.contactId, rawContact?.state]);

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
            ? Math.max(lastContactRef.current.duration, elapsed)
            : elapsed,
      };
    }
  }, [rawContact, elapsed]);
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

  // Even after the agent dismisses the wrap-up, Streams may keep the
  // disconnected contact in the agent snapshot for ~30s. Without filtering
  // here the desktop would re-render the customer card and chat panel for
  // a ghost contact, which felt to the agent like the page "going back
  // then forward by itself". Treat dismissed contacts as if they don't
  // exist for display purposes; lastContactRef still has them for any
  // wrap-up re-entry.
  const activeContact =
    rawContact && wrapDismissedIds.has(rawContact.contactId)
      ? null
      : rawContact;

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
  if (showWrapUp && pendingWrap) {
    return (
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
    );
  }

  return (
    <div className="call">
      {/* ──────────────────────────────────────────────────────────
         LEFT — Softphone (always rendered)
      ────────────────────────────────────────────────────────── */}
      <div className="call__panel">
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
            {activeContact ? callerSecondary : `Listo · ${user?.highestRole ?? "Agente"}`}
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
              {isActive ? fmtElapsed(elapsed) : "--:--"}
            </div>
            <div className="lbl">
              {isActive ? (
                <>
                  Duración ·{" "}
                  {isChat ? (
                    <span style={{ color: "var(--accent-cyan)" }}>
                      💬 {channelLabel}
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

        {/* Voice-only controls — only render for VOICE channel. For CHAT,
            the equivalent actions (send / end) live inside the
            ChatThreadPanel composer in the center. */}
        {!isChat && !isEmail && !isTask && (
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
            <button className="softphone__btn" disabled={!isActive}>
              <Icon.Pad />
              <span>Teclado</span>
            </button>
            <button className="softphone__btn" disabled={!isActive}>
              <Icon.Transfer />
              <span>Transferir</span>
            </button>
            <button className="softphone__btn" disabled={!isActive}>
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
        )}

        {/* Chat-specific quick actions (only for CHAT contacts). */}
        {isChat && isActive && (
          <div className="softphone__controls" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <button className="softphone__btn" disabled>
              <Icon.Transfer />
              <span>Transferir</span>
            </button>
            <button className="softphone__btn" disabled>
              <Icon.Note />
              <span>Nota</span>
            </button>
          </div>
        )}

        {!activeContact && !isIncoming && <SoftphoneDialer />}

        {/* Contact Lens sentiment is voice-only — hide for chat/email/task. */}
        {!isChat && !isEmail && !isTask && (
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
                onClick={reject}
              >
                Rechazar
              </button>
              <button
                className="btn btn--success"
                style={{ flex: 1, height: 44, justifyContent: "center" }}
                onClick={accept}
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
                hangup();
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
      </div>

      {/* ──────────────────────────────────────────────────────────
         CENTER — Channel-aware: ChatThreadPanel for CHAT, LiveTranscript
         for VOICE. Hidden chrome (header / Resumen button) for chat
         since the ChatThreadPanel renders its own header.
      ────────────────────────────────────────────────────────── */}
      <div className="call__panel">
        {isChat && activeContact ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <ChatThreadPanel
              contactId={activeContact.contactId}
              channel={activeContact.channel}
              customerName={callerName}
              channelLabel={channelLabel}
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
              <button className="btn btn--ghost btn--sm" disabled={!activeContact}>
                <Icon.Send size={12} /> Resumen
              </button>
            </div>

            <div className="call__panel-body">
              {activeContact ? (
                <LiveTranscriptPanel
                  contactId={activeContact.contactId}
                  isActive={!!isActive}
                />
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
            transcript. Hide them for chat — the ChatThreadPanel above
            already occupies the full center. */}
        {!isChat && (
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
      <div className="call__panel">
        <div className="call__panel-head">
          <Icon.User size={16} />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            Cliente 360°
          </div>
          <button
            className="btn btn--ghost btn--sm btn--icon"
            disabled={!activeContact}
          >
            <Icon.More size={14} />
          </button>
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
                <EmptyPanel
                  icon={Icon.User}
                  title="Cliente 360° aparece al recibir una llamada"
                  body="Verás perfil, casos abiertos, historial omnicanal y notas internas."
                />
                <div>
                  <div className="section-title">Estado del agente</div>
                  <div
                    style={{
                      padding: 12,
                      background: "var(--bg-2)",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      className="state-dot"
                      style={{ background: stateToken.fg }}
                    />
                    <div style={{ flex: 1, fontSize: 12.5 }}>
                      <div style={{ fontWeight: 500, color: "var(--text-1)" }}>
                        {stateToken.label}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {agentName || user?.username || "Agente"} ·{" "}
                        {user?.highestRole ?? ""}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
