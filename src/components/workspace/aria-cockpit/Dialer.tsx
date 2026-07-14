/* ============================================================
   ARIA · Cockpit · Dialer (idle: marcador + cola + tareas)
   Portado de aria-agent.jsx. El diseño de 2 columnas se MANTIENE:
     · Izquierda: card "Iniciar contacto" con tabs Marcador / Buscar
       / Más acciones.
     · Derecha: Disponible/Pausar · Perdidas · Siguiente en cola ·
       Mis leads · Tareas.

   GENERALIZADO — sirve a DOS consumidores con el MISMO markup:
     • MODO DEMO (data mock, self-contained): AgentCockpitDemo.
     • IDLE REAL: AgentIdleCockpit inyecta datos/slots reales por
       props (perdidas, siguiente-en-cola, leads, buscador, acciones,
       estado Disponible/Pausar). Cada prop es opcional → sin ella se
       cae al comportamiento mock, así el demo no se rompe.
   ============================================================ */
import { useState, type ReactNode } from "react";
import { Btn, Card, Icon, Pill } from "@/components/aria";
import { CustomerSearch } from "./CustomerSearch";
import { StartContact } from "./StartContact";
import { PhonePad, type RecentNumber } from "./PhonePad";
import { MissedCalls, type MissedItem } from "./MissedCalls";
import { MyLeads, type MyLeadItem, type ReschedulePreset } from "./MyLeads";

/** Fila de "Siguiente en cola" (normalizada mock/real). */
export interface QueueRow {
  id: string;
  /** Nombre de la cola o del contacto. */
  label: string;
  /** Canal en nomenclatura demo ("voz" | "wa"). */
  channel: "voz" | "wa";
  /** Sub-etiqueta (programa / "N en espera"). */
  sub: string;
  /** Espera formateada (ej. "0:47"). */
  wait: string;
}

/** Estado Disponible/Pausar real (opcional). */
export interface AvailabilityState {
  paused: boolean;
  offline?: boolean;
  onToggle: () => void;
  label?: string;
  hint?: string;
}

const NEXT_IN_QUEUE_MOCK: QueueRow[] = [
  { id: "q1", label: "+51 987 112 004", channel: "voz", sub: "Admisión", wait: "0:47" },
  { id: "q2", label: "Sofía Quispe", channel: "wa", sub: "Verano", wait: "0:41" },
];

type LeftTab = "marcador" | "buscar";

const LEFT_TABS: [LeftTab, string][] = [
  ["marcador", "Marcador"],
  ["buscar", "Buscar"],
];

export function Dialer({
  num,
  setNum,
  onCall,
  paused,
  setPaused,
  onTasks,
  tasksCount,
  // ── Slots / datos reales (opcionales) ──
  availability,
  missedItems,
  queueRows,
  queueWaitingCount,
  leadItems,
  onLeadCall,
  onLeadSkip,
  onLeadReschedule,
  leadReschedulePresets,
  leadBusyId,
  searchSlot,
  actionsSlot,
  tasksSubtitle,
  recentNumbers,
}: {
  num: string;
  setNum: (updater: (n: string) => string) => void;
  onCall: (num: string) => void;
  paused: boolean;
  setPaused: (updater: (p: boolean) => boolean) => void;
  onTasks: () => void;
  tasksCount: number;
  /** Estado real Disponible/Pausar. Sin él, usa paused/setPaused (mock). */
  availability?: AvailabilityState;
  /** Perdidas reales. undefined = mock. */
  missedItems?: MissedItem[];
  /** Filas reales de "Siguiente en cola". undefined = mock. */
  queueRows?: QueueRow[];
  /** Total esperando (para el pill). undefined = "3 esperando" (mock). */
  queueWaitingCount?: number;
  /** Leads reales. undefined = mock. */
  leadItems?: MyLeadItem[];
  onLeadCall?: (lead: MyLeadItem) => void;
  onLeadSkip?: (lead: MyLeadItem) => void;
  onLeadReschedule?: (lead: MyLeadItem, preset: ReschedulePreset) => void;
  leadReschedulePresets?: ReschedulePreset[];
  leadBusyId?: string | null;
  /** Reemplaza el buscador mock por el real (CustomerBrowser). */
  searchSlot?: ReactNode;
  /** Reemplaza los tiles mock por el real (OutboundActionsMenu). */
  actionsSlot?: ReactNode;
  /** Sub-línea de la card de Tareas (mock: "2 vencen hoy · 1 atrasada"). */
  tasksSubtitle?: string;
  /** Recientes/frecuentes del marcador. undefined = mock (AG_RECENTS). */
  recentNumbers?: RecentNumber[];
}) {
  const [tab, setTab] = useState<LeftTab>("marcador");

  const queue = queueRows ?? NEXT_IN_QUEUE_MOCK;
  const waitingCount = queueWaitingCount ?? 3;

  // Estado Disponible/Pausar — real (availability) o mock (paused/setPaused).
  const isPaused = availability ? availability.paused : paused;
  const isOffline = availability?.offline ?? false;
  const togglePause = availability ? availability.onToggle : () => setPaused((p) => !p);
  const availLabel =
    availability?.label ?? (isPaused ? (isOffline ? "Offline" : "No disponible") : "Disponible");
  const availHint =
    availability?.hint ??
    (isPaused
      ? "En pausa · no recibes llamadas de la cola."
      : "Las llamadas entrantes de la cola suenan automáticamente.");

  return (
    <div className="dialer-gridwrap">
      <div className="dialer-grid">
        <Card title="Iniciar contacto" icon="phone">
          <div className="cop-tabs">
            {LEFT_TABS.map(([id, l]) => (
              <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
                {l}
              </button>
            ))}
          </div>
          {tab === "marcador" && (
            <div className="dialer-splitwrap">
              <div className="dialer-split">
                <div className="dialer-split__pad">
                  <PhonePad num={num} setNum={setNum} onCall={onCall} recents={recentNumbers} />
                </div>
                <div className="dialer-split__rail">
                  {actionsSlot ?? <StartContact onCall={onCall} variant="rail" />}
                </div>
              </div>
            </div>
          )}
          {tab === "buscar" && (searchSlot ?? <CustomerSearch onCall={onCall} />)}
        </Card>
        <div className="col gap16">
          <div
            className="card card__pad"
            style={{
              background: isPaused
                ? "var(--bg-1)"
                : "linear-gradient(120deg,var(--green-soft),transparent 70%)",
            }}
          >
            <div className="row between">
              <div className="row gap10">
                <span
                  className={"dot" + (isPaused ? "" : " dot--live")}
                  style={
                    isPaused
                      ? { background: isOffline ? "var(--text-3)" : "var(--gold)" }
                      : undefined
                  }
                />
                <b style={{ fontSize: 15 }}>{availLabel}</b>
              </div>
              <Btn variant={isPaused ? "primary" : "ghost"} size="sm" onClick={togglePause}>
                {isPaused ? "Reanudar" : "Pausar"}
              </Btn>
            </div>
            <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
              {availHint}
            </div>
          </div>
          <MissedCalls onCall={onCall} items={missedItems} />
          <Card
            title="Siguiente en cola"
            icon="live"
            extra={
              waitingCount > 0 ? (
                <Pill tone="green" icon="dot">
                  {waitingCount} esperando
                </Pill>
              ) : (
                <Pill tone="outline">Cola vacía</Pill>
              )
            }
          >
            {queue.length > 0 ? (
              <div className="col gap8">
                {queue.map((n) => (
                  <div
                    key={n.id}
                    className="row between"
                    style={{
                      padding: "10px 12px",
                      borderRadius: "var(--r-sm)",
                      background: "var(--bg-2)",
                    }}
                  >
                    <span className="row gap10" style={{ minWidth: 0 }}>
                      <span className={"chdot chdot--" + n.channel} />
                      <b className="truncate" style={{ fontSize: 13, maxWidth: 150 }}>
                        {n.label}
                      </b>
                      <span className="dim" style={{ fontSize: 11.5 }}>
                        · {n.sub}
                      </span>
                    </span>
                    <span className="mono dim" style={{ fontSize: 12 }}>
                      {n.wait}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dim" style={{ fontSize: 12.5, padding: "6px 2px", lineHeight: 1.5 }}>
                No hay contactos esperando en cola ahora mismo. Los entrantes sonarán
                automáticamente cuando lleguen.
              </div>
            )}
          </Card>
          <MyLeads
            onCall={(l) => {
              // Real: onLeadCall(lead). Mock: onCall(phone).
              if (leadItems && onLeadCall && typeof l !== "string") onLeadCall(l);
              else if (typeof l === "string") onCall(l);
            }}
            items={leadItems}
            onSkip={onLeadSkip}
            onReschedule={onLeadReschedule}
            reschedulePresets={leadReschedulePresets}
            busyId={leadBusyId}
          />
          <button
            type="button"
            className="card card__pad"
            onClick={onTasks}
            style={{
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div className="tl__ico" style={{ ["--_c" as string]: "var(--coral)" }}>
              <Icon name="check" size={16} />
            </div>
            <div className="grow">
              <b style={{ fontSize: 13.5 }}>
                Tienes {tasksCount} {tasksCount === 1 ? "tarea" : "tareas"}
              </b>
              <div className="dim" style={{ fontSize: 12 }}>
                {tasksSubtitle ?? "2 vencen hoy · 1 atrasada"}
              </div>
            </div>
            <Icon name="chevR" size={16} style={{ color: "var(--text-3)" }} />
          </button>
        </div>
      </div>
    </div>
  );
}
