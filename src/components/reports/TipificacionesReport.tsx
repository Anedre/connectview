import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { format } from "date-fns";
import {
  UserPlus,
  Sparkle,
  Check,
  GraduationCap,
  ArrowClockwise,
  Trophy,
  Clock,
  Warning,
  TrendUp,
  Lightning,
  CaretDown,
} from "@phosphor-icons/react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useProgram } from "@/context/ProgramContext";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import type { Valoracion } from "@/lib/dispositions";
import { EChart, useChartTokens } from "@/components/charts/EChart";
import { Kpi, KpiRow, Funnel, BarList } from "@/components/reports/kit";
import { Btn } from "@/components/aria";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * TipificacionesReport — el REPORTE analítico de tipificación/pipeline de ARIA,
 * montado como el tab "Pipeline" de /reports (antes página suelta /tipificaciones). No
 * es una réplica de ningún BI externo: son métricas y gráficos nativos que se
 * alimentan solos de la data operativa (agentes tipificando, campañas, Meta Lead
 * Ads, import). Diferenciadores sobre un dashboard estático: insights narrados,
 * heatmap de actividad y velocidad de gestión.
 *
 * Datos: manage-leads ?report=typifications[&programId=] (una fila por lead). El
 * scope de programa lo da el switcher global; los filtros finos y TODA la
 * agregación (KPIs, embudo, origen, agente, tendencia, heatmap) se computan aquí.
 * Los paneles de ESFUERZO (golpes) usan ?report=attribution — agregado
 * server-side, portados del viejo ProgramReport (tab "Crecimiento").
 */

interface TypRow {
  leadId: string;
  phone: string;
  name: string | null;
  email: string | null;
  source: string | null;
  agent: string | null;
  programIds: string[];
  stageId: string | null;
  stageLabel: string | null;
  subStageLabel: string | null;
  typifiedAt: string | null;
  comments: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface TypResp {
  rows: TypRow[];
  total: number;
  truncated: boolean;
  generatedAt: string;
}

/** Payload de manage-leads ?report=attribution (Pilar 2 · golpes→conversión). */
interface Attribution {
  totalLeads: number;
  converted: number;
  conversionRate: number;
  avgGolpes: number;
  avgGolpesToClose: number;
  avgDaysToClose: number;
  totalGolpes: number;
  byBucket: Array<{ label: string; leads: number; converted: number; rate: number }>;
  byChannel: Record<string, number>;
  byStage: Record<string, number>;
}

const STAGE_PALETTE = [
  "#1C97A6",
  "#2E9D8E",
  "#33c084",
  "#92C73E",
  "#f5c518",
  "#F2972E",
  "#ff7a66",
  "#ed5257",
  "#9b6dff",
  "#2bc6e6",
  "#5F6E8C",
];

const SOURCE_LABEL: Record<string, string> = {
  web_form: "Web",
  campaign: "Campaña",
  salesforce: "Salesforce",
  whatsapp: "WhatsApp",
  manual: "Manual",
  facebook: "Facebook",
  instagram: "Instagram",
  meta_lead_ads: "Meta Lead Ads",
  referral: "Referido",
  call: "Llamada",
  "import-csv": "Importado",
};
const sourceLabel = (s?: string | null): string => (s ? SOURCE_LABEL[s] || s : "—");
const NONE_PROGRAM = "__none__";
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Colores de canal para "Golpes por canal" (heredados de ProgramReport). */
const CH_COLORS: Record<string, string> = {
  Llamada: "var(--cyan)",
  WhatsApp: "var(--green)",
  Correo: "var(--gold)",
  Chat: "var(--coral)",
};

function prettyStage(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
function uniqueSorted(vals: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(vals.map((v) => (v && v.trim() ? v : null)).filter((v): v is string => !!v)),
  ).sort((a, b) => a.localeCompare(b));
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : format(d, "dd/MM/yyyy");
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : format(d, "HH:mm");
}
function fmtDur(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}
function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-2)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div
        className="row"
        style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10 }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-2)",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label
      style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 150px" }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "auto",
          height: 34,
          borderRadius: 9,
          border: "1px solid var(--border-1)",
          background: "var(--bg-2)",
          color: "var(--text-1)",
          padding: "0 10px",
          fontSize: 13,
          fontWeight: 600,
          maxWidth: "100%",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "0 1 140px" }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: 34,
          borderRadius: 9,
          border: "1px solid var(--border-1)",
          background: "var(--bg-2)",
          color: "var(--text-1)",
          padding: "0 10px",
          fontSize: 13,
          fontWeight: 600,
        }}
      />
    </label>
  );
}

export function TipificacionesReport() {
  const { activeProgramId, activeProgram, programs } = useProgram();
  const { tree } = useTaxonomy(activeProgram?.taxonomyId);
  const ep = getApiEndpoints();

  const { data, isLoading, error, refetch, isFetching } = useQuery<TypResp | undefined>({
    queryKey: ["typifications", activeProgramId],
    enabled: !!ep?.manageLeads,
    refetchInterval: 45_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const scoped = activeProgramId && activeProgramId !== "all";
      const url = `${ep!.manageLeads}?report=typifications${scoped ? `&programId=${encodeURIComponent(activeProgramId)}` : ""}`;
      const r = await authedFetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { typifications?: TypResp };
      return j.typifications;
    },
  });
  const rows: TypRow[] = useMemo(() => data?.rows ?? [], [data]);

  // Esfuerzo (golpes): segundo fetch a ?report=attribution con el MISMO scope de
  // programa del switcher. El backend solo sabe scopear attribution con un
  // programId real ("all"/"none" → global), así que con "Sin programa" activo NO
  // se consulta ni se pinta la fila (mostraría data global bajo un scope que no
  // corresponde). Agregado server-side: ignora los filtros locales de arriba.
  const attrScoped = !!activeProgramId && activeProgramId !== "all" && activeProgramId !== "none";
  const { data: attr } = useQuery<Attribution | undefined>({
    queryKey: ["attribution", activeProgramId],
    enabled: !!ep?.manageLeads && activeProgramId !== "none",
    refetchInterval: 45_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const url = `${ep!.manageLeads}?report=attribution${attrScoped ? `&programId=${encodeURIComponent(activeProgramId)}` : ""}`;
      const r = await authedFetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { attribution?: Attribution };
      return j.attribution;
    },
  });

  const stageMeta = useMemo(() => {
    const m = new Map<
      string,
      { label: string; color: string; valoracion: Valoracion; order: number }
    >();
    tree.forEach((s, i) => {
      m.set(s.id, {
        label: s.label,
        color: STAGE_PALETTE[i % STAGE_PALETTE.length],
        valoracion: s.valoracion,
        order: i,
      });
    });
    return m;
  }, [tree]);
  const stageLabel = (id: string | null): string =>
    id ? stageMeta.get(id)?.label || prettyStage(id) : "—";
  const stageColor = (id: string | null): string =>
    id ? stageMeta.get(id)?.color || "var(--text-3)" : "var(--text-3)";
  const valOf = (id: string | null): Valoracion | undefined =>
    id ? stageMeta.get(id)?.valoracion : undefined;

  const programMap = useMemo(() => new Map(programs.map((p) => [p.programId, p])), [programs]);
  const programLabel = (pid: string): string => {
    if (pid === NONE_PROGRAM) return "Sin programa";
    const p = programMap.get(pid);
    return p ? p.code || p.name : pid.slice(0, 6);
  };

  // ── Filtros ────────────────────────────────────────────────────────────────
  const [fAgent, setFAgent] = useState("all");
  const [fStage, setFStage] = useState("all");
  const [fSource, setFSource] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  const agentOpts = useMemo(() => uniqueSorted(rows.map((r) => r.agent)), [rows]);
  const sourceOpts = useMemo(() => uniqueSorted(rows.map((r) => r.source)), [rows]);
  const stageOpts = useMemo(() => {
    const present = new Set(rows.map((r) => r.stageId).filter((s): s is string => !!s));
    const known = tree.filter((s) => present.has(s.id)).map((s) => ({ id: s.id, label: s.label }));
    const knownIds = new Set(tree.map((s) => s.id));
    const extra = Array.from(present)
      .filter((id) => !knownIds.has(id))
      .map((id) => ({ id, label: prettyStage(id) }));
    return [...known, ...extra];
  }, [rows, tree]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (fAgent !== "all" && (r.agent || "") !== fAgent) return false;
        if (fStage !== "all" && (r.stageId || "") !== fStage) return false;
        if (fSource !== "all" && (r.source || "") !== fSource) return false;
        if (fFrom || fTo) {
          const d = (r.typifiedAt || r.createdAt || "").slice(0, 10);
          if (!d) return false;
          if (fFrom && d < fFrom) return false;
          if (fTo && d > fTo) return false;
        }
        return true;
      }),
    [rows, fAgent, fStage, fSource, fFrom, fTo],
  );
  const anyFilter = fAgent !== "all" || fStage !== "all" || fSource !== "all" || !!fFrom || !!fTo;
  const clearFilters = () => {
    setFAgent("all");
    setFStage("all");
    setFSource("all");
    setFFrom("");
    setFTo("");
  };

  // ── Métricas (todo derivado de las filas) ───────────────────────────────────
  const M = useMemo(() => {
    const total = filtered.length;
    let tipificados = 0;
    let convertidos = 0;
    let enPipeline = 0;
    let perdidos = 0;
    let nuevos = 0;
    const byStage = new Map<string, number>();
    const byProgramStage = new Map<string, Map<string, number>>();
    const programTotals = new Map<string, number>();
    const bySource = new Map<string, { total: number; conv: number }>();
    const byAgent = new Map<string, { total: number; tip: number; conv: number }>();
    const byDay = new Map<string, number>();
    const heat: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const speeds: number[] = [];

    for (const r of filtered) {
      const val = valOf(r.stageId);
      if (r.typifiedAt) tipificados++;
      if (val === "cierre") convertidos++;
      else if (val === "negativa") perdidos++;
      else if (val === "inicial" || r.stageId === "nuevo_lead") nuevos++;
      else if (val === "positiva") enPipeline++;

      byStage.set(r.stageId || "(sin etapa)", (byStage.get(r.stageId || "(sin etapa)") || 0) + 1);

      const pids = r.programIds.length ? r.programIds : [NONE_PROGRAM];
      for (const pid of pids) {
        if (!byProgramStage.has(pid)) byProgramStage.set(pid, new Map());
        const sm = byProgramStage.get(pid)!;
        const st = r.stageId || "(sin etapa)";
        sm.set(st, (sm.get(st) || 0) + 1);
        programTotals.set(pid, (programTotals.get(pid) || 0) + 1);
      }

      const src = r.source || "(sin origen)";
      const se = bySource.get(src) || { total: 0, conv: 0 };
      se.total++;
      if (val === "cierre") se.conv++;
      bySource.set(src, se);

      if (r.agent) {
        const ae = byAgent.get(r.agent) || { total: 0, tip: 0, conv: 0 };
        ae.total++;
        if (r.typifiedAt) ae.tip++;
        if (val === "cierre") ae.conv++;
        byAgent.set(r.agent, ae);
      }

      if (r.typifiedAt) {
        const d = new Date(r.typifiedAt);
        if (!isNaN(d.getTime())) {
          byDay.set(format(d, "yyyy-MM-dd"), (byDay.get(format(d, "yyyy-MM-dd")) || 0) + 1);
          const wd = (d.getDay() + 6) % 7; // Lun=0
          heat[wd][d.getHours()]++;
        }
        if (r.createdAt) {
          const delta = Date.parse(r.typifiedAt) - Date.parse(r.createdAt);
          if (delta >= 0 && delta < 1000 * 60 * 60 * 24 * 120) speeds.push(delta);
        }
      }
    }

    // Embudo acumulado sobre el camino positivo (inicial→positiva→cierre).
    const path = tree.filter((s) => s.valoracion !== "negativa");
    const pathIndex = new Map(path.map((s, i) => [s.id, i]));
    const funnel = path.map((s, i) => ({
      id: s.id,
      label: s.label,
      color: stageMeta.get(s.id)?.color || "var(--cyan)",
      count: filtered.filter((r) => {
        const idx = pathIndex.get(r.stageId || "");
        return idx != null && idx >= i;
      }).length,
    }));

    // Recuento por estado (orden taxonomía).
    const knownIds = new Set(tree.map((s) => s.id));
    const stageRows = [
      ...tree
        .filter((s) => byStage.has(s.id))
        .map((s) => ({ id: s.id, label: s.label, count: byStage.get(s.id)! })),
      ...Array.from(byStage.entries())
        .filter(([id]) => !knownIds.has(id))
        .map(([id, count]) => ({
          id,
          label: id === "(sin etapa)" ? "Sin etapa" : prettyStage(id),
          count,
        })),
    ];

    // Programas top para el apilado.
    const topPrograms = Array.from(programTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([pid, tot]) => ({ pid, total: tot, label: programLabel(pid) }));
    const presentStages = new Set<string>();
    for (const p of topPrograms)
      for (const st of byProgramStage.get(p.pid)!.keys()) presentStages.add(st);
    const stackStages = [
      ...tree.filter((s) => presentStages.has(s.id)).map((s) => ({ id: s.id, label: s.label })),
      ...Array.from(presentStages)
        .filter((id) => !knownIds.has(id))
        .map((id) => ({ id, label: id === "(sin etapa)" ? "Sin etapa" : prettyStage(id) })),
    ];

    const speedAvg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const sameDay = speeds.filter((s) => s < 1000 * 60 * 60 * 24).length;
    const speedBuckets = [
      { label: "< 1 h", n: speeds.filter((s) => s < 3.6e6).length },
      { label: "1–24 h", n: speeds.filter((s) => s >= 3.6e6 && s < 8.64e7).length },
      { label: "1–3 días", n: speeds.filter((s) => s >= 8.64e7 && s < 2.592e8).length },
      { label: "+3 días", n: speeds.filter((s) => s >= 2.592e8).length },
    ];

    // Leads estancados (no cerrados, no perdidos, sin actividad +7 días).
    const now = Date.now();
    const stalled = filtered.filter((r) => {
      const val = valOf(r.stageId);
      if (val === "cierre" || val === "negativa") return false;
      const last = r.updatedAt || r.typifiedAt || r.createdAt;
      return last ? now - Date.parse(last) > 1000 * 60 * 60 * 24 * 7 : false;
    }).length;

    return {
      total,
      tipificados,
      convertidos,
      enPipeline,
      perdidos,
      nuevos,
      conv: total ? convertidos / total : 0,
      funnel: funnel.filter((f) => f.count > 0),
      stageRows,
      byProgramStage,
      topPrograms,
      stackStages,
      bySource: Array.from(bySource.entries())
        .map(([k, v]) => ({ src: k, ...v }))
        .sort((a, b) => b.total - a.total),
      byAgent: Array.from(byAgent.entries())
        .map(([k, v]) => ({ agent: k, ...v }))
        .sort((a, b) => b.total - a.total),
      byDay: Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      heat,
      heatMax: Math.max(1, ...heat.flat()),
      speedAvg,
      sameDayPct: speeds.length ? sameDay / speeds.length : 0,
      speedBuckets,
      speedN: speeds.length,
      stalled,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, tree, stageMeta, programMap]);

  // ── Insights automáticos (narrativa heurística) ─────────────────────────────
  const insights = useMemo(() => {
    const out: Array<{ icon: ReactNode; tone: string; title: string; detail: string }> = [];
    const pct = (n: number) => `${Math.round(n * 100)}%`;

    const srcConv = M.bySource
      .filter((s) => s.total >= 5)
      .map((s) => ({ ...s, rate: s.conv / s.total }));
    if (srcConv.length >= 2) {
      const sorted = [...srcConv].sort((a, b) => b.rate - a.rate);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const mult = worst.rate > 0 ? best.rate / worst.rate : 0;
      out.push({
        icon: <TrendUp size={16} />,
        tone: "var(--green)",
        title: `${sourceLabel(best.src)} es tu mejor origen`,
        detail: `Convierte ${pct(best.rate)}${mult >= 1.3 ? ` — ${mult.toFixed(1)}× mejor que ${sourceLabel(worst.src)}` : ""}. Prioriza ese canal.`,
      });
    }
    const agConv = M.byAgent
      .filter((a) => a.total >= 5)
      .map((a) => ({ ...a, rate: a.conv / a.total }));
    if (agConv.length) {
      const best = [...agConv].sort((a, b) => b.rate - a.rate)[0];
      out.push({
        icon: <Trophy size={16} />,
        tone: "var(--gold)",
        title: `${best.agent} lidera en cierre`,
        detail: `${pct(best.rate)} de conversión sobre ${best.total} leads. Referente para el resto del equipo.`,
      });
    }
    if (M.speedN >= 5) {
      out.push({
        icon: <Lightning size={16} />,
        tone: "var(--cyan)",
        title: `Velocidad de gestión: ${fmtDur(M.speedAvg)}`,
        detail: `${pct(M.sameDayPct)} de los leads se gestionan el mismo día. La velocidad al lead correlaciona con el cierre.`,
      });
    }
    let peak = { wd: -1, h: -1, n: 0 };
    M.heat.forEach((row, wd) =>
      row.forEach((n, h) => {
        if (n > peak.n) peak = { wd, h, n };
      }),
    );
    if (peak.n >= 3) {
      out.push({
        icon: <Clock size={16} />,
        tone: "var(--iris)",
        title: `Hora pico: ${WEEKDAYS[peak.wd]} ${String(peak.h).padStart(2, "0")}:00`,
        detail: `Es cuando más se tipifica. Asegura cobertura del equipo en esa franja.`,
      });
    }
    if (M.stalled > 0) {
      out.push({
        icon: <Warning size={16} />,
        tone: "var(--red)",
        title: `${M.stalled} leads enfriándose`,
        detail: `Sin gestión hace +7 días y aún en pipeline. Reactívalos antes de que se pierdan.`,
      });
    }
    if (M.total >= 5) {
      out.push({
        icon: <GraduationCap size={16} />,
        tone: "var(--green)",
        title: `Conversión global ${pct(M.conv)}`,
        detail: `${M.convertidos} de ${M.total} leads llegaron a cierre en la selección actual.`,
      });
    }
    return out.slice(0, 6);
  }, [M]);

  // ── Tabla de detalle (colapsable) ───────────────────────────────────────────
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const columns = useMemo<ColumnDef<TypRow>[]>(
    () => [
      {
        accessorKey: "phone",
        header: "Teléfono",
        cell: ({ getValue }) => (
          <span style={{ fontWeight: 600 }}>{getValue<string>() || "—"}</span>
        ),
      },
      { id: "origen", accessorFn: (r) => sourceLabel(r.source), header: "Origen" },
      { id: "agente", accessorFn: (r) => r.agent || "—", header: "Agente" },
      {
        id: "estado",
        accessorFn: (r) => stageLabel(r.stageId),
        header: "Estado",
        cell: ({ row }) => {
          const c = stageColor(row.original.stageId);
          return (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 9px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                color: c,
                background: `color-mix(in srgb, ${c} 14%, transparent)`,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
              {stageLabel(row.original.stageId)}
            </span>
          );
        },
      },
      { id: "sub", accessorFn: (r) => r.subStageLabel || "—", header: "Sub. Estado" },
      {
        id: "fecTip",
        accessorFn: (r) => r.typifiedAt || "",
        header: "Fec. Tipificación",
        cell: ({ row }) =>
          `${fmtDate(row.original.typifiedAt)} ${row.original.typifiedAt ? fmtTime(row.original.typifiedAt) : ""}`.trim(),
      },
      {
        accessorKey: "updatedAt",
        header: "Actualizado",
        cell: ({ getValue }) => fmtDate(getValue<string>() || null),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stageMeta],
  );
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const scopeLabel = activeProgram
    ? activeProgram.name
    : activeProgramId === "none"
      ? "Sin programa"
      : "Todos los programas";

  return (
    <div>
      <div
        className="row between"
        style={{ alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}
      >
        <div className="row gap8" style={{ alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>Pipeline de tipificación</span>
          <span className="chip" style={{ fontSize: 11.5 }}>
            {scopeLabel} · {M.total} leads
          </span>
        </div>
        <div className="row gap10" style={{ alignItems: "center" }}>
          {data?.generatedAt && (
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              Actualizado {fmtTime(data.generatedAt)}
            </span>
          )}
          <Btn variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <ArrowClockwise size={15} weight="bold" style={{ marginRight: 6 }} />
            {isFetching ? "Actualizando…" : "Actualizar"}
          </Btn>
        </div>
      </div>

      <div
        style={{
          background: "var(--bg-1)",
          border: "1px solid var(--border-2)",
          borderRadius: 14,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
          <FilterSelect
            label="Agente"
            value={fAgent}
            onChange={setFAgent}
            options={[
              { value: "all", label: "Todo" },
              ...agentOpts.map((a) => ({ value: a, label: a })),
            ]}
          />
          <FilterSelect
            label="Estado"
            value={fStage}
            onChange={setFStage}
            options={[
              { value: "all", label: "Todo" },
              ...stageOpts.map((s) => ({ value: s.id, label: s.label })),
            ]}
          />
          <FilterSelect
            label="Origen"
            value={fSource}
            onChange={setFSource}
            options={[
              { value: "all", label: "Todo" },
              ...sourceOpts.map((s) => ({ value: s, label: sourceLabel(s) })),
            ]}
          />
          <DateInput label="Desde" value={fFrom} onChange={setFFrom} />
          <DateInput label="Hasta" value={fTo} onChange={setFTo} />
          {anyFilter && (
            <Btn variant="ghost" size="sm" onClick={clearFilters}>
              Limpiar
            </Btn>
          )}
        </div>
      </div>

      {error ? (
        <div className="chip chip--red" style={{ display: "block", padding: "10px 14px" }}>
          No se pudo cargar: {error instanceof Error ? error.message : "error"}. Verifica que
          manage-leads esté desplegado.
        </div>
      ) : isLoading ? (
        <div style={{ color: "var(--text-3)", padding: 48, textAlign: "center" }}>
          Cargando tipificaciones…
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            color: "var(--text-3)",
            padding: 48,
            textAlign: "center",
            border: "1px dashed var(--border-1)",
            borderRadius: 16,
            background: "var(--bg-1)",
          }}
        >
          Sin leads para {scopeLabel.toLowerCase()} todavía. A medida que se gestionen y tipifiquen,
          este reporte se llena solo.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* KPIs */}
          <KpiRow min={140}>
            <Kpi
              icon={<UserPlus size={14} />}
              color="var(--gold)"
              label="Total de leads"
              value={M.total}
              sub={anyFilter ? "con filtros" : scopeLabel}
            />
            <Kpi
              icon={<Check size={14} />}
              color="var(--green)"
              label="Conversión"
              value={`${Math.round(M.conv * 100)}%`}
              sub={`${M.convertidos} cerrados`}
            />
            <Kpi
              icon={<TrendUp size={14} />}
              color="var(--cyan)"
              label="En pipeline"
              value={M.enPipeline}
              sub="en gestión activa"
            />
            <Kpi
              icon={<Sparkle size={14} />}
              color="var(--iris)"
              label="Nuevos"
              value={M.nuevos}
              sub="sin tipificar aún"
            />
            <Kpi
              icon={<Lightning size={14} />}
              color="var(--gold)"
              label="Velocidad"
              value={M.speedN ? fmtDur(M.speedAvg) : "—"}
              sub={M.speedN ? `${Math.round(M.sameDayPct * 100)}% el mismo día` : "sin datos"}
            />
          </KpiRow>

          {/* Insights automáticos — el diferenciador */}
          {insights.length > 0 && (
            <Panel title="Insights automáticos">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 12,
                }}
              >
                {insights.map((ins, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 11,
                      padding: "12px 13px",
                      borderRadius: 12,
                      border: "1px solid var(--border-1)",
                      borderLeft: `3px solid ${ins.tone}`,
                      background: `linear-gradient(135deg, color-mix(in srgb, ${ins.tone} 6%, var(--bg-1)), var(--bg-1) 70%)`,
                    }}
                  >
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        background: `color-mix(in srgb, ${ins.tone} 16%, transparent)`,
                        color: ins.tone,
                        flex: "0 0 auto",
                      }}
                    >
                      {ins.icon}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-1)" }}>
                        {ins.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-3)",
                          marginTop: 2,
                          lineHeight: 1.35,
                        }}
                      >
                        {ins.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Embudo de conversión */}
          <Panel
            title="Embudo de conversión"
            right={
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                {Math.round(M.conv * 100)}% cierre global
              </span>
            }
          >
            {M.funnel.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: 13 }}>
                Sin etapas en el camino de conversión.
              </div>
            ) : (
              <Funnel
                stages={M.funnel.map((f) => ({ label: f.label, value: f.count, color: f.color }))}
              />
            )}
          </Panel>

          {/* % por programa + recuento por estado */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            <Panel title="Porcentaje de estado por programa">
              {M.topPrograms.length === 0 ? (
                <div style={{ color: "var(--text-3)", fontSize: 13 }}>Sin datos.</div>
              ) : (
                <StackedByProgram M={M} stageColor={stageColor} />
              )}
            </Panel>
            <Panel title="Recuento por estado">
              {M.stageRows.length === 0 ? (
                <div style={{ color: "var(--text-3)", fontSize: 13 }}>Sin datos.</div>
              ) : (
                <CountByStage rows={M.stageRows} stageColor={stageColor} />
              )}
            </Panel>
          </div>

          {/* Origen + Agente */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            <Panel title="Distribución por origen">
              <OriginPanel data={M.bySource} />
            </Panel>
            <Panel title="Rendimiento por agente">
              {M.byAgent.length === 0 ? (
                <div style={{ color: "var(--text-3)", fontSize: 13 }}>
                  Sin agentes asignados en la data. Al importar o gestionar con agente, aparece
                  aquí.
                </div>
              ) : (
                <AgentPanel data={M.byAgent} />
              )}
            </Panel>
          </div>

          {/* Tendencia + Heatmap */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            <Panel title="Tendencia de tipificaciones">
              {M.byDay.length === 0 ? (
                <div style={{ color: "var(--text-3)", fontSize: 13 }}>
                  Sin fechas de tipificación.
                </div>
              ) : (
                <TrendPanel data={M.byDay} />
              )}
            </Panel>
            <Panel title="Velocidad de gestión (carga → tipificación)">
              {M.speedN === 0 ? (
                <div style={{ color: "var(--text-3)", fontSize: 13 }}>
                  Sin datos de velocidad todavía.
                </div>
              ) : (
                <BarList
                  color="var(--cyan)"
                  rows={M.speedBuckets.map((b) => ({ label: b.label, value: b.n }))}
                />
              )}
            </Panel>
          </div>

          {/* Esfuerzo de contacto (?report=attribution) — portado del viejo
              ProgramReport: cuánto trabajo cuesta convertir. Oculto con scope
              "Sin programa" (attribution no sabe scopear a leads sin programa). */}
          {attr && attr.totalLeads > 0 && <EffortRow attr={attr} anyFilter={anyFilter} />}

          {/* Heatmap día × hora */}
          <Panel title="Mapa de calor · gestión por día y hora">
            <Heatmap heat={M.heat} max={M.heatMax} />
          </Panel>

          {/* Detalle colapsable */}
          <div
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-2)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="row between"
              style={{
                width: "100%",
                alignItems: "center",
                padding: "14px 18px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--text-1)",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--text-2)",
                }}
              >
                Detalle de tipificaciones · {filtered.length} filas
              </span>
              <CaretDown
                size={16}
                style={{
                  transform: showDetail ? "rotate(180deg)" : "none",
                  transition: "transform .2s",
                  color: "var(--text-3)",
                }}
              />
            </button>
            {showDetail && (
              <div style={{ padding: "0 18px 18px", overflowX: "auto" }}>
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => {
                          const canSort = header.column.getCanSort();
                          const sorted = header.column.getIsSorted();
                          return (
                            <TableHead
                              key={header.id}
                              onClick={
                                canSort ? header.column.getToggleSortingHandler() : undefined
                              }
                              style={{
                                cursor: canSort ? "pointer" : "default",
                                userSelect: "none",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span
                                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {canSort && (sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "")}
                              </span>
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table
                      .getRowModel()
                      .rows.slice(0, 500)
                      .map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} style={{ whiteSpace: "nowrap" }}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Barra 100%-apilada: una barra por programa, segmentos = estados. */
function StackedByProgram({
  M,
  stageColor,
}: {
  M: {
    topPrograms: Array<{ pid: string; total: number; label: string }>;
    stackStages: Array<{ id: string; label: string }>;
    byProgramStage: Map<string, Map<string, number>>;
  };
  stageColor: (id: string) => string;
}) {
  const t = useChartTokens();
  const option: EChartsOption = {
    grid: { left: 8, right: 12, top: 8, bottom: 28, containLabel: true },
    legend: {
      bottom: 0,
      textStyle: { color: t.text2, fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
      type: "scroll",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: t.bg2,
      borderColor: t.border,
      textStyle: { color: t.text1 },
      valueFormatter: (v) => `${Math.round(Number(v))}%`,
    },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { color: t.text3, formatter: "{value}%" },
      splitLine: { lineStyle: { color: t.border } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: M.topPrograms.map((p) => p.label),
      axisLabel: { color: t.text2, fontWeight: 600 },
      axisLine: { lineStyle: { color: t.border } },
    },
    series: M.stackStages.map((s) => ({
      name: s.label,
      type: "bar",
      stack: "total",
      emphasis: { focus: "series" },
      itemStyle: { color: stageColor(s.id) },
      data: M.topPrograms.map((p) => {
        const c = M.byProgramStage.get(p.pid)?.get(s.id) || 0;
        return p.total ? +((c / p.total) * 100).toFixed(1) : 0;
      }),
    })),
  };
  return <EChart option={option} height={Math.max(180, M.topPrograms.length * 44 + 60)} />;
}

function CountByStage({
  rows,
  stageColor,
}: {
  rows: Array<{ id: string; label: string; count: number }>;
  stageColor: (id: string) => string;
}) {
  const t = useChartTokens();
  const option: EChartsOption = {
    grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: t.bg2,
      borderColor: t.border,
      textStyle: { color: t.text1 },
    },
    xAxis: {
      type: "value",
      axisLabel: { color: t.text3 },
      splitLine: { lineStyle: { color: t.border } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((r) => r.label),
      axisLabel: { color: t.text2, fontWeight: 600 },
      axisLine: { lineStyle: { color: t.border } },
    },
    series: [
      {
        type: "bar",
        barWidth: "62%",
        label: { show: true, position: "right", color: t.text1, fontWeight: 700 },
        data: rows.map((r) => ({
          value: r.count,
          itemStyle: { color: stageColor(r.id), borderRadius: [0, 4, 4, 0] },
        })),
      },
    ],
  };
  return <EChart option={option} height={Math.max(180, rows.length * 38 + 30)} />;
}

/** Dona de volumen por origen + tasa de conversión por canal. */
function OriginPanel({ data }: { data: Array<{ src: string; total: number; conv: number }> }) {
  const t = useChartTokens();
  const top = data.slice(0, 8);
  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      backgroundColor: t.bg2,
      borderColor: t.border,
      textStyle: { color: t.text1 },
    },
    legend: {
      bottom: 0,
      textStyle: { color: t.text2, fontSize: 11 },
      type: "scroll",
      itemWidth: 10,
      itemHeight: 10,
    },
    series: [
      {
        type: "pie",
        radius: ["45%", "72%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: t.bg1, borderWidth: 2 },
        label: { show: false },
        data: top.map((s, i) => ({
          name: SOURCE_LABEL[s.src] || s.src,
          value: s.total,
          itemStyle: { color: STAGE_PALETTE[i % STAGE_PALETTE.length] },
        })),
      },
    ],
  };
  const maxConv = Math.max(0.0001, ...top.map((s) => (s.total ? s.conv / s.total : 0)));
  return (
    <div>
      <EChart option={option} height={210} />
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: ".04em",
            color: "var(--text-3)",
            marginBottom: 8,
          }}
        >
          Conversión por canal
        </div>
        <BarList
          color="var(--green)"
          max={100}
          rows={top.map((s) => {
            const rate = s.total ? s.conv / s.total : 0;
            return {
              label: SOURCE_LABEL[s.src] || s.src,
              value: Math.round((rate / maxConv) * 100),
              valueLabel: `${Math.round(rate * 100)}%`,
            };
          })}
        />
      </div>
    </div>
  );
}

/** Tabla de rendimiento por agente. */
function AgentPanel({
  data,
}: {
  data: Array<{ agent: string; total: number; tip: number; conv: number }>;
}) {
  const top = data.slice(0, 12);
  const maxTotal = Math.max(1, ...top.map((a) => a.total));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {top.map((a) => {
        const rate = a.total ? a.conv / a.total : 0;
        return (
          <div key={a.agent} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              className="trunc"
              style={{ width: 130, flex: "0 0 auto", fontSize: 12.5, fontWeight: 600 }}
              title={a.agent}
            >
              {a.agent}
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: 9,
                borderRadius: 99,
                background: "var(--bg-2)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(3, (a.total / maxTotal) * 100)}%`,
                  height: "100%",
                  borderRadius: 99,
                  background:
                    "linear-gradient(90deg, color-mix(in srgb, var(--cyan) 65%, transparent), var(--cyan))",
                }}
              />
            </div>
            <div
              style={{
                width: 44,
                flex: "0 0 auto",
                textAlign: "right",
                fontSize: 12.5,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {a.total}
            </div>
            <div
              style={{
                width: 74,
                flex: "0 0 auto",
                textAlign: "right",
                fontSize: 12,
                color: rate >= 0.15 ? "var(--green)" : "var(--text-3)",
                fontWeight: 700,
              }}
            >
              {Math.round(rate * 100)}% cierre
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Línea de tipificaciones por día. */
function TrendPanel({ data }: { data: Array<[string, number]> }) {
  const t = useChartTokens();
  const option: EChartsOption = {
    grid: { left: 8, right: 12, top: 16, bottom: 24, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.bg2,
      borderColor: t.border,
      textStyle: { color: t.text1 },
    },
    xAxis: {
      type: "category",
      data: data.map(([d]) => d.slice(5)),
      axisLabel: { color: t.text3, fontSize: 10 },
      axisLine: { lineStyle: { color: t.border } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: t.text3 },
      splitLine: { lineStyle: { color: t.border } },
    },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        data: data.map(([, n]) => n),
        lineStyle: { color: t.cyan, width: 2.5 },
        itemStyle: { color: t.cyan },
        areaStyle: { color: `color-mix(in srgb, ${t.cyan} 18%, transparent)` },
      },
    ],
  };
  return <EChart option={option} height={230} />;
}

/**
 * Fila "Esfuerzo de contacto": conversión por # de golpes + golpes por canal +
 * promedios al cierre (manage-leads ?report=attribution, fusiona WhatsApp HSM
 * por teléfono). Agregado server-side de TODO el programa: no responde a los
 * filtros locales, por eso el aviso cuando hay filtros activos.
 */
function EffortRow({ attr, anyFilter }: { attr: Attribution; anyFilter: boolean }) {
  const channels = Object.entries(attr.byChannel).sort((a, b) => b[1] - a[1]);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
        gap: 16,
      }}
    >
      <Panel
        title="Conversión por # de golpes"
        right={
          anyFilter ? (
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              programa completo · ignora los filtros
            </span>
          ) : undefined
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <EffortStat color="var(--cyan)" value={fmt1(attr.avgGolpes)} label="golpes por lead" />
          <EffortStat
            color="var(--iris)"
            value={attr.avgGolpesToClose ? fmt1(attr.avgGolpesToClose) : "—"}
            label="golpes al cierre"
          />
          <EffortStat
            color="var(--gold)"
            value={attr.avgDaysToClose ? String(Math.round(attr.avgDaysToClose)) : "—"}
            label="días al cierre"
          />
        </div>
        <BarList
          color="var(--green)"
          max={100}
          rows={attr.byBucket.map((b) => ({
            label: `${b.label} golpes`,
            value: Math.round(b.rate * 100),
            valueLabel: `${Math.round(b.rate * 100)}%`,
            hint: `${b.converted}/${b.leads} leads`,
          }))}
        />
      </Panel>
      <Panel
        title="Golpes por canal"
        right={
          <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            {attr.totalGolpes} golpes en total
          </span>
        }
      >
        {channels.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 13 }}>Sin golpes registrados.</div>
        ) : (
          <BarList
            rows={channels.map(([ch, n]) => ({
              label: ch,
              value: n,
              color: CH_COLORS[ch] || "var(--text-3)",
            }))}
          />
        )}
      </Panel>
    </div>
  );
}

/** Stat compacto (valor + caption) para los promedios de la fila de esfuerzo. */
function EffortStat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border-1)",
        borderLeft: `3px solid ${color}`,
        background: `color-mix(in srgb, ${color} 5%, var(--bg-2))`,
        padding: "9px 11px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 19,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-.01em",
          color: "var(--text-1)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "var(--text-3)",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** Mapa de calor día × hora (CSS grid). */
function Heatmap({ heat, max }: { heat: number[][]; max: number }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "34px repeat(24, 1fr)",
          gap: 3,
          minWidth: 640,
        }}
      >
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ fontSize: 9, color: "var(--text-3)", textAlign: "center" }}>
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
        {heat.map((row, wd) => (
          <Fragment key={wd}>
            <div
              style={{
                fontSize: 10.5,
                color: "var(--text-3)",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
              }}
            >
              {WEEKDAYS[wd]}
            </div>
            {row.map((n, h) => {
              const int = n / max;
              return (
                <div
                  key={`${wd}-${h}`}
                  title={`${WEEKDAYS[wd]} ${String(h).padStart(2, "0")}:00 · ${n} tipificaciones`}
                  style={{
                    height: 18,
                    borderRadius: 4,
                    background:
                      n === 0
                        ? "var(--bg-2)"
                        : `color-mix(in srgb, var(--gold) ${Math.round(18 + int * 82)}%, var(--bg-2))`,
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
