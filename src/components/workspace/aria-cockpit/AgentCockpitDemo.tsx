/* ============================================================
   ARIA · Agent Cockpit — MODO "Vista demo"  (self-contained)
   Réplica del ViewAgent del prototipo (aria-agent.jsx) con DATA
   MOCK. Se monta SOLO cuando el toggle "Vista demo" está activo
   en el Agent Desktop; NO toca el softphone real de Amazon Connect.
   Permite VER todos los estados (idle · tareas · entrante · en
   llamada · wrap-up) sin una llamada real.

   El segmentador de estados vive en el header del Agent Desktop
   (AgentDesktopPage) y se controla vía props (`state`/`onState`)
   para mantener un solo control visible.
   ============================================================ */
import { useEffect, useState } from "react";
import { Av, Btn, Pill } from "@/components/aria";
import { AG_CONTACTS, AG_TASKS, type DemoContact } from "./mockData";
import { CTabs } from "./CTabs";
import { CallBar } from "./CallBar";
import { Transcript } from "./Transcript";
import { ChatPanel } from "./ChatPanel";
import { EmailPanel } from "./EmailPanel";
import { TaskPanel } from "./TaskPanel";
import { Cliente360 } from "./Cliente360";
import { Copiloto } from "./Copiloto";
import { CoachPanel } from "./CoachPanel";
import { Moments } from "./Moments";
import { Dialer } from "./Dialer";
import { Tareas } from "./Tareas";
import { Ring } from "./Ring";
import { Connecting } from "./Connecting";
import { WrapUp } from "./WrapUp";
import { CreateLead } from "./CreateLead";
import { CallModals, type CallModalKind } from "./CallModals";

export type DemoState = "idle" | "tareas" | "ring" | "dialing" | "active" | "wrapup";

/** Los estados que el segmentador del header expone (dialing es interno). */
export const DEMO_STATES: [DemoState, string, string][] = [
  ["idle", "Idle", "pause"],
  ["tareas", "Tareas", "check"],
  ["ring", "Entrante", "bell"],
  ["active", "En llamada", "phone"],
  ["wrapup", "Wrap-up", "check"],
];

export function AgentCockpitDemo({
  state,
  onState,
}: {
  state: DemoState;
  onState: (s: DemoState) => void;
}) {
  const [activeId, setActiveId] = useState("k1");
  const [dur, setDur] = useState(207);
  const [mute, setMute] = useState(false);
  const [hold, setHold] = useState(false);
  const [paused, setPaused] = useState(false);
  const [dialNum, setDialNum] = useState("");
  const [dialTarget, setDialTarget] = useState<DemoContact | null>(null);
  const [callModal, setCallModal] = useState<CallModalKind>(null);

  const known = AG_CONTACTS.find((c) => c.id === activeId) || AG_CONTACTS[0];
  const contact = dialTarget || known;

  useEffect(() => {
    if (state !== "active" || hold || contact.channel !== "voz") return;
    const i = setInterval(() => setDur((d) => d + 1), 1000);
    return () => clearInterval(i);
  }, [state, hold, contact]);

  const startCall = (numRaw: string) => {
    const clean = (numRaw || "").replace(/\D/g, "");
    const found = AG_CONTACTS.find((c) => c.phone.replace(/\D/g, "") === clean);
    setDialTarget(
      found || {
        id: "dial",
        name: "Contacto nuevo",
        channel: "voz",
        phone: numRaw,
        prog: "—",
        unknown: true,
        score: 0,
        stage: "Nuevo",
      }
    );
    onState("dialing");
  };

  const showTabs = (state === "active" || state === "wrapup") && !contact.unknown;

  return (
    <div className="fadeup">
      {showTabs && (
        <CTabs
          contacts={AG_CONTACTS}
          activeId={activeId}
          setActiveId={(id) => {
            setDialTarget(null);
            setActiveId(id);
          }}
        />
      )}

      {/* El idle es también el FONDO mientras suena un entrante (state="ring"):
          el <Ring> se monta encima como pop-up con overlay, igual que el real. */}
      {(state === "idle" || state === "ring") && (
        <Dialer
          num={dialNum}
          setNum={setDialNum}
          onCall={startCall}
          paused={paused}
          setPaused={setPaused}
          onTasks={() => onState("tareas")}
          tasksCount={AG_TASKS.length}
        />
      )}
      {state === "tareas" && (
        <Tareas
          onCall={(ph) => {
            setDialNum(ph);
            startCall(ph);
          }}
        />
      )}
      {state === "dialing" && (
        <Connecting
          num={contact.phone}
          name={contact.unknown ? null : contact.name}
          onCancel={() => {
            setDialTarget(null);
            onState("idle");
          }}
          onConnect={() => {
            setDur(0);
            onState("active");
          }}
        />
      )}
      {state === "ring" && (
        <Ring
          contact={known}
          onAccept={() => {
            setDialTarget(null);
            onState("active");
            setDur(0);
          }}
          onReject={() => onState("idle")}
        />
      )}
      {state === "wrapup" && (
        <WrapUp
          onDone={() => {
            setDialTarget(null);
            onState("idle");
          }}
        />
      )}
      {state === "active" && (
        <>
          {contact.channel === "voz" ? (
            <CallBar
              name={contact.name}
              phone={contact.phone}
              prog={contact.prog}
              durSeconds={dur}
              muted={mute}
              hold={hold}
              audioOn={!hold}
              onMute={() => setMute((m) => !m)}
              onHold={() => setHold((h) => !h)}
              onHome={() => onState("idle")}
              onTransfer={() => setCallModal("transfer")}
              onConference={() => setCallModal("conference")}
              onEnd={() => onState("wrapup")}
            />
          ) : (
            <ChannelBar contact={contact} onClose={() => onState("wrapup")} />
          )}
          {contact.unknown ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <CreateLead
                  phone={contact.phone}
                  onSave={(nm) => setDialTarget((t) => (t ? { ...t, unknown: false, name: nm } : t))}
                />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) clamp(280px,30%,340px)",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                <Transcript />
                <Copiloto />
              </div>
            </>
          ) : (
            <div className="agent-grid">
              <div className="col gap16">
                <Cliente360 />
                {contact.channel === "voz" && <Moments />}
              </div>
              <ChannelPanel channel={contact.channel} />
              <div className="col gap16">
                <Copiloto />
                <CoachPanel />
              </div>
            </div>
          )}
        </>
      )}
      <CallModals kind={callModal} onClose={() => setCallModal(null)} />
    </div>
  );
}

/* Panel central según el canal del contacto activo. Voz=Transcripción,
   WhatsApp=Chat, Email=hilo Gmail, Tarea=detalle. Mismo slot del
   agent-grid — NO cambia el layout. */
function ChannelPanel({ channel }: { channel: DemoContact["channel"] }) {
  if (channel === "voz") return <Transcript />;
  if (channel === "wa") return <ChatPanel />;
  if (channel === "email") return <EmailPanel />;
  return <TaskPanel />;
}

/* Barra compacta superior para canales no-voz (WhatsApp / Email /
   Tarea). Reemplaza al CallBar horizontal que solo aplica a voz.
   Reutiliza .card--pop <Av> <Pill> <Btn> — mismo patrón de la demo. */
const CH_BAR: Record<string, { icon: string; label: string; color: string; tone: "green" | "gold" | "iris"; close: string }> = {
  wa: { icon: "wa", label: "WhatsApp", color: "var(--green)", tone: "green", close: "Cerrar chat" },
  email: { icon: "mail", label: "Email", color: "var(--gold)", tone: "gold", close: "Cerrar correo" },
  tarea: { icon: "check", label: "Tarea", color: "var(--iris)", tone: "iris", close: "Cerrar tarea" },
};

function ChannelBar({ contact, onClose }: { contact: DemoContact; onClose: () => void }) {
  const m = CH_BAR[contact.channel] || CH_BAR.wa;
  return (
    <div className="card card--pop" style={{ padding: "12px 18px", marginBottom: 16 }}>
      <div className="row between wrap gap12">
        <div className="row gap12">
          <Av name={contact.name} size={42} color={m.color} />
          <div>
            <div className="row gap8" style={{ fontSize: 15, fontWeight: 700 }}>
              {contact.name}
              <Pill tone={m.tone} icon={m.icon}>
                {m.label}
              </Pill>
            </div>
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
              {contact.channel === "email" ? contact.phone : contact.prog}
            </div>
          </div>
        </div>
        <div className="row gap6">
          {contact.channel !== "tarea" && (
            <Btn variant="soft" size="sm" icon="phone">
              Llamar
            </Btn>
          )}
          <Btn variant="primary" size="sm" icon="check" onClick={onClose}>
            {m.close}
          </Btn>
        </div>
      </div>
    </div>
  );
}
