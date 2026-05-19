import { motion } from "framer-motion";
import {
  Clock,
  Phone,
  PhoneCall,
  CheckCircle2,
  PhoneOff,
  XCircle,
  HelpCircle,
} from "lucide-react";
import type { ContactJourney as JourneyData } from "@/hooks/useCampaignActivity";
import type { CampaignContactRow } from "@/hooks/useCampaignContacts";

interface Props {
  journey: JourneyData;
  /** When compact, the timeline shrinks to a single horizontal strip with no
   *  labels — ideal for placing inside a live-feed card. */
  compact?: boolean;
}

type Status = CampaignContactRow["status"];

const STATUS_META: Record<
  Status,
  { label: string; Icon: React.ElementType; color: string; dotColor: string }
> = {
  pending: {
    label: "Pendiente",
    Icon: Clock,
    color: "text-slate-500",
    dotColor: "bg-slate-400",
  },
  dialing: {
    label: "Marcando",
    Icon: Phone,
    color: "text-blue-600",
    dotColor: "bg-blue-500",
  },
  connected: {
    label: "Conectada",
    Icon: PhoneCall,
    color: "text-emerald-600",
    dotColor: "bg-emerald-500",
  },
  done: {
    label: "Completada",
    Icon: CheckCircle2,
    color: "text-emerald-700",
    dotColor: "bg-emerald-600",
  },
  no_answer: {
    label: "Sin respuesta",
    Icon: PhoneOff,
    color: "text-amber-600",
    dotColor: "bg-amber-500",
  },
  failed: {
    label: "Falló",
    Icon: XCircle,
    color: "text-rose-600",
    dotColor: "bg-rose-500",
  },
};

function formatRelativeTime(at: number): string {
  const now = Date.now();
  const delta = Math.max(0, Math.round((now - at) / 1000));
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  return `${Math.floor(delta / 3600)}h`;
}

function formatStepTime(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Horizontal mini-timeline visualising the lifecycle of one contact.
 *
 * Each observed step is rendered as a dot anchored to the canonical stage
 * ordering (pending → dialing → connected → terminal). Future stages render
 * dimmed so the admin can predict where the contact is going.
 */
export function ContactJourney({ journey, compact }: Props) {
  // Canonical timeline columns — used to lay out dots even for stages we
  // haven't observed yet. (Kept inline in `visibleStages` below; the bare
  // STAGES array was historic and is no longer referenced.)

  // For terminal states we only highlight the actual outcome, not all three.
  const terminalReached =
    journey.status === "done" ||
    journey.status === "no_answer" ||
    journey.status === "failed";
  const terminal: Status | null = terminalReached ? journey.status : null;

  // Map of status → step (latest) so we can render dot states quickly.
  const observed = new Map<Status, { at: number; inferred?: boolean }>();
  for (const s of journey.steps) {
    observed.set(s.status, { at: s.at, inferred: s.inferred });
  }

  // The visible track collapses the three terminal stages into one cell so
  // the timeline doesn't look "mostly dimmed" once a call ends.
  const visibleStages = ["pending", "dialing", "connected"] as Status[];
  const lastCell: Status = terminal || "done";

  const renderDot = (status: Status, isLast?: boolean) => {
    const meta = STATUS_META[status];
    const isObserved = observed.has(status);
    const isCurrent = journey.status === status;
    const data = observed.get(status);
    const Icon = data?.inferred ? HelpCircle : meta.Icon;

    return (
      <motion.div
        layout
        className="flex flex-col items-center gap-0.5"
        title={
          data
            ? `${meta.label} · ${formatStepTime(data.at)}${
                data.inferred ? " (inferido)" : ""
              }`
            : meta.label
        }
      >
        <div
          className={`relative flex ${compact ? "h-4 w-4" : "h-5 w-5"} items-center justify-center rounded-full border-2 ${
            isCurrent
              ? `${meta.dotColor} border-background shadow-lg ring-2 ring-current ${meta.color}`
              : isObserved
                ? `${meta.dotColor} border-background opacity-80`
                : "border-dashed border-muted-foreground/40 bg-background"
          }`}
        >
          {isObserved ? (
            <Icon
              className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"} text-white`}
            />
          ) : (
            <Icon
              className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"} text-muted-foreground/40`}
            />
          )}
          {isCurrent && (
            <motion.div
              className={`absolute inset-0 rounded-full ${meta.dotColor}`}
              animate={{ opacity: [0.4, 0, 0.4], scale: [1, 1.8, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              style={{ zIndex: -1 }}
            />
          )}
        </div>
        {!compact && (
          <span
            className={`text-[9px] ${
              isCurrent
                ? `font-semibold ${meta.color}`
                : isObserved
                  ? "text-muted-foreground"
                  : "text-muted-foreground/40"
            }`}
          >
            {isLast && terminal
              ? STATUS_META[terminal].label
              : meta.label}
          </span>
        )}
        {!compact && data && (
          <span className="text-[8px] tabular-nums text-muted-foreground">
            {formatRelativeTime(data.at)}
          </span>
        )}
      </motion.div>
    );
  };

  const cells: Status[] = [...visibleStages, lastCell];

  return (
    <div
      className={`flex items-center ${compact ? "gap-1" : "gap-2"} w-full`}
      aria-label="Lifecycle del contacto"
    >
      {cells.map((cell, i) => {
        const isLastCell = i === cells.length - 1;
        const meta = STATUS_META[cell];
        // The connector between cells is colored if both ends are observed,
        // gray-dashed otherwise. The connector going INTO the current stage
        // is animated to convey movement.
        const prev = i > 0 ? cells[i - 1] : null;
        const prevObserved = prev ? observed.has(prev) : true;
        const thisObserved =
          observed.has(cell) ||
          (isLastCell &&
            terminal &&
            observed.has(terminal as Status));
        const animatedConnector =
          prevObserved && journey.status === cell && journey.status !== "pending";

        return (
          <div key={cell + i} className="flex flex-1 items-center gap-1">
            {i > 0 && (
              <div
                className={`relative flex-1 ${compact ? "h-0.5" : "h-0.5"} rounded-full ${
                  prevObserved && thisObserved
                    ? meta.dotColor
                    : "bg-muted-foreground/15"
                }`}
              >
                {animatedConnector && (
                  <motion.div
                    className={`absolute inset-y-0 left-0 rounded-full ${meta.dotColor} opacity-70`}
                    animate={{ width: ["0%", "100%", "0%"] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  />
                )}
              </div>
            )}
            {renderDot(cell, isLastCell)}
          </div>
        );
      })}
    </div>
  );
}
