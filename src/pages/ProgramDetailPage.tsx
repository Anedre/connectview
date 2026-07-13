import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Btn, Card, Pill, Stat, Num, HeroBand, Icon } from "@/components/aria";
import { usePrograms, type Program, type ProgramStatus } from "@/hooks/usePrograms";
import { useProgram } from "@/context/ProgramContext";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useRoles } from "@/hooks/useRoles";
import { LeadImportModal } from "@/components/leads/LeadImportModal";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { initials } from "@/lib/initials";

interface ProgLead {
  leadId: string;
  name?: string;
  phone: string;
  stageId?: string;
  source?: string;
  montoEstimado?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** "hace 3 d" / "hoy" — fecha relativa compacta, sin dependencias. */
function ago(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const d = Math.floor(ms / 86_400_000);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 30) return `hace ${d} d`;
  const mo = Math.floor(d / 30);
  return `hace ${mo} mes${mo > 1 ? "es" : ""}`;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  "import-csv": "Import CSV",
  salesforce: "Salesforce",
  meta: "Meta Ads",
  whatsapp: "WhatsApp",
  webform: "Formulario",
};

/** Paleta cíclica para pintar las etapas del embudo (mismo espíritu que el board). */
const STAGE_COLORS = [
  "var(--cyan)",
  "var(--accent, #6366f1)",
  "#a78bfa",
  "var(--gold)",
  "#f59e0b",
  "var(--green)",
  "#ef4444",
  "#14b8a6",
];

const STATUS_META: Record<
  ProgramStatus,
  { label: string; tone: "green" | "red" | "outline"; color: string }
> = {
  borrador: { label: "Borrador", tone: "outline", color: "var(--text-3)" },
  activo: { label: "Activo", tone: "green", color: "var(--green)" },
  pausado: { label: "Pausado", tone: "outline", color: "var(--gold)" },
  cerrado: { label: "Cerrado", tone: "red", color: "var(--red)" },
  archivado: { label: "Archivado", tone: "outline", color: "var(--text-3)" },
};

function daysLeft(endDate?: string): number | null {
  if (!endDate) return null;
  const ms = new Date(endDate).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}

const inp: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-2)",
  border: "1px solid var(--border-1)",
  borderRadius: "var(--r-md, 10px)",
  padding: "8px 10px",
  color: "var(--text-1)",
  fontSize: 13,
};

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        gridColumn: full ? "1 / -1" : undefined,
      }}
    >
      <span className="dim" style={{ fontSize: 12 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * ProgramDetailPage — "Centro del programa" (/programs/:programId). Pantalla premium
 * que reúne, para UN programa: salud (KPIs + embudo por su propia taxonomía), su ficha
 * comercial editable, y la carga de leads (import CSV sin llamar · ver tablero · crear
 * campaña). Reemplaza el salto directo a /leads al hacer clic en una tarjeta del hub.
 */
export function ProgramDetailPage() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const { isAtLeast } = useRoles();
  const canManage = isAtLeast("Admins");
  const { setActiveProgram } = useProgram();
  const { programs, loading, saveProgram, transitionProgram } = usePrograms({
    includeArchived: true,
    refreshIntervalMs: 30_000,
  });

  const program = useMemo(
    () => programs.find((p) => p.programId === programId),
    [programs, programId],
  );
  const { tree, docs: taxDocs } = useTaxonomy(program?.taxonomyId);

  // Leads del programa (lista + actividad) — mismo endpoint que el board.
  const { data: programLeads = [] } = useQuery<ProgLead[]>({
    queryKey: ["program-leads", programId],
    queryFn: async () => {
      const ep = getApiEndpoints();
      if (!ep?.manageLeads || !programId) return [];
      const r = await authedFetch(`${ep.manageLeads}?programId=${encodeURIComponent(programId)}`);
      const d = await r.json();
      return Array.isArray(d.leads) ? (d.leads as ProgLead[]) : [];
    },
    enabled: !!programId,
    refetchInterval: 30_000,
  });
  const recentLeads = useMemo(
    () =>
      [...programLeads]
        .sort((a, b) =>
          String(b.createdAt || b.updatedAt || "").localeCompare(
            String(a.createdAt || a.updatedAt || ""),
          ),
        )
        .slice(0, 12),
    [programLeads],
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Program>>({});
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Al cargar/cambiar de programa, resetea el formulario de edición.
  useEffect(() => {
    if (program) setForm(program);
    setEditing(false);
  }, [program?.programId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !program) {
    return (
      <div className="page">
        <div className="dim" style={{ padding: 40, textAlign: "center" }}>
          Cargando programa…
        </div>
      </div>
    );
  }
  if (!program) {
    return (
      <div className="page">
        <div
          className="col gap12"
          style={{ padding: 48, alignItems: "center", textAlign: "center" }}
        >
          <Icon name="cap" size={30} />
          <h2 style={{ margin: 0 }}>Programa no encontrado</h2>
          <p className="dim" style={{ maxWidth: 380 }}>
            Puede que haya sido archivado o eliminado.
          </p>
          <Btn variant="primary" icon="chevL" onClick={() => navigate("/programs")}>
            Volver a Programas
          </Btn>
        </div>
      </div>
    );
  }

  const byStage = program.health?.byStage ?? program.metricsSnapshot?.byStage ?? {};
  const totalLeads = program.health?.leads ?? program.leadCount ?? 0;
  const maxStage = Math.max(1, ...tree.map((s) => byStage[s.id] ?? 0));
  const activeStages = tree.filter((s) => (byStage[s.id] ?? 0) > 0).length;
  const dleft = daysLeft(program.endDate);
  const st = STATUS_META[program.status] ?? STATUS_META.borrador;

  // Leads cuya etapa (membership) NO pertenece al embudo actual del programa: cuentan
  // en el total pero no en las barras → se muestran como bucket "otras" para que sume.
  const treeIds = new Set(tree.map((s) => s.id));
  const otherCount = Object.entries(byStage).reduce(
    (sum, [k, v]) => (treeIds.has(k) ? sum : sum + v),
    0,
  );
  const stageLabel = (id?: string) => tree.find((s) => s.id === id)?.label ?? id ?? "—";
  const leadsGoal = program.kpiTargets?.leadsGoal ?? 0;
  const goalPct = leadsGoal > 0 ? Math.min(100, Math.round((totalLeads / leadsGoal) * 100)) : 0;

  const goBoard = () => {
    setActiveProgram(program.programId);
    navigate("/leads");
  };
  const goCampaign = () => {
    setActiveProgram(program.programId);
    navigate("/campaigns/new");
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveProgram({
        ...program,
        ...form,
        code: program.code,
        name: (form.name || program.name).trim(),
      });
      setEditing(false);
      toast.success("Programa actualizado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (to: ProgramStatus) => {
    try {
      await transitionProgram(program.programId, to);
      toast.success(`Programa ${STATUS_META[to].label.toLowerCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el estado");
    }
  };

  const set = (k: keyof Program, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="page">
      <HeroBand
        title={
          <span className="row gap10" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => navigate("/programs")}
              title="Volver a Programas"
            >
              <Icon name="chevL" size={16} />
            </button>
            {program.name}
            <Pill tone={st.tone}>{st.label}</Pill>
          </span>
        }
        chip={
          <>
            {program.code}
            {program.faculty ? ` · ${program.faculty}` : ""} · Centro del programa
          </>
        }
        chipIcon="cap"
        chipTone={program.color || "var(--accent)"}
        right={
          <div className="row gap8">
            <Btn variant="ghost" size="sm" icon="users" onClick={goBoard}>
              Ver tablero
            </Btn>
            {canManage &&
              (editing ? (
                <>
                  <Btn variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancelar
                  </Btn>
                  <Btn variant="primary" size="sm" icon="check" onClick={save} disabled={saving}>
                    {saving ? "Guardando…" : "Guardar"}
                  </Btn>
                </>
              ) : (
                <Btn variant="ghost" size="sm" icon="sliders" onClick={() => setEditing(true)}>
                  Editar
                </Btn>
              ))}
          </div>
        }
      />

      {/* KPIs */}
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 18 }}
      >
        <Stat
          icon="users"
          color="var(--cyan)"
          label="Leads en el programa"
          value={<Num value={totalLeads} />}
          sub="membresías activas"
        />
        <Stat
          icon="layers"
          color="var(--accent)"
          label="Etapas con leads"
          value={<Num value={activeStages} />}
          sub={`de ${tree.length} del embudo`}
        />
        <Stat
          icon="target"
          color={st.color}
          label="Estado"
          value={<span style={{ fontSize: 22 }}>{st.label}</span>}
          sub={program.modality || "—"}
        />
        <Stat
          icon="clock"
          color="var(--gold)"
          label="Cierre"
          value={
            dleft == null ? (
              <span style={{ fontSize: 22 }}>—</span>
            ) : (
              <Num value={dleft} suffix=" d" />
            )
          }
          sub={program.endDate ? "para la fecha de cierre" : "sin fecha de cierre"}
        />
      </div>

      {/* Embudo del programa (su propia taxonomía) */}
      <Card
        title="Embudo del programa"
        icon="flow"
        extra={
          <span className="dim" style={{ fontSize: 12 }}>
            {taxDocs.find((d) => d.taxonomyId === program.taxonomyId)?.name ||
              taxDocs.find((d) => d.isDefault)?.name ||
              "Embudo por defecto"}
          </span>
        }
        style={{ marginBottom: 14 }}
      >
        {tree.length === 0 ? (
          <div className="dim">Este programa aún no tiene un embudo con etapas.</div>
        ) : (
          <div
            className="grid gap10"
            style={{ gridTemplateColumns: `repeat(${Math.min(tree.length, 6)}, 1fr)` }}
          >
            {tree.map((s, i) => {
              const n = byStage[s.id] ?? 0;
              const color = STAGE_COLORS[i % STAGE_COLORS.length];
              return (
                <div
                  key={s.id}
                  className="col gap6"
                  style={{
                    padding: "10px 11px",
                    borderRadius: "var(--r-md)",
                    border: "1px solid var(--border-1)",
                    background: "var(--bg-2)",
                  }}
                >
                  <div className="row between" style={{ alignItems: "center", gap: 6 }}>
                    <span className="trunc" style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {s.label}
                    </span>
                    <b style={{ fontSize: 15, color }}>{n}</b>
                  </div>
                  <div
                    style={{
                      height: 5,
                      borderRadius: 3,
                      background: "var(--bg-3, rgba(0,0,0,.06))",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${(n / maxStage) * 100}%`,
                        height: "100%",
                        background: color,
                        borderRadius: 3,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {otherCount > 0 && (
          <div
            className="row gap8"
            style={{ marginTop: 10, alignItems: "center", flexWrap: "wrap" }}
          >
            <Pill tone="outline">{otherCount} en otras etapas</Pill>
            <span className="dim" style={{ fontSize: 11.5 }}>
              leads en etapas que no son de este embudo — re-tipifícalos para verlos en las columnas
            </span>
          </div>
        )}
        {canManage && (
          <div
            className="row gap8"
            style={{ marginTop: 12, flexWrap: "wrap", alignItems: "center" }}
          >
            {editing ? (
              <label className="row gap8" style={{ alignItems: "center", fontSize: 12.5 }}>
                <span className="dim">Cambiar embudo:</span>
                <Select
                  value={form.taxonomyId || "default"}
                  onValueChange={(v) => set("taxonomyId", v && v !== "default" ? v : "")}
                >
                  <SelectTrigger style={{ minWidth: 200 }}>
                    <SelectValue placeholder="Embudo por defecto">
                      {form.taxonomyId
                        ? (taxDocs.find((d) => d.taxonomyId === form.taxonomyId)?.name ?? "Embudo")
                        : "Embudo por defecto (global)"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Embudo por defecto (global)</SelectItem>
                    {taxDocs
                      .filter((d) => !d.isDefault)
                      .map((d) => (
                        <SelectItem key={d.taxonomyId} value={d.taxonomyId}>
                          {d.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
            ) : (
              <Btn variant="ghost" size="sm" icon="settings" onClick={() => navigate("/admin")}>
                Editar etapas en Configuración
              </Btn>
            )}
          </div>
        )}
      </Card>

      {/* Ficha comercial */}
      <Card
        title="Ficha comercial"
        icon="cap"
        extra={
          <span className="dim" style={{ fontSize: 12 }}>
            Lo que cita el Agente IA
          </span>
        }
        className="mb14"
      >
        <div className="grid gap12" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Modalidad">
            {editing ? (
              <input
                style={inp}
                value={form.modality ?? ""}
                onChange={(e) => set("modality", e.target.value)}
                placeholder="Presencial / Virtual…"
              />
            ) : (
              <span style={{ fontSize: 13.5 }}>
                {program.modality || <span className="dim">—</span>}
              </span>
            )}
          </Field>
          <Field label="Duración">
            {editing ? (
              <input
                style={inp}
                value={form.duration ?? ""}
                onChange={(e) => set("duration", e.target.value)}
                placeholder="ej. 10 ciclos"
              />
            ) : (
              <span style={{ fontSize: 13.5 }}>
                {program.duration || <span className="dim">—</span>}
              </span>
            )}
          </Field>
          <Field label="Precio / inversión">
            {editing ? (
              <input
                style={inp}
                value={form.price ?? ""}
                onChange={(e) => set("price", e.target.value)}
                placeholder="ej. S/ 1200 por ciclo"
              />
            ) : (
              <span style={{ fontSize: 13.5 }}>
                {program.price || <span className="dim">—</span>}
              </span>
            )}
          </Field>
          <Field label="Facultad">
            {editing ? (
              <input
                style={inp}
                value={form.faculty ?? ""}
                onChange={(e) => set("faculty", e.target.value)}
                placeholder="ej. Humanidades"
              />
            ) : (
              <span style={{ fontSize: 13.5 }}>
                {program.faculty || <span className="dim">—</span>}
              </span>
            )}
          </Field>
          <Field label="Requisitos de admisión" full>
            {editing ? (
              <textarea
                style={{ ...inp, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                value={form.requirements ?? ""}
                onChange={(e) => set("requirements", e.target.value)}
                placeholder="Grado, documentos, prueba…"
              />
            ) : (
              <span style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>
                {program.requirements || <span className="dim">—</span>}
              </span>
            )}
          </Field>
          <Field label="Descripción" full>
            {editing ? (
              <textarea
                style={{ ...inp, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                placeholder="De qué trata el programa…"
              />
            ) : (
              <span style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>
                {program.description || <span className="dim">—</span>}
              </span>
            )}
          </Field>
        </div>

        {canManage && !editing && (
          <div
            className="row gap8"
            style={{ marginTop: 14, alignItems: "center", flexWrap: "wrap" }}
          >
            <span className="dim" style={{ fontSize: 12 }}>
              Estado:
            </span>
            {(["activo", "pausado", "cerrado"] as ProgramStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn--sm ${program.status === s ? "btn--soft" : "btn--ghost"}`}
                onClick={() => changeStatus(s)}
                disabled={program.status === s}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Leads del programa: meta + acciones de carga + lista */}
      <Card
        title="Leads del programa"
        icon="users"
        accent
        extra={
          <span className="dim" style={{ fontSize: 12 }}>
            {totalLeads} en total
          </span>
        }
      >
        {/* Meta de captación (kpiTargets.leadsGoal) */}
        {(leadsGoal > 0 || editing) && (
          <div className="col gap6" style={{ marginBottom: 14 }}>
            <div className="row between" style={{ alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Meta de captación</span>
              {editing ? (
                <span className="row gap6" style={{ alignItems: "center", fontSize: 12.5 }}>
                  <span className="dim">Objetivo:</span>
                  <input
                    type="number"
                    min={0}
                    style={{ ...inp, width: 110, padding: "5px 8px" }}
                    value={form.kpiTargets?.leadsGoal ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        kpiTargets: {
                          ...f.kpiTargets,
                          leadsGoal: Number(e.target.value) || undefined,
                        },
                      }))
                    }
                    placeholder="ej. 200"
                  />
                  <span className="dim">leads</span>
                </span>
              ) : (
                <span className="mono" style={{ fontSize: 12.5 }}>
                  {totalLeads} / {leadsGoal} ·{" "}
                  <b style={{ color: goalPct >= 100 ? "var(--green)" : "var(--text-1)" }}>
                    {goalPct}%
                  </b>
                </span>
              )}
            </div>
            {leadsGoal > 0 && (
              <div
                style={{
                  height: 7,
                  borderRadius: 4,
                  background: "var(--bg-3, rgba(0,0,0,.06))",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${goalPct}%`,
                    height: "100%",
                    background: goalPct >= 100 ? "var(--green)" : "var(--cyan)",
                    borderRadius: 4,
                  }}
                />
              </div>
            )}
          </div>
        )}

        <p className="dim" style={{ fontSize: 13, marginTop: 0, marginBottom: 12, maxWidth: 620 }}>
          Carga tu histórico (por ejemplo un CSV que Salesforce no tiene) directamente a este
          programa. <b style={{ color: "var(--text-2)" }}>No se llama a nadie</b>: los leads entran
          al tablero en la etapa que elijas. Si luego quieres contactarlos, crea una campaña.
        </p>
        <div
          className="row gap10"
          style={{ flexWrap: "wrap", marginBottom: recentLeads.length ? 16 : 0 }}
        >
          {canManage && (
            <Btn variant="primary" icon="upload" onClick={() => setShowImport(true)}>
              Importar CSV a este programa
            </Btn>
          )}
          <Btn variant="ghost" icon="users" onClick={goBoard}>
            Ver tablero de leads
          </Btn>
          {canManage && (
            <Btn variant="ghost" icon="phone" onClick={goCampaign}>
              Crear campaña
            </Btn>
          )}
        </div>

        {/* Lista de leads recientes del programa */}
        {recentLeads.length > 0 && (
          <div className="col gap6">
            <div className="row between" style={{ alignItems: "center", marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
                Leads recientes
              </span>
              {programLeads.length > recentLeads.length && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={goBoard}
                  style={{ fontSize: 12 }}
                >
                  Ver los {programLeads.length}
                </button>
              )}
            </div>
            <div
              className="col"
              style={{
                border: "1px solid var(--border-1)",
                borderRadius: "var(--r-md)",
                overflow: "hidden",
              }}
            >
              {recentLeads.map((l, i) => (
                <div
                  key={l.leadId}
                  className="row gap10"
                  style={{
                    alignItems: "center",
                    padding: "9px 12px",
                    borderTop: i ? "1px solid var(--border-1)" : "none",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: "var(--bg-3, var(--bg-2))",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--text-2)",
                    }}
                  >
                    {initials(l.name || l.phone)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="trunc" style={{ fontSize: 13, fontWeight: 500 }}>
                      {l.name || l.phone}
                    </div>
                    <div className="dim mono" style={{ fontSize: 11 }}>
                      {l.phone}
                    </div>
                  </div>
                  <Pill tone="outline">{stageLabel(l.stageId)}</Pill>
                  <span
                    className="dim"
                    style={{ fontSize: 11, width: 74, textAlign: "right", flexShrink: 0 }}
                  >
                    {SOURCE_LABEL[l.source || ""] || l.source || "—"}
                  </span>
                  <span
                    className="dim"
                    style={{ fontSize: 11, width: 64, textAlign: "right", flexShrink: 0 }}
                  >
                    {ago(l.createdAt || l.updatedAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <LeadImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        defaultProgramId={program.programId}
        lockProgram
      />
    </div>
  );
}
