import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
  MagnifyingGlass,
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
import { EChart, useChartTokens, type ChartTokens } from "@/components/charts/EChart";
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

/**
 * Paleta "ink" del reporte (portada del concepto PULSO y validada con el
 * validador de dataviz en light #ffffff y dark #101011: banda de luminancia,
 * piso de croma, separación CVD adyacente y contraste ≥3:1).
 * Regla de uso: iris y cielo nunca adyacentes.
 */
const INK = {
  jade: "#23A878",
  iris: "#6D80F2",
  oro: "#BD8412",
  magenta: "#DA5A9E",
  cielo: "#3093D8",
  slate: "#66738A",
} as const;
/** Orden categórico fijo (dona por origen, canales). */
const INK_CAT = [INK.jade, INK.iris, INK.oro, INK.magenta, INK.cielo];
/** Rampa jade ordinal (profundidad de avance en el pipeline), validada monotónica. */
const JADE_RAMP = ["#4EC393", "#23A878", "#1D8E68", "#177355", "#115843"];
/** Grupos semánticos por valoración de la taxonomía — el color carga el ROL del
 *  estado (entrada / avance / cierre / perdido), no 9 hues indistinguibles. */
const STAGE_GROUPS: Record<Valoracion | "none", { label: string; color: string }> = {
  inicial: { label: "Nuevo", color: INK.cielo },
  positiva: { label: "En gestión", color: INK.jade },
  cierre: { label: "Cierre", color: INK.oro },
  negativa: { label: "No viable", color: INK.magenta },
  none: { label: "Sin etapa", color: INK.slate },
};
const GROUP_ORDER: Array<Valoracion | "none"> = [
  "inicial",
  "positiva",
  "cierre",
  "negativa",
  "none",
];
/** Grid de cada slide del carrusel: dos paneles lado a lado (colapsa a 1 col). */
const carouselGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
  gap: 16,
};

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

/** Colores de canal para "Golpes por canal" — orden categórico ink fijo. */
const CH_COLORS: Record<string, string> = {
  Llamada: INK.cielo,
  WhatsApp: INK.jade,
  Correo: INK.oro,
  Chat: INK.magenta,
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

/** Tooltip con acabado de tarjeta ARIA (radio, sombra, tokens) para todos los
 *  charts del tab — ECharts renderiza el tooltip como HTML, así que hereda esto. */
function premiumTooltip(t: ChartTokens): NonNullable<EChartsOption["tooltip"]> {
  return {
    // Al body: el carrusel recorta con overflow:hidden y un tooltip alto (p.ej.
    // el desglose por estado) quedaría decapitado dentro del track.
    appendToBody: true,
    confine: true,
    backgroundColor: t.bg1,
    borderColor: t.border,
    borderWidth: 1,
    padding: [10, 14],
    textStyle: { color: t.text1, fontSize: 12.5 },
    extraCssText:
      "border-radius:12px;box-shadow:0 14px 36px rgba(4,10,20,.22);backdrop-filter:blur(6px);",
  };
}
/** Fila de tooltip: dot de color + etiqueta + valor tabular alineado a la derecha. */
function ttRow(color: string | null, name: string, value: string): string {
  const dot = color
    ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:7px"></span>`
    : `<span style="display:inline-block;width:8px;margin-right:7px"></span>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;line-height:1.9">
    <span style="display:flex;align-items:center;min-width:0">${dot}<span>${name}</span></span>
    <b style="font-variant-numeric:tabular-nums">${value}</b></div>`;
}
function ttTitle(text: string): string {
  return `<div style="font-weight:800;font-size:12px;margin-bottom:4px">${text}</div>`;
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

/**
 * ChartCarousel — solo DOS gráficos a la vista; el resto vive en slides que se
 * deslizan con flechas, dots o ←/→. Todos los slides quedan montados (los
 * charts miden bien y no re-animan al volver); los ocultos van `inert`.
 */
function ChartCarousel({
  slides,
}: {
  slides: Array<{ key: string; title: string; hint?: string; content: ReactNode }>;
}) {
  const [idx, setIdx] = useState(0);
  const i = Math.min(idx, slides.length - 1);
  const go = (d: number) => setIdx((v) => Math.min(slides.length - 1, Math.max(0, v + d)));

  // Altura del viewport = la del slide ACTIVO (animada). Sin esto, el track
  // hereda la altura del slide más alto y los cortos dejan un hueco debajo.
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [viewH, setViewH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = slideRefs.current[i];
    if (!el) return;
    const measure = () => setViewH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure); // los charts montan async y crecen
    ro.observe(el);
    return () => ro.disconnect();
  }, [i, slides.length]);

  if (slides.length === 0) return null;

  const navBtn = (dir: -1 | 1, disabled: boolean) => (
    <button
      type="button"
      aria-label={dir < 0 ? "Anterior" : "Siguiente"}
      onClick={() => go(dir)}
      disabled={disabled}
      style={{
        width: 30,
        height: 30,
        display: "grid",
        placeItems: "center",
        borderRadius: 10,
        border: "1px solid var(--border-1)",
        background: "var(--bg-1)",
        color: disabled ? "var(--text-3)" : "var(--text-1)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "background .15s, transform .15s, opacity .15s",
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <CaretDown
        size={15}
        weight="bold"
        style={{ transform: dir < 0 ? "rotate(90deg)" : "rotate(-90deg)" }}
      />
    </button>
  );

  return (
    <section
      aria-roledescription="carrusel"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      <div
        className="row between"
        style={{ alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{slides[i].title}</div>
          {slides[i].hint && (
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 1 }}>
              {slides[i].hint}
            </div>
          )}
        </div>
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <div className="row" style={{ alignItems: "center", gap: 6 }} role="tablist">
            {slides.map((s, n) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={n === i}
                aria-label={s.title}
                title={s.title}
                onClick={() => setIdx(n)}
                style={{
                  width: n === i ? 22 : 7,
                  height: 7,
                  borderRadius: 99,
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  background: n === i ? "var(--text-1)" : "var(--border-1)",
                  transition: "width .3s cubic-bezier(.22,.61,.36,1), background .2s",
                }}
              />
            ))}
          </div>
          <span
            style={{
              fontSize: 11.5,
              color: "var(--text-3)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 34,
              textAlign: "center",
            }}
          >
            {i + 1} / {slides.length}
          </span>
          {navBtn(-1, i === 0)}
          {navBtn(1, i === slides.length - 1)}
        </div>
      </div>
      <div
        style={{
          overflow: "hidden",
          margin: "0 -2px",
          height: viewH,
          transition: "height .5s cubic-bezier(.22,.61,.36,1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            transform: `translateX(-${i * 100}%)`,
            transition: "transform .55s cubic-bezier(.22,.61,.36,1)",
          }}
        >
          {slides.map((s, n) => (
            <div
              key={s.key}
              ref={(el) => {
                slideRefs.current[n] = el;
              }}
              inert={n !== i}
              aria-hidden={n !== i}
              style={{ flex: "0 0 100%", minWidth: 0, padding: "0 2px" }}
            >
              {s.content}
            </div>
          ))}
        </div>
      </div>
    </section>
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

/** Consulta por teléfono o nombre — equivalente al tab "Consulta teléfono" del BI de origen. */
function SearchInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label
      style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 190px" }}
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
      <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <MagnifyingGlass
          size={14}
          weight="bold"
          style={{ position: "absolute", left: 10, color: "var(--text-3)", pointerEvents: "none" }}
        />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            height: 34,
            width: "100%",
            borderRadius: 9,
            border: "1px solid var(--border-1)",
            background: "var(--bg-2)",
            color: "var(--text-1)",
            padding: "0 10px 0 30px",
            fontSize: 13,
            fontWeight: 600,
          }}
        />
      </span>
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
    // Positivas: paso de la rampa jade según su profundidad relativa (más
    // avanzado = más oscuro). Resto: el color de su grupo semántico.
    const positivas = tree.filter((s) => s.valoracion === "positiva");
    const rampAt = (i: number): string =>
      JADE_RAMP[
        positivas.length <= 1
          ? 1
          : Math.round((i * (JADE_RAMP.length - 1)) / (positivas.length - 1))
      ];
    tree.forEach((s, i) => {
      m.set(s.id, {
        label: s.label,
        color:
          s.valoracion === "positiva"
            ? rampAt(positivas.findIndex((p) => p.id === s.id))
            : STAGE_GROUPS[s.valoracion].color,
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
  const [fSubStage, setFSubStage] = useState("all");
  const [fSource, setFSource] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fQuery, setFQuery] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  const agentOpts = useMemo(() => uniqueSorted(rows.map((r) => r.agent)), [rows]);
  const sourceOpts = useMemo(() => uniqueSorted(rows.map((r) => r.source)), [rows]);
  // Orígenes por volumen del scope completo (NO responde a filtros): fija qué
  // entidades reciben hue en la dona — los grandes con color, la cola a "Otros".
  const sourcesByVolume = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) if (r.source) c.set(r.source, (c.get(r.source) || 0) + 1);
    return Array.from(c.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
  }, [rows]);
  const subStageOpts = useMemo(() => uniqueSorted(rows.map((r) => r.subStageLabel)), [rows]);
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
        if (fSubStage !== "all" && (r.subStageLabel || "") !== fSubStage) return false;
        if (fSource !== "all" && (r.source || "") !== fSource) return false;
        if (fFrom || fTo) {
          const d = (r.typifiedAt || r.createdAt || "").slice(0, 10);
          if (!d) return false;
          if (fFrom && d < fFrom) return false;
          if (fTo && d > fTo) return false;
        }
        if (fQuery.trim()) {
          const q = fQuery.trim().toLowerCase();
          const qDigits = q.replace(/\D+/g, "");
          const phoneHit =
            qDigits.length > 0 && (r.phone || "").replace(/\D+/g, "").includes(qDigits);
          const nameHit = (r.name || "").toLowerCase().includes(q);
          if (!phoneHit && !nameHit) return false;
        }
        return true;
      }),
    [rows, fAgent, fStage, fSubStage, fSource, fFrom, fTo, fQuery],
  );
  const anyFilter =
    fAgent !== "all" ||
    fStage !== "all" ||
    fSubStage !== "all" ||
    fSource !== "all" ||
    !!fFrom ||
    !!fTo ||
    !!fQuery.trim();
  const clearFilters = () => {
    setFAgent("all");
    setFStage("all");
    setFSubStage("all");
    setFSource("all");
    setFFrom("");
    setFTo("");
    setFQuery("");
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
      color: stageMeta.get(s.id)?.color || INK.jade,
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
  const [sorting, setSorting] = useState<SortingState>([{ id: "fecCarga", desc: true }]);
  const columns = useMemo<ColumnDef<TypRow>[]>(
    () => [
      {
        accessorKey: "phone",
        header: "Teléfono",
        cell: ({ getValue }) => (
          <span style={{ fontWeight: 600 }}>{getValue<string>() || "—"}</span>
        ),
      },
      {
        id: "fecCarga",
        accessorFn: (r) => r.createdAt || "",
        header: "Fec. Carga",
        cell: ({ row }) =>
          `${fmtDate(row.original.createdAt)} ${row.original.createdAt ? fmtTime(row.original.createdAt) : ""}`.trim(),
      },
      { id: "origen", accessorFn: (r) => sourceLabel(r.source), header: "Origen" },
      ...(activeProgramId === "all"
        ? [
            {
              id: "programa",
              accessorFn: (r) => r.programIds.map(programLabel).join(", ") || "—",
              header: "Programa",
            } satisfies ColumnDef<TypRow>,
          ]
        : []),
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
        id: "comentarios",
        accessorFn: (r) => r.comments || "",
        header: "Comentarios",
        cell: ({ getValue }) => {
          const c = getValue<string>();
          return c ? (
            <span
              title={c}
              style={{
                display: "inline-block",
                maxWidth: 220,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                verticalAlign: "bottom",
                color: "var(--text-2)",
              }}
            >
              {c}
            </span>
          ) : (
            "—"
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stageMeta, activeProgramId, programMap],
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
          <SearchInput
            label="Consulta teléfono / nombre"
            value={fQuery}
            onChange={setFQuery}
            placeholder="Ej. 953730189 o Karina"
          />
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
          {(subStageOpts.length > 0 || fSubStage !== "all") && (
            <FilterSelect
              label="Sub. Estado"
              value={fSubStage}
              onChange={setFSubStage}
              options={[
                { value: "all", label: "Todo" },
                ...uniqueSorted([...subStageOpts, fSubStage === "all" ? null : fSubStage]).map(
                  (s) => ({ value: s, label: s }),
                ),
              ]}
            />
          )}
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

          {/* Carrusel: dos gráficos a la vista; el resto se desliza. */}
          <ChartCarousel
            slides={[
              {
                key: "estados",
                title: "Estados del pipeline",
                hint: "Composición por programa y recuento por estado",
                content: (
                  <div style={carouselGrid}>
                    <Panel title="Porcentaje de estado por programa">
                      {M.topPrograms.length === 0 ? (
                        <div style={{ color: "var(--text-3)", fontSize: 13 }}>Sin datos.</div>
                      ) : (
                        <StackedByProgram M={M} meta={stageMeta} />
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
                ),
              },
              {
                key: "conversion",
                title: "Conversión",
                hint: "Embudo del camino positivo y aporte de cada origen",
                content: (
                  <div style={carouselGrid}>
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
                          stages={M.funnel.map((f) => ({
                            label: f.label,
                            value: f.count,
                            color: f.color,
                          }))}
                        />
                      )}
                    </Panel>
                    <Panel title="Distribución por origen">
                      <OriginPanel data={M.bySource} allSources={sourcesByVolume} />
                    </Panel>
                  </div>
                ),
              },
              {
                key: "equipo",
                title: "Equipo y tendencia",
                hint: "Volumen por agente y tipificaciones por día",
                content: (
                  <div style={carouselGrid}>
                    <Panel title="Rendimiento por agente">
                      {M.byAgent.length === 0 ? (
                        <div style={{ color: "var(--text-3)", fontSize: 13 }}>
                          Sin agentes asignados en la data. Al importar o gestionar con agente,
                          aparece aquí.
                        </div>
                      ) : (
                        <AgentPanel data={M.byAgent} />
                      )}
                    </Panel>
                    <Panel title="Tendencia de tipificaciones">
                      {M.byDay.length === 0 ? (
                        <div style={{ color: "var(--text-3)", fontSize: 13 }}>
                          Sin fechas de tipificación.
                        </div>
                      ) : (
                        <TrendPanel data={M.byDay} />
                      )}
                    </Panel>
                  </div>
                ),
              },
              {
                key: "ritmo",
                title: "Ritmo de gestión",
                hint: "Qué tan rápido se gestiona y en qué franjas",
                content: (
                  <div style={carouselGrid}>
                    <Panel title="Velocidad de gestión (carga → tipificación)">
                      {M.speedN === 0 ? (
                        <div style={{ color: "var(--text-3)", fontSize: 13 }}>
                          Sin datos de velocidad todavía.
                        </div>
                      ) : (
                        <BarList
                          color={INK.cielo}
                          rows={M.speedBuckets.map((b) => ({ label: b.label, value: b.n }))}
                        />
                      )}
                    </Panel>
                    <Panel title="Mapa de calor · gestión por día y hora">
                      <Heatmap heat={M.heat} max={M.heatMax} />
                    </Panel>
                  </div>
                ),
              },
              // Esfuerzo (?report=attribution) — portado del viejo ProgramReport.
              // Oculto con scope "Sin programa" (attribution no sabe scopear ahí).
              ...(attr && attr.totalLeads > 0
                ? [
                    {
                      key: "esfuerzo",
                      title: "Esfuerzo de contacto",
                      hint: "Cuántos golpes cuesta convertir y por qué canal",
                      content: <EffortRow attr={attr} anyFilter={anyFilter} />,
                    },
                  ]
                : []),
            ]}
          />

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
  meta,
}: {
  M: {
    topPrograms: Array<{ pid: string; total: number; label: string }>;
    stackStages: Array<{ id: string; label: string }>;
    byProgramStage: Map<string, Map<string, number>>;
  };
  meta: Map<string, { label: string; color: string; valoracion: Valoracion; order: number }>;
}) {
  const t = useChartTokens();
  // Segmentos = GRUPOS semánticos (4-5 hues validados y distinguibles), no los
  // 9+ estados crudos — dos estados del mismo grupo serían ilegibles apilados.
  // El detalle por estado no se pierde: vive en el tooltip.
  const groups = useMemo(() => {
    const g = GROUP_ORDER.map((key) => ({
      key,
      ...STAGE_GROUPS[key],
      stages: [] as Array<{ id: string; label: string }>,
    }));
    for (const s of M.stackStages) {
      const val = meta.get(s.id)?.valoracion ?? "none";
      g.find((x) => x.key === val)!.stages.push(s);
    }
    return g.filter((x) => x.stages.length > 0);
  }, [M.stackStages, meta]);

  const option: EChartsOption = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 8, bottom: 30, containLabel: true },
      legend: {
        bottom: 0,
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 14,
        textStyle: { color: t.text2, fontSize: 11.5 },
        type: "scroll",
      },
      tooltip: {
        ...premiumTooltip(t),
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(120,130,150,0.08)" } },
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          if (!list.length) return "";
          const di = (list[0] as { dataIndex: number }).dataIndex;
          const prog = M.topPrograms[di];
          if (!prog) return "";
          const counts = M.byProgramStage.get(prog.pid);
          let html = ttTitle(`${prog.label} · ${prog.total} leads`);
          for (const g of groups) {
            const n = g.stages.reduce((a, s) => a + (counts?.get(s.id) || 0), 0);
            if (!n) continue;
            html += ttRow(g.color, `<b>${g.label}</b>`, `${Math.round((n / prog.total) * 100)}%`);
            if (g.stages.length > 1) {
              for (const s of g.stages) {
                const sn = counts?.get(s.id) || 0;
                if (!sn) continue;
                html += `<div style="margin-left:15px">${ttRow(meta.get(s.id)?.color || g.color, s.label, String(sn))}</div>`;
              }
            }
          }
          return html;
        },
      },
      xAxis: {
        type: "value",
        max: 100,
        axisLabel: { color: t.text3, fontSize: 11, formatter: "{value}%" },
        splitLine: { lineStyle: { color: t.border, type: "dashed", opacity: 0.7 } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: M.topPrograms.map((p) => p.label),
        axisLabel: { color: t.text2, fontWeight: 600, fontSize: 12 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: groups.map((g) => ({
        name: g.label,
        type: "bar" as const,
        stack: "total",
        barWidth: "58%",
        emphasis: { focus: "series" as const },
        // Borde del color del panel = separador de 2px entre segmentos.
        itemStyle: { color: g.color, borderColor: t.bg1, borderWidth: 1 },
        animationDuration: 550,
        animationEasing: "cubicOut" as const,
        data: M.topPrograms.map((p) => {
          const n = g.stages.reduce((a, s) => a + (M.byProgramStage.get(p.pid)?.get(s.id) || 0), 0);
          return p.total ? +((n / p.total) * 100).toFixed(1) : 0;
        }),
      })),
    }),
    [M, groups, meta, t],
  );
  return <EChart option={option} height={Math.max(190, M.topPrograms.length * 44 + 64)} />;
}

function CountByStage({
  rows,
  stageColor,
}: {
  rows: Array<{ id: string; label: string; count: number }>;
  stageColor: (id: string) => string;
}) {
  const t = useChartTokens();
  const total = rows.reduce((a, r) => a + r.count, 0);
  const option: EChartsOption = useMemo(
    () => ({
      grid: { left: 8, right: 44, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        ...premiumTooltip(t),
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(120,130,150,0.08)" } },
        formatter: (params) => {
          const p = (Array.isArray(params) ? params[0] : params) as { dataIndex: number };
          const r = rows[p.dataIndex];
          if (!r) return "";
          return (
            ttTitle(r.label) +
            ttRow(stageColor(r.id), "Leads", String(r.count)) +
            ttRow(null, "Del total", total ? `${Math.round((r.count / total) * 100)}%` : "—")
          );
        },
      },
      xAxis: {
        type: "value",
        axisLabel: { color: t.text3, fontSize: 11 },
        splitLine: { lineStyle: { color: t.border, type: "dashed", opacity: 0.7 } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((r) => r.label),
        axisLabel: { color: t.text2, fontWeight: 600, fontSize: 12 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          barWidth: "58%",
          label: {
            show: true,
            position: "right",
            color: t.text2,
            fontWeight: 700,
            fontSize: 11.5,
            fontFamily: "inherit",
          },
          emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(4,10,20,0.25)" } },
          animationDuration: 500,
          animationDelay: (i: number) => i * 40,
          animationEasing: "cubicOut",
          data: rows.map((r) => ({
            value: r.count,
            itemStyle: { color: stageColor(r.id), borderRadius: [0, 4, 4, 0] },
          })),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, total, t],
  );
  return <EChart option={option} height={Math.max(180, rows.length * 38 + 30)} />;
}

/** Dona de volumen por origen + tasa de conversión por canal. */
function OriginPanel({
  data,
  allSources,
}: {
  data: Array<{ src: string; total: number; conv: number }>;
  /** Orígenes de TODO el scope (sin filtros), en orden estable: fija el color de
   *  cada entidad para que los filtros no repinten a los sobrevivientes. */
  allSources: string[];
}) {
  const t = useChartTokens();
  // Asignación fija entidad→hue sobre los primeros 5 orígenes del scope; el
  // resto se pliega en "Otros" (slate) en vez de inventar un 6º hue.
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    allSources.forEach((s, i) => {
      if (i < INK_CAT.length) m.set(s, INK_CAT[i]);
    });
    return m;
  }, [allSources]);
  const { slices, folded } = useMemo(() => {
    const named = data.filter((s) => colorOf.has(s.src));
    const rest = data.filter((s) => !colorOf.has(s.src));
    const out = named.map((s) => ({
      name: sourceLabel(s.src),
      value: s.total,
      color: colorOf.get(s.src)!,
    }));
    const restTotal = rest.reduce((a, s) => a + s.total, 0);
    if (restTotal > 0) out.push({ name: "Otros", value: restTotal, color: INK.slate });
    return { slices: out, folded: rest.length };
  }, [data, colorOf]);
  const grand = slices.reduce((a, s) => a + s.value, 0);

  const option: EChartsOption = useMemo(
    () => ({
      tooltip: {
        ...premiumTooltip(t),
        trigger: "item",
        formatter: (p) => {
          const item = p as { name: string; value: number; color: string };
          return (
            ttTitle(item.name) +
            ttRow(item.color, "Leads", String(item.value)) +
            ttRow(null, "Del total", grand ? `${Math.round((item.value / grand) * 100)}%` : "—")
          );
        },
      },
      legend: {
        bottom: 0,
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 14,
        textStyle: { color: t.text2, fontSize: 11.5 },
        type: "scroll",
      },
      // Total en el centro de la dona — el "headline" del panel.
      title: {
        text: String(grand),
        subtext: "leads",
        left: "49.5%",
        top: "34%",
        textAlign: "center",
        textStyle: { color: t.text1, fontSize: 26, fontWeight: 800 },
        subtextStyle: { color: t.text3, fontSize: 11.5 },
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "80%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: t.bg1, borderWidth: 3, borderRadius: 4 },
          label: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: { shadowBlur: 14, shadowColor: "rgba(4,10,20,0.28)" },
          },
          animationType: "scale",
          animationEasing: "cubicOut",
          animationDuration: 650,
          data: slices.map((s) => ({
            name: s.name,
            value: s.value,
            itemStyle: { color: s.color },
          })),
        },
      ],
    }),
    [slices, grand, t],
  );
  const convRows = data.filter((s) => colorOf.has(s.src));
  const maxConv = Math.max(0.0001, ...convRows.map((s) => (s.total ? s.conv / s.total : 0)));
  return (
    <div>
      <EChart option={option} height={216} />
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
          Conversión por canal{folded > 0 ? ` · ${folded} en "Otros"` : ""}
        </div>
        <BarList
          color={INK.jade}
          max={100}
          rows={convRows.map((s) => {
            const rate = s.total ? s.conv / s.total : 0;
            return {
              label: sourceLabel(s.src),
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
                  background: `linear-gradient(90deg, color-mix(in srgb, ${INK.jade} 55%, transparent), ${INK.jade})`,
                  transition: "width .5s cubic-bezier(.22,.61,.36,1)",
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
  const option: EChartsOption = useMemo(
    () => ({
      grid: { left: 8, right: 14, top: 16, bottom: 24, containLabel: true },
      tooltip: {
        ...premiumTooltip(t),
        trigger: "axis",
        axisPointer: {
          type: "line",
          lineStyle: { color: t.text3, width: 1, type: "dashed", opacity: 0.6 },
        },
        formatter: (params) => {
          const p = (Array.isArray(params) ? params[0] : params) as {
            dataIndex: number;
            value: number;
          };
          const [day] = data[p.dataIndex] ?? [""];
          return ttTitle(day) + ttRow(INK.jade, "Tipificaciones", String(p.value));
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: data.map(([d]) => d.slice(5)),
        axisLabel: { color: t.text3, fontSize: 10.5 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: t.text3, fontSize: 11 },
        splitLine: { lineStyle: { color: t.border, type: "dashed", opacity: 0.7 } },
      },
      series: [
        {
          type: "line",
          smooth: 0.35,
          symbol: "circle",
          symbolSize: 7,
          showSymbol: false,
          data: data.map(([, n]) => n),
          lineStyle: { color: INK.jade, width: 2.5, cap: "round" },
          itemStyle: { color: INK.jade, borderColor: t.bg1, borderWidth: 2 },
          emphasis: { scale: 1.4 },
          animationDuration: 700,
          animationEasing: "cubicOut",
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(35,168,120,0.26)" },
                { offset: 1, color: "rgba(35,168,120,0)" },
              ],
            },
          },
        },
      ],
    }),
    [data, t],
  );
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
          <EffortStat color={INK.cielo} value={fmt1(attr.avgGolpes)} label="golpes por lead" />
          <EffortStat
            color={INK.iris}
            value={attr.avgGolpesToClose ? fmt1(attr.avgGolpesToClose) : "—"}
            label="golpes al cierre"
          />
          <EffortStat
            color={INK.oro}
            value={attr.avgDaysToClose ? String(Math.round(attr.avgDaysToClose)) : "—"}
            label="días al cierre"
          />
        </div>
        <BarList
          color={INK.jade}
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
                        : `color-mix(in srgb, ${INK.jade} ${Math.round(16 + int * 84)}%, var(--bg-2))`,
                    transition: "transform .12s ease, box-shadow .12s ease",
                    cursor: n > 0 ? "default" : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (n === 0) return;
                    e.currentTarget.style.transform = "scale(1.25)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(4,10,20,.3)";
                    e.currentTarget.style.zIndex = "1";
                    e.currentTarget.style.position = "relative";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "";
                    e.currentTarget.style.boxShadow = "";
                    e.currentTarget.style.zIndex = "";
                    e.currentTarget.style.position = "";
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
