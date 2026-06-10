import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Phone,
  PhoneCall,
  CheckCircle2,
  PhoneOff,
  XCircle,
  Clock,
  Radio,
  ChevronDown,
  ChevronRight,
  User,
  Filter,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContactJourney } from "./ContactJourney";
import type {
  CampaignActivityEvent,
  ContactJourney as JourneyData,
} from "@/hooks/useCampaignActivity";
import type { CampaignContactRow } from "@/hooks/useCampaignContacts";

interface Props {
  events: CampaignActivityEvent[];
  journeys: JourneyData[];
  /** When true, plays a soft chime each time a new event is prepended. */
  soundEnabled?: boolean;
  /** Toggle the chime on/off. */
  onToggleSound?: () => void;
}

type Status = CampaignContactRow["status"];

/**
 * Each status carries a small accent dot color (used in the status pill +
 * progress timeline) and a flavour label, but everything else (card
 * surface, text color, ring) shares the same neutral CRM palette. The dot
 * is the only color signal — like a unified design language used by
 * Salesforce / Linear / Notion. */
const STATUS_META: Record<
  Status,
  {
    label: string;
    Icon: React.ElementType;
    /** Accent dot color, the ONE color we keep per status. */
    dot: string;
    flavour: string;
  }
> = {
  pending: {
    label: "Pendiente",
    Icon: Clock,
    dot: "bg-muted-foreground/40",
    flavour: "Encolada por el dialer",
  },
  dialing: {
    label: "Marcando",
    Icon: Phone,
    dot: "bg-[var(--accent-cyan)]",
    flavour: "Marcando ahora",
  },
  connected: {
    label: "Conectada",
    Icon: PhoneCall,
    dot: "bg-[var(--accent-green)]",
    flavour: "Hablando con el agente",
  },
  done: {
    label: "Completada",
    Icon: CheckCircle2,
    dot: "bg-[var(--accent-green)]",
    flavour: "Cerró exitosamente",
  },
  no_answer: {
    label: "Sin respuesta",
    Icon: PhoneOff,
    dot: "bg-[var(--accent-amber)]",
    flavour: "No atendieron",
  },
  failed: {
    label: "Falló",
    Icon: XCircle,
    dot: "bg-[var(--accent-red)]",
    flavour: "Falló la llamada",
  },
};

const FILTERS: Array<{ id: "ALL" | Status; label: string }> = [
  { id: "ALL", label: "Todo" },
  { id: "dialing", label: "Marcando" },
  { id: "connected", label: "Conectada" },
  { id: "done", label: "Completadas" },
  { id: "no_answer", label: "Sin respuesta" },
  { id: "failed", label: "Falló" },
];

function formatRelativeTime(at: number): string {
  const now = Date.now();
  const delta = Math.max(0, Math.round((now - at) / 1000));
  if (delta < 60) return `hace ${delta}s`;
  if (delta < 3600) return `hace ${Math.floor(delta / 60)}m`;
  return `hace ${Math.floor(delta / 3600)}h`;
}

/**
 * Vertical live feed of campaign activity. Each new transition pops in from
 * the top with a layout animation, pushing older events down. Items are
 * grouped by `rowId` so a single contact occupies one card whose status
 * badge + mini-timeline update as the contact progresses, rather than
 * spawning a new card per stage (which would quickly fill the panel).
 */
export function CampaignLiveFeed({
  events,
  journeys,
  soundEnabled,
  onToggleSound,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<"ALL" | Status>("ALL");

  // Build a map of rowId → latest event so we can show one card per row.
  // Order by the most recent event time so freshly-active rows float up.
  const cards = useMemo(() => {
    const latestByRow = new Map<
      string,
      { event: CampaignActivityEvent; journey?: JourneyData }
    >();
    for (const e of events) {
      // events are already newest-first, so we only set on first encounter
      // per rowId — that gives us the most recent event for each.
      if (!latestByRow.has(e.rowId)) latestByRow.set(e.rowId, { event: e });
    }
    // Attach journey if available.
    const journeyByRow = new Map(journeys.map((j) => [j.rowId, j]));
    for (const [rowId, entry] of latestByRow) {
      const j = journeyByRow.get(rowId);
      if (j) entry.journey = j;
    }
    let list = Array.from(latestByRow.values());
    if (filter !== "ALL") {
      list = list.filter((c) => c.event.status === filter);
    }
    return list;
  }, [events, journeys, filter]);

  // Stats for the header — totals per status across the visible events.
  const headerCounts = useMemo(() => {
    const counts: Record<Status, number> = {
      pending: 0,
      dialing: 0,
      connected: 0,
      done: 0,
      no_answer: 0,
      failed: 0,
    };
    const seenRows = new Set<string>();
    for (const e of events) {
      if (seenRows.has(e.rowId)) continue;
      seenRows.add(e.rowId);
      counts[e.status] += 1;
    }
    return counts;
  }, [events]);

  return (
    <motion.div
      layout
      className="rounded-lg border bg-card"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-left hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <Radio className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold">Llamadas en vivo</span>
          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
            {cards.length}
          </span>
        </button>

        {/* Status pill summary — shown only when expanded */}
        {!collapsed && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {(["dialing", "connected", "done", "no_answer", "failed"] as Status[]).map(
              (s) => {
                const v = headerCounts[s];
                if (v === 0) return null;
                const meta = STATUS_META[s];
                return (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label} {v}
                  </span>
                );
              }
            )}
            {onToggleSound && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={onToggleSound}
                title={
                  soundEnabled
                    ? "Silenciar chime al entrar una nueva llamada"
                    : "Reproducir chime al entrar una nueva llamada"
                }
              >
                {soundEnabled ? (
                  <Volume2 className="h-3.5 w-3.5" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2 text-[11px]">
            <Filter className="h-3 w-3 text-muted-foreground" />
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-2 py-0.5 transition-colors ${
                  filter === f.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="ml-auto italic text-muted-foreground/70">
              Nuevas llamadas aparecen desde arriba ↓
            </span>
          </div>

          {/* Feed body */}
          <div className="max-h-[420px] overflow-y-auto px-3 py-3">
            {cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-center">
                <Radio className="h-5 w-5 text-muted-foreground/60" />
                <div className="text-sm font-medium text-muted-foreground">
                  Esperando actividad…
                </div>
                <div className="max-w-xs text-[11px] text-muted-foreground/70">
                  En cuanto el dialer marque un contacto vas a ver la tarjeta
                  acá, con su evolución en vivo.
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {cards.map(({ event, journey }) => (
                    <FeedCard
                      key={event.rowId}
                      event={event}
                      journey={journey}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

function FeedCard({
  event,
  journey,
}: {
  event: CampaignActivityEvent;
  journey?: JourneyData;
}) {
  const meta = STATUS_META[event.status];
  const Icon = meta.Icon;

  // Active states pulse — terminal states sit still.
  const isActive = event.status === "dialing" || event.status === "connected";
  const isTerminal =
    event.status === "done" ||
    event.status === "no_answer" ||
    event.status === "failed";

  return (
    <motion.div
      layout
      // Slide in from above, then settle into the list.
      initial={{ opacity: 0, y: -20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 360, damping: 28 }}
      className={`relative overflow-hidden rounded-lg border bg-card p-3 ${
        isActive ? "border-foreground/20" : ""
      } ${isTerminal ? "opacity-80" : ""}`}
    >
      {/* Subtle left accent bar instead of full halo — keeps the visual
          weight low while still signalling that this card is the one
          currently being acted on. */}
      {isActive && (
        <motion.div
          className={`pointer-events-none absolute left-0 top-0 h-full w-0.5 rounded-r ${meta.dot}`}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        />
      )}

      <div className="flex items-start gap-3">
        {/* Status icon — neutral surface, status conveyed by a small dot
            at the bottom-right of the icon container. */}
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
          {isActive ? (
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              <Icon className="h-4 w-4" />
            </motion.div>
          ) : (
            <Icon className="h-4 w-4" />
          )}
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${meta.dot}`}
          />
        </div>

        {/* Contact info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
            <span className="truncate font-mono text-sm font-semibold">
              {event.phone || event.rowId.slice(0, 8)}
            </span>
            {event.customerName && (
              <span className="truncate text-xs text-muted-foreground">
                · {event.customerName}
              </span>
            )}
            {event.attempts > 1 && (
              <Badge variant="outline" className="text-[9px]">
                intento {event.attempts}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{meta.label}</span>
            <span>· {meta.flavour}</span>
            {event.agentUsername && (
              <>
                <span className="flex items-center gap-0.5">
                  · <User className="h-2.5 w-2.5" />
                  {event.agentUsername}
                </span>
              </>
            )}
            {event.disconnectReason && isTerminal && (
              <span className="italic">· {event.disconnectReason}</span>
            )}
            <span className="ml-auto tabular-nums">
              {formatRelativeTime(event.at)}
            </span>
          </div>
        </div>
      </div>

      {/* Mini-timeline showing the contact's journey */}
      {journey && (
        <div className="mt-3 pt-2">
          <ContactJourney journey={journey} />
        </div>
      )}
    </motion.div>
  );
}
