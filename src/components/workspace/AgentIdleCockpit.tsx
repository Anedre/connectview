import { useState } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { useMyCampaignLeads, type MyLead } from "@/hooks/useMyCampaignLeads";
import { useMissedContactsHistory } from "@/hooks/useMissedContactsHistory";
import { useCallbacks } from "@/hooks/useCallbacks";
import { useCustomerNamesByPhone } from "@/hooks/useCustomerNamesByPhone";
import { CustomerBrowser } from "@/components/workspace/CustomerBrowser";
import { OutboundActionsMenu } from "@/components/workspace/OutboundActionsMenu";
import {
  Dialer,
  type QueueRow,
  type AvailabilityState,
} from "@/components/workspace/aria-cockpit/Dialer";
import type { MissedItem } from "@/components/workspace/aria-cockpit/MissedCalls";
import type { RecentNumber } from "@/components/workspace/aria-cockpit/PhonePad";
import type {
  MyLeadItem,
  ReschedulePreset,
} from "@/components/workspace/aria-cockpit/MyLeads";

/* Historial ligero de números marcados (recientes del marcador). Vive en
   localStorage para sobrevivir recargas; se muestra como chips de acceso
   rápido en el PhonePad. Dato 100% real (los números que ESTE agente marcó). */
const RECENT_DIALS_KEY = "vox.agentDesktop.recentDials";
const RECENT_DIALS_MAX = 8;

interface RecentDial {
  phone: string;
  at: number;
}

function readRecentDials(): RecentDial[] {
  try {
    const raw = localStorage.getItem(RECENT_DIALS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((d) => d && typeof d.phone === "string" && typeof d.at === "number")
      .slice(0, RECENT_DIALS_MAX);
  } catch {
    return [];
  }
}

function pushRecentDial(prev: RecentDial[], phone: string): RecentDial[] {
  const norm = phone.replace(/\D/g, "");
  if (norm.length < 6) return prev;
  const deduped = prev.filter((d) => d.phone.replace(/\D/g, "") !== norm);
  const next = [{ phone, at: Date.now() }, ...deduped].slice(0, RECENT_DIALS_MAX);
  try {
    localStorage.setItem(RECENT_DIALS_KEY, JSON.stringify(next));
  } catch {
    /* almacenamiento lleno / bloqueado — no es crítico */
  }
  return next;
}

/**
 * IDLE cockpit — cabina estilo handoff ARIA cuando NO hay contacto activo.
 *
 * Alinea la REAL al diseño-objetivo del `Dialer` de la "Vista demo":
 * card "Iniciar contacto" con pestañas Marcador / Buscar / Más acciones a
 * la izquierda, y a la derecha Disponible/Pausar · Llamadas perdidas ·
 * Siguiente en cola · Mis leads pre-asignados · Tareas.
 *
 * El MISMO componente <Dialer> sirve al demo (mock por defecto) y a la
 * real: aquí le inyectamos DATOS y SLOTS reales por props:
 *   • Disponible/Pausar → useCCP (agentState + availableStates +
 *     changeAgentState). Idéntico a la lógica anterior.
 *   • Perdidas          → useMissedContactsHistory (SearchContacts API).
 *   • Siguiente en cola  → useRealtimeMetrics (contactos + espera).
 *   • Mis leads          → useMyCampaignLeads (call/skip/reschedule reales
 *     + placeCall del CCP).
 *   • Buscar             → CustomerBrowser real (Connect Customer Profiles).
 *   • Más acciones       → OutboundActionsMenu real (Quick connects /
 *     Capturar lead / Tarea / Email).
 *   • Tareas             → useCallbacks (conteo real; el detalle vive en el
 *     launcher global <TasksLauncher/>).
 *
 * NO toca la lógica del softphone: no acepta/cuelga/silencia; sólo compone
 * los mismos hooks reales en la presentación premium.
 */

function fmtWait(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtAgo(seconds: number): string {
  if (seconds < 60) return `hace ${Math.max(0, seconds)}s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86400)} días`;
}

/** Canal Connect (VOICE/CHAT/EMAIL) → nomenclatura demo (voz/wa/email). */
function demoChannel(channel: string): "voz" | "wa" | "email" {
  const k = (channel || "VOICE").toUpperCase();
  if (k === "CHAT") return "wa";
  if (k === "EMAIL") return "email";
  return "voz";
}

// Presets de reagendado — label + ms (para calcular nextRetryAt real).
const RESCHEDULE_PRESETS: ReschedulePreset[] = [
  { label: "+30 min", ms: 30 * 60 * 1000 },
  { label: "+1 h", ms: 60 * 60 * 1000 },
  { label: "+3 h", ms: 3 * 60 * 60 * 1000 },
  { label: "+1 día", ms: 24 * 60 * 60 * 1000 },
];

export function AgentIdleCockpit({
  onOpenLeads,
}: {
  /** Retrocompat — el diseño anterior lo usaba para saltar al panel de
   *  leads. Con el nuevo cockpit los leads ya viven inline en la card
   *  "Mis leads"; se mantiene la prop por si el host quiere reaccionar. */
  onOpenLeads?: () => void;
}) {
  const { agentState, availableStates, changeAgentState, placeCall } = useCCP();
  const { metrics } = useRealtimeMetrics();
  const {
    leads: myLeads,
    callLead,
    skipLead,
    rescheduleLead,
    refresh: refreshLeads,
  } = useMyCampaignLeads(5000);
  const { records: missedRecords } = useMissedContactsHistory({
    hours: 24,
    limit: 50,
    pollIntervalSec: 90,
  });
  const { callbacks } = useCallbacks({ status: "PENDING", pollIntervalSec: 60 });

  // Marcador (número tecleado) — placeCall real al pulsar Llamar.
  const [num, setNum] = useState("");
  const [leadBusyId, setLeadBusyId] = useState<string | null>(null);
  const [recentDials, setRecentDials] = useState<RecentDial[]>(readRecentDials);

  const isAvailable = agentState === "Available";
  const isOffline = agentState === "Offline" || agentState === "Init";
  const canDial =
    agentState === "Available" ||
    agentState === "Busy" ||
    agentState === "AfterCallWork";

  // ── Disponible / Pausar (idéntico a la lógica anterior) ──────────
  const availableTarget = availableStates.find((s) => s.name === "Available");
  // Estado de pausa "no disponible": el primer estado de pausa reconocible
  // que el perfil ofrezca; si no hay ninguno, el primer no-routable. Cálculo
  // directo (el React Compiler lo memoiza; useMemo con for-loop rompía el gate).
  const pauseTarget =
    ["Break", "Pausa", "Lunch", "Almuerzo", "Offline"]
      .map((name) => availableStates.find((s) => s.name === name))
      .find(Boolean) ||
    availableStates.find((s) => s.type !== "routable" && s.name !== "Available");

  const setAvailable = () => {
    if (!availableTarget) {
      toast.error("Estado 'Available' no disponible en este perfil");
      return;
    }
    try {
      changeAgentState(availableTarget);
      toast.success("De vuelta a Disponible");
    } catch {
      /* CCPContext muestra su propio toast */
    }
  };
  const setPausedReal = () => {
    if (!pauseTarget) {
      toast.error("Tu perfil no tiene un estado de pausa configurado");
      return;
    }
    try {
      changeAgentState(pauseTarget);
      toast.success("En pausa · no recibes contactos de la cola");
    } catch {
      /* CCPContext muestra su propio toast */
    }
  };

  const availability: AvailabilityState = {
    paused: !isAvailable,
    offline: isOffline,
    onToggle: isAvailable ? setPausedReal : setAvailable,
    label: isAvailable ? "Disponible" : isOffline ? "Offline" : "No disponible",
    hint: isAvailable
      ? "Las llamadas entrantes de la cola suenan automáticamente."
      : isOffline
      ? "Estás offline · ponte Disponible para recibir contactos."
      : "En pausa · no recibes llamadas de la cola.",
  };

  // ── Marcador: placeCall real ─────────────────────────────────────
  const handleDial = async (raw: string) => {
    const target = (raw || "").trim();
    if (!target) return;
    if (!canDial) {
      toast.error("Cambia a Available antes de marcar.");
      return;
    }
    try {
      await placeCall(target);
      setRecentDials((prev) => pushRecentDial(prev, target));
      setNum("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo iniciar la llamada");
    }
  };

  // Recientes del marcador (números que este agente marcó). Resolvemos el
  // NOMBRE por teléfono (Customer Profiles) para mostrarlo en vez del número;
  // el "hace…" se calcula al vuelo desde el timestamp guardado.
  const dialNames = useCustomerNamesByPhone(recentDials.map((d) => d.phone));
  const recentNumbers: RecentNumber[] = recentDials.map((d, i) => ({
    id: `dial-${i}-${d.at}`,
    name: dialNames[d.phone] || undefined,
    phone: d.phone,
    channel: "voz",
    ago: fmtAgo(Math.max(0, Math.floor((Date.now() - d.at) / 1000))),
  }));

  // ── Siguiente en cola (datos reales) ─────────────────────────────
  const queues = metrics?.queues ?? [];
  const queueRows: QueueRow[] = queues
    .filter((q) => q.contactsInQueue > 0)
    .sort((a, b) => b.oldestContactAge - a.oldestContactAge)
    .slice(0, 3)
    .map((q) => ({
      id: q.queueId,
      label: q.queueName,
      channel: "voz" as const,
      sub: `${q.contactsInQueue} en espera`,
      wait: fmtWait(q.oldestContactAge),
    }));
  const totalInQueue = metrics?.summary.totalContactsInQueue ?? 0;

  // ── Perdidas (datos reales) ──────────────────────────────────────
  const missedItems: MissedItem[] = missedRecords.map((r) => {
    const isVoice = r.channel.toUpperCase() === "VOICE";
    return {
      id: r.contactId,
      name: r.customerEndpoint || "Contacto",
      phone: r.customerEndpoint || "—",
      channel: demoChannel(r.channel),
      prog: r.queueName || "Sin cola",
      ago: fmtAgo(r.ageSeconds),
      reason: r.disconnectReason || "",
      canRetry: isVoice && !!r.customerEndpoint,
    };
  });

  // Nota: "Reintentar" una perdida usa el mismo `onCall` del marcador
  // (handleDial → placeCall), así que no necesita un handler aparte.

  // ── Mis leads pre-asignados (datos + acciones reales) ────────────
  const leadItems: MyLeadItem[] = myLeads.map((l) => {
    const tags = Object.entries(l.attributes)
      .filter(([k]) => !k.startsWith("_") && k !== "campaignRowId")
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 24)}`);
    return {
      id: l.rowId,
      name: l.customerName || "(Sin nombre)",
      phone: l.phone,
      campaign: l.campaignName,
      tags,
    };
  });

  const leadByRowId = (rowId: string): MyLead | undefined =>
    myLeads.find((l) => l.rowId === rowId);

  const handleLeadCall = async (item: MyLeadItem) => {
    const lead = leadByRowId(item.id);
    if (!lead || leadBusyId) return;
    if (!canDial) {
      toast.error("Cambia a Available antes de marcar.");
      return;
    }
    setLeadBusyId(item.id);
    try {
      const phone = await callLead(lead);
      if (!phone) throw new Error("Sin teléfono");
      await placeCall(phone);
      toast.success(`Marcando a ${lead.customerName || phone}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error marcando lead");
    } finally {
      setLeadBusyId(null);
      refreshLeads();
    }
  };

  const handleLeadSkip = async (item: MyLeadItem) => {
    const lead = leadByRowId(item.id);
    if (!lead || leadBusyId) return;
    setLeadBusyId(item.id);
    try {
      await skipLead(lead, "agent-skipped");
      toast.success("Lead saltado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error saltando");
    } finally {
      setLeadBusyId(null);
    }
  };

  const handleLeadReschedule = async (item: MyLeadItem, preset: ReschedulePreset) => {
    const lead = leadByRowId(item.id);
    if (!lead || leadBusyId || !preset.ms) return;
    setLeadBusyId(item.id);
    try {
      const nextRetryAt = new Date(Date.now() + preset.ms).toISOString();
      await rescheduleLead(lead, nextRetryAt);
      toast.success("Lead reagendado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error reagendando");
    } finally {
      setLeadBusyId(null);
    }
  };

  // ── Tareas (conteo real; el detalle vive en el launcher global) ──
  const tasksCount = callbacks.length;
  const tasksDue = callbacks.filter((c) => c.status === "DUE").length;
  const tasksSubtitle =
    tasksCount === 0
      ? "Sin tareas pendientes"
      : tasksDue > 0
      ? `${tasksDue} ${tasksDue === 1 ? "vence" : "vencen"} ahora`
      : "Pendientes de seguimiento";

  return (
    <div style={{ padding: "4px 14px 16px" }}>
      <Dialer
        num={num}
        setNum={(updater) => setNum((n) => updater(n))}
        onCall={handleDial}
        // paused/setPaused sólo alimentan el modo mock; en la real el estado
        // Disponible/Pausar llega por `availability`. Pasamos no-ops seguros.
        paused={!isAvailable}
        setPaused={() => {}}
        availability={availability}
        onTasks={() => {
          onOpenLeads?.();
          toast.info(
            tasksCount > 0
              ? "Abre Tareas (pill inferior) para ver el detalle."
              : "No tienes tareas pendientes."
          );
        }}
        tasksCount={tasksCount}
        tasksSubtitle={tasksSubtitle}
        recentNumbers={recentNumbers}
        missedItems={missedItems}
        queueRows={queueRows}
        queueWaitingCount={totalInQueue}
        leadItems={leadItems}
        onLeadCall={handleLeadCall}
        onLeadSkip={handleLeadSkip}
        onLeadReschedule={handleLeadReschedule}
        leadReschedulePresets={RESCHEDULE_PRESETS}
        leadBusyId={leadBusyId}
        searchSlot={<CustomerBrowser />}
        actionsSlot={<OutboundActionsMenu hideTitle variant="rail" />}
      />
    </div>
  );
}
