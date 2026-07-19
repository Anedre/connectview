import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { format } from "date-fns";
import { UserPlus, Sparkle, Check, GraduationCap, ArrowClockwise } from "@phosphor-icons/react";
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
import { Kpi, KpiRow } from "@/components/reports/kit";
import { HeroBand, Btn } from "@/components/aria";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * TipificacionesPage — la vista "Últimas Tipificaciones" que pidió la UDEP
 * (Posgrados & Formación Continua), réplica NATIVA de su dashboard de QuickSight:
 * filtros (Agente/Estado/Sub-Estado/Origen/Fecha) + KPI Total + barra apilada de
 * % de estado por programa + recuento por estado + tabla de últimas tipificaciones.
 *
 * Datos: manage-leads ?report=typifications[&programId=] — devuelve una fila por
 * lead con estado/sub-estado/agente/origen/programa + fecha de la última
 * tipificación (del history). El scope de PROGRAMA lo da el switcher global
 * (ProgramContext); los filtros finos se aplican en vivo aquí (como QuickSight).
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

// Paleta distinta por etapa (para el apilado y el recuento) — cohesiva con la
// infográfica de ECharts, pero con suficientes tonos para ~10 estados.
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

/** Panel premium (borde + radio + título) reutilizado en toda la vista. */
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

/** Un `<select>` estilizado con tokens ARIA — el filtro tipo "Todo" del QuickSight. */
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

/** Un input de fecha estilizado (desde/hasta). */
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

export function TipificacionesPage() {
  const { activeProgramId, activeProgram, programs } = useProgram();
  const { tree } = useTaxonomy(activeProgram?.taxonomyId);
  const ep = getApiEndpoints();

  // Fetch con auto-refresh (tiempo real, cada 45s) + refetch manual.
  const { data, isLoading, error, refetch, isFetching } = useQuery<TypResp | undefined>({
    queryKey: ["typifications", activeProgramId],
    enabled: !!ep?.manageLeads,
    refetchInterval: 45_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const scoped = activeProgramId && activeProgramId !== "all";
      const url = `${ep!.manageLeads}?report=typifications${
        scoped ? `&programId=${encodeURIComponent(activeProgramId)}` : ""
      }`;
      const r = await authedFetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { typifications?: TypResp };
      return j.typifications;
    },
  });

  const rows: TypRow[] = useMemo(() => data?.rows ?? [], [data]);

  // stageId → meta (label, color, valoración, orden) desde la taxonomía activa.
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

  const programMap = useMemo(() => new Map(programs.map((p) => [p.programId, p])), [programs]);
  const programLabel = (pid: string): string => {
    if (pid === NONE_PROGRAM) return "Sin programa";
    const p = programMap.get(pid);
    return p ? p.code || p.name : pid.slice(0, 6);
  };
  const rowProgramLabel = (r: TypRow): string => {
    if (!r.programIds.length) return "—";
    const first = programLabel(r.programIds[0]);
    return r.programIds.length > 1 ? `${first} +${r.programIds.length - 1}` : first;
  };

  // ── Filtros (client-side, en vivo como QuickSight) ────────────────────────
  const [fAgent, setFAgent] = useState("all");
  const [fStage, setFStage] = useState("all");
  const [fSub, setFSub] = useState("all");
  const [fSource, setFSource] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const agentOpts = useMemo(() => uniqueSorted(rows.map((r) => r.agent)), [rows]);
  const sourceOpts = useMemo(() => uniqueSorted(rows.map((r) => r.source)), [rows]);
  // Estados presentes (en orden de la taxonomía; los desconocidos al final).
  const stageOpts = useMemo(() => {
    const present = new Set(rows.map((r) => r.stageId).filter((s): s is string => !!s));
    const known = tree.filter((s) => present.has(s.id)).map((s) => ({ id: s.id, label: s.label }));
    const knownIds = new Set(tree.map((s) => s.id));
    const extra = Array.from(present)
      .filter((id) => !knownIds.has(id))
      .map((id) => ({ id, label: prettyStage(id) }));
    return [...known, ...extra];
  }, [rows, tree]);
  const subOpts = useMemo(
    () =>
      uniqueSorted(
        rows.filter((r) => fStage === "all" || r.stageId === fStage).map((r) => r.subStageLabel),
      ),
    [rows, fStage],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (fAgent !== "all" && (r.agent || "") !== fAgent) return false;
        if (fStage !== "all" && (r.stageId || "") !== fStage) return false;
        if (fSub !== "all" && (r.subStageLabel || "") !== fSub) return false;
        if (fSource !== "all" && (r.source || "") !== fSource) return false;
        if (fFrom || fTo) {
          const d = (r.typifiedAt || r.createdAt || "").slice(0, 10);
          if (!d) return false;
          if (fFrom && d < fFrom) return false;
          if (fTo && d > fTo) return false;
        }
        return true;
      }),
    [rows, fAgent, fStage, fSub, fSource, fFrom, fTo],
  );

  const anyFilter =
    fAgent !== "all" || fStage !== "all" || fSub !== "all" || fSource !== "all" || !!fFrom || !!fTo;
  const clearFilters = () => {
    setFAgent("all");
    setFStage("all");
    setFSub("all");
    setFSource("all");
    setFFrom("");
    setFTo("");
  };

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    let nuevos = 0;
    let tipificados = 0;
    let cierre = 0;
    for (const r of filtered) {
      if (r.typifiedAt) tipificados++;
      const val = r.stageId ? stageMeta.get(r.stageId)?.valoracion : undefined;
      if (r.stageId === "nuevo_lead" || (!r.typifiedAt && val === "inicial")) nuevos++;
      if (val === "cierre") cierre++;
    }
    return { total: filtered.length, nuevos, tipificados, cierre };
  }, [filtered, stageMeta]);

  // ── Recuento por estado (barras horizontales) ─────────────────────────────
  const byStage = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) {
      const k = r.stageId || "(sin etapa)";
      m.set(k, (m.get(k) || 0) + 1);
    }
    const known = tree
      .filter((s) => m.has(s.id))
      .map((s) => ({ id: s.id, label: s.label, count: m.get(s.id)! }));
    const knownIds = new Set(tree.map((s) => s.id));
    const extra = Array.from(m.entries())
      .filter(([id]) => !knownIds.has(id))
      .map(([id, count]) => ({
        id,
        label: id === "(sin etapa)" ? "Sin etapa" : prettyStage(id),
        count,
      }));
    return [...known, ...extra];
  }, [filtered, tree]);

  // ── % de estado por programa (apilado) ────────────────────────────────────
  const byProgram = useMemo(() => {
    const perProgram = new Map<string, Map<string, number>>();
    const totals = new Map<string, number>();
    for (const r of filtered) {
      const pids = r.programIds.length ? r.programIds : [NONE_PROGRAM];
      const stage = r.stageId || "(sin etapa)";
      for (const pid of pids) {
        if (!perProgram.has(pid)) perProgram.set(pid, new Map());
        const sm = perProgram.get(pid)!;
        sm.set(stage, (sm.get(stage) || 0) + 1);
        totals.set(pid, (totals.get(pid) || 0) + 1);
      }
    }
    const top = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([pid, total]) => ({ pid, total, label: programLabel(pid) }));
    // Estados presentes en estos programas, en orden de la taxonomía.
    const present = new Set<string>();
    for (const p of top) for (const s of perProgram.get(p.pid)!.keys()) present.add(s);
    const known = tree.filter((s) => present.has(s.id)).map((s) => ({ id: s.id, label: s.label }));
    const knownIds = new Set(tree.map((s) => s.id));
    const extra = Array.from(present)
      .filter((id) => !knownIds.has(id))
      .map((id) => ({ id, label: id === "(sin etapa)" ? "Sin etapa" : prettyStage(id) }));
    const stages = [...known, ...extra];
    return { top, stages, perProgram };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, tree, programMap]);

  // ── Tabla de últimas tipificaciones ───────────────────────────────────────
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const columns = useMemo<ColumnDef<TypRow>[]>(
    () => [
      {
        accessorKey: "phone",
        header: "Nº Teléfono",
        cell: ({ getValue }) => (
          <span style={{ fontWeight: 600 }}>{getValue<string>() || "—"}</span>
        ),
      },
      {
        id: "fecCarga",
        accessorFn: (r) => r.createdAt || "",
        header: "Fec. Carga",
        cell: ({ row }) => fmtDate(row.original.createdAt),
      },
      {
        id: "horaCarga",
        accessorFn: (r) => r.createdAt || "",
        header: "Hora",
        cell: ({ row }) => fmtTime(row.original.createdAt),
        enableSorting: false,
      },
      { id: "origen", accessorFn: (r) => sourceLabel(r.source), header: "Origen" },
      { id: "programa", accessorFn: (r) => rowProgramLabel(r), header: "Programa" },
      { id: "agente", accessorFn: (r) => r.agent || "—", header: "Agente" },
      {
        id: "fecTip",
        accessorFn: (r) => r.typifiedAt || "",
        header: "Fec. Tipificación",
        cell: ({ row }) => fmtDate(row.original.typifiedAt),
      },
      {
        id: "horaTip",
        accessorFn: (r) => r.typifiedAt || "",
        header: "Hora",
        cell: ({ row }) => fmtTime(row.original.typifiedAt),
        enableSorting: false,
      },
      {
        id: "estado",
        accessorFn: (r) => stageLabel(r.stageId),
        header: "Estado",
        cell: ({ row }) => {
          const id = row.original.stageId;
          const c = stageColor(id);
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
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: c,
                  flex: "0 0 auto",
                }}
              />
              {stageLabel(id)}
            </span>
          );
        },
      },
      { id: "subestado", accessorFn: (r) => r.subStageLabel || "—", header: "Sub. Estado" },
      {
        id: "comentarios",
        accessorFn: (r) => r.comments || "",
        header: "Comentarios",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            title={row.original.comments || undefined}
            style={{
              display: "inline-block",
              maxWidth: 240,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--text-2)",
            }}
          >
            {row.original.comments || "—"}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stageMeta, programMap],
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
    <div className="page" style={{ maxWidth: 1440 }}>
      <HeroBand
        title="Últimas Tipificaciones"
        chip={
          <>
            {scopeLabel} · {kpis.total} leads
          </>
        }
        chipIcon="chart"
        chipTone="var(--gold)"
        right={
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
        }
      />

      {/* Barra de filtros — el switcher de Programa global (arriba) define el scope. */}
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
            onChange={(v) => {
              setFStage(v);
              setFSub("all");
            }}
            options={[
              { value: "all", label: "Todo" },
              ...stageOpts.map((s) => ({ value: s.id, label: s.label })),
            ]}
          />
          <FilterSelect
            label="Sub. Estado"
            value={fSub}
            onChange={setFSub}
            options={[
              { value: "all", label: "Todo" },
              ...subOpts.map((s) => ({ value: s, label: s })),
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
          No se pudo cargar la vista: {error instanceof Error ? error.message : "error"}. Verifica
          que la función manage-leads esté desplegada con el reporte de tipificaciones.
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
          Sin leads para {scopeLabel.toLowerCase()} todavía.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {data?.truncated && (
            <div className="chip chip--gold" style={{ display: "block", padding: "8px 12px" }}>
              Mostrando las 5.000 tipificaciones más recientes (hay más). Filtra por programa o
              fecha para acotar.
            </div>
          )}

          {/* KPIs */}
          <KpiRow>
            <Kpi
              icon={<UserPlus size={14} />}
              color="var(--gold)"
              label="Total de leads"
              value={kpis.total}
              sub={anyFilter ? "con los filtros activos" : `${scopeLabel}`}
            />
            <Kpi
              icon={<Sparkle size={14} />}
              color="var(--cyan)"
              label="Nuevos"
              value={kpis.nuevos}
              sub="sin tipificar aún"
            />
            <Kpi
              icon={<Check size={14} />}
              color="var(--green)"
              label="Tipificados"
              value={kpis.tipificados}
              sub={
                kpis.total ? `${Math.round((kpis.tipificados / kpis.total) * 100)}% del total` : "—"
              }
            />
            <Kpi
              icon={<GraduationCap size={14} />}
              color="var(--iris)"
              label="Inscritos / cierre"
              value={kpis.cierre}
              sub="etapas de cierre"
            />
          </KpiRow>

          {/* Gráficos: apilado por programa + recuento por estado */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            <Panel title="Porcentaje de estado por programa">
              {byProgram.top.length === 0 ? (
                <div style={{ color: "var(--text-3)", fontSize: 13, padding: 16 }}>Sin datos.</div>
              ) : (
                <StackedByProgram data={byProgram} stageColor={stageColor} />
              )}
            </Panel>
            <Panel title="Recuento por estado">
              {byStage.length === 0 ? (
                <div style={{ color: "var(--text-3)", fontSize: 13, padding: 16 }}>Sin datos.</div>
              ) : (
                <CountByStage rows={byStage} stageColor={stageColor} />
              )}
            </Panel>
          </div>

          {/* Tabla de últimas tipificaciones */}
          <Panel
            title="Detalle de tipificaciones"
            right={
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{filtered.length} filas</span>
            }
          >
            <div style={{ overflowX: "auto" }}>
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
                            onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                            style={{
                              cursor: canSort ? "pointer" : "default",
                              userSelect: "none",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
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
                  {table.getRowModel().rows.map((row) => (
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
          </Panel>
        </div>
      )}
    </div>
  );
}

/** Barra horizontal 100%-apilada: una barra por programa, segmentos = estados. */
function StackedByProgram({
  data,
  stageColor,
}: {
  data: {
    top: Array<{ pid: string; total: number; label: string }>;
    stages: Array<{ id: string; label: string }>;
    perProgram: Map<string, Map<string, number>>;
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
      data: data.top.map((p) => p.label),
      axisLabel: { color: t.text2, fontWeight: 600 },
      axisLine: { lineStyle: { color: t.border } },
    },
    series: data.stages.map((s) => ({
      name: s.label,
      type: "bar",
      stack: "total",
      emphasis: { focus: "series" },
      itemStyle: { color: stageColor(s.id) },
      data: data.top.map((p) => {
        const c = data.perProgram.get(p.pid)?.get(s.id) || 0;
        return p.total ? +((c / p.total) * 100).toFixed(1) : 0;
      }),
    })),
  };
  return <EChart option={option} height={Math.max(180, data.top.length * 44 + 60)} />;
}

/** Barras horizontales de recuento por estado (con el número al costado). */
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
