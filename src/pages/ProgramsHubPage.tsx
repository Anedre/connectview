import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePrograms, type Program, type ProgramStatus } from "@/hooks/usePrograms";
import { useProgram } from "@/context/ProgramContext";
import { useRoles } from "@/hooks/useRoles";
import { getApiEndpoints } from "@/lib/api";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Btn, Card, Pill, SegBar, Stat, Num, HeroBand, Icon } from "@/components/aria";
import {
  PencilSimple,
  Trash,
  Play,
  Pause,
  CheckCircle,
  Archive,
  type Icon as PhIcon,
} from "@phosphor-icons/react";

/**
 * ProgramsHubPage (Pilar 1) — hub de programas con tarjetas accionables: salud
 * (leads), ciclo de vida (activar/pausar/cerrar/archivar), crear/editar, y
 * "Entrar" (setea el programa activo global y va a Leads). Ver design/pilar-1-programa.md.
 *
 * Re-skin ARIA: HeroBand + strip de Stats + tarjetas premium (Card) preservando
 * cada hook/query/acción real. Sin datos mock.
 */

type PillTone = "green" | "gold" | "cyan" | "outline";
const STATUS_META: Record<ProgramStatus, { label: string; tone: PillTone }> = {
  borrador: { label: "Borrador", tone: "outline" },
  activo: { label: "Activo", tone: "green" },
  pausado: { label: "Pausado", tone: "gold" },
  cerrado: { label: "Cerrado", tone: "cyan" },
  archivado: { label: "Archivado", tone: "outline" },
};

const BAR_COLORS = [
  "var(--cyan)",
  "var(--green)",
  "var(--gold)",
  "var(--iris)",
  "var(--red)",
  "var(--text-3)",
];

const NEXT: Record<ProgramStatus, Array<{ to: ProgramStatus; label: string; Icon: PhIcon }>> = {
  borrador: [{ to: "activo", label: "Activar", Icon: Play }],
  activo: [
    { to: "pausado", label: "Pausar", Icon: Pause },
    { to: "cerrado", label: "Cerrar", Icon: CheckCircle },
  ],
  pausado: [
    { to: "activo", label: "Reactivar", Icon: Play },
    { to: "cerrado", label: "Cerrar", Icon: CheckCircle },
  ],
  cerrado: [
    { to: "archivado", label: "Archivar", Icon: Archive },
    { to: "activo", label: "Reabrir", Icon: Play },
  ],
  archivado: [{ to: "activo", label: "Reabrir", Icon: Play }],
};

function daysLeft(endDate?: string): number | null {
  if (!endDate) return null;
  const end = new Date(endDate).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
}

type FormState = Partial<Program> & { code: string; name: string };
const EMPTY: FormState = { code: "", name: "", faculty: "", description: "", status: "borrador" };

export function ProgramsHubPage() {
  const navigate = useNavigate();
  const { isAtLeast } = useRoles();
  const canManage = isAtLeast("Admins");
  const { setActiveProgram } = useProgram();

  const [showArchived, setShowArchived] = useState(false);
  const {
    programs,
    loading,
    error,
    saveProgram,
    transitionProgram,
    removeProgram,
    importPrograms,
  } = usePrograms({ includeArchived: showArchived });

  const [q, setQ] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("all");
  const [editing, setEditing] = useState<FormState | null>(null);
  const [importText, setImportText] = useState<string | null>(null); // null = modal cerrado
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const endpointReady = !!getApiEndpoints()?.managePrograms;

  const faculties = useMemo(
    () => [...new Set(programs.map((p) => p.faculty).filter(Boolean) as string[])].sort(),
    [programs],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return programs
      .filter((p) => facultyFilter === "all" || p.faculty === facultyFilter)
      .filter(
        (p) =>
          !needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [programs, q, facultyFilter]);

  // Salud agregada (real) para el strip de Stats — sobre lo que se está viendo.
  const totals = useMemo(() => {
    const leads = filtered.reduce((s, p) => s + (p.leadCount ?? 0), 0);
    const activos = filtered.filter((p) => p.status === "activo").length;
    return { count: filtered.length, leads, activos };
  }, [filtered]);

  async function doSave() {
    if (!editing) return;
    if (!editing.code.trim() || !editing.name.trim()) {
      setMsg({ kind: "error", text: "Código y nombre son obligatorios." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await saveProgram(editing);
      setEditing(null);
      setMsg({ kind: "ok", text: "Programa guardado." });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    const rows = (importText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [code, name, faculty] = line.split(",").map((s) => s.trim());
        return { code, name: name || code, faculty: faculty || undefined };
      })
      .filter((r) => r.code);
    if (rows.length === 0) {
      setMsg({ kind: "error", text: "Pega al menos una fila: código,nombre,facultad" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await importPrograms(rows);
      setImportText(null);
      setMsg({
        kind: "ok",
        text: `Importados: ${res?.imported?.created ?? 0} nuevos, ${res?.imported?.updated ?? 0} actualizados.`,
      });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Error al importar" });
    } finally {
      setBusy(false);
    }
  }

  async function doTransition(p: Program, to: ProgramStatus) {
    if (
      to === "cerrado" &&
      !(await confirm({
        title: `¿Cerrar "${p.name}"?`,
        description: "Se congelan sus métricas y se pausan sus campañas.",
        confirmLabel: "Cerrar programa",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      await transitionProgram(p.programId, to);
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(p: Program) {
    if (
      !(await confirm({
        title: `¿Borrar el programa "${p.name}"?`,
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      await removeProgram(p.programId);
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  function enter(p: Program) {
    setActiveProgram(p.programId);
    navigate("/leads");
  }

  return (
    <div className="page">
      {/* ARIA hero band — reemplaza el header plano por el lenguaje premium de
          ARIA sin perder la copia ni las acciones reales. */}
      <HeroBand
        title="Programas"
        chip={<>Cada programa es una unidad comercial con su propia salud y ciclo de vida</>}
        chipIcon="cap"
        chipTone="var(--accent)"
        right={
          canManage ? (
            <div className="row gap8">
              <Btn
                variant="ghost"
                size="sm"
                icon="upload"
                onClick={() => {
                  setMsg(null);
                  setImportText("");
                }}
                title="Importar programas desde CSV (código,nombre,facultad)"
              >
                Importar CSV
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                icon="plus"
                onClick={() => {
                  setMsg(null);
                  setEditing({ ...EMPTY });
                }}
              >
                Nuevo programa
              </Btn>
            </div>
          ) : undefined
        }
      />

      {/* Strip de salud agregada — datos reales sobre lo que se ve. */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 16 }}>
        <Stat
          icon="cap"
          color="var(--accent)"
          label="Programas"
          value={<Num value={totals.count} />}
          sub={showArchived ? "incluye archivados" : "en la vista actual"}
        />
        <Stat
          icon="userplus"
          color="var(--cyan)"
          label="Leads totales"
          value={<Num value={totals.leads} />}
          sub="sumados en la vista"
        />
        <Stat
          icon="target"
          color="var(--green)"
          label="Activos"
          value={<Num value={totals.activos} />}
          sub="en paralelo"
        />
      </div>

      {!endpointReady && (
        <Card style={{ marginBottom: 12 }}>
          <div className="row gap10" style={{ alignItems: "flex-start", fontSize: 13 }}>
            <Icon
              name="zap"
              size={17}
              style={{ color: "var(--gold)", flex: "0 0 auto", marginTop: 1 }}
            />
            <div>
              El endpoint <code>managePrograms</code> aún no está configurado. Corre{" "}
              <code>node scripts/create-programs.mjs</code> y pega la URL en{" "}
              <code>amplify_outputs.json</code>.
            </div>
          </div>
        </Card>
      )}

      {msg && (
        <div style={{ marginBottom: 12 }}>
          <Pill
            tone={msg.kind === "error" ? "red" : "green"}
            icon={msg.kind === "error" ? "x" : "check"}
          >
            {msg.text}
          </Pill>
        </div>
      )}

      {/* Filtros */}
      <div className="row gap10 wrap" style={{ marginBottom: 16, alignItems: "center" }}>
        <div
          className="row gap8"
          style={{
            flex: 1,
            minWidth: 220,
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--r-md, 10px)",
            padding: "0 10px",
            alignItems: "center",
          }}
        >
          <Icon name="search" size={15} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre o código…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-1)",
              fontSize: 13,
              padding: "9px 0",
            }}
          />
        </div>
        <select
          value={facultyFilter}
          onChange={(e) => setFacultyFilter(e.target.value)}
          style={{ ...inp, width: "auto", minWidth: 180, cursor: "pointer" }}
        >
          <option value="all">Todas las facultades</option>
          {faculties.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <label
          className="row gap6"
          style={{ fontSize: 13, color: "var(--text-2)", cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Incluir archivados
        </label>
      </div>

      {/* Grid de tarjetas */}
      {loading ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Icon name="cap" />}
          title={
            programs.length === 0
              ? "No hay programas todavía"
              : "Ningún programa coincide con el filtro"
          }
          description={
            programs.length === 0 ? "Crea tu primer programa o impórtalos en lote." : undefined
          }
        />
      ) : (
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
        >
          {filtered.map((p) => {
            const meta = STATUS_META[p.status];
            const dl = daysLeft(p.endDate);
            const accent = p.color || "var(--accent)";
            return (
              <Card
                key={p.programId}
                accent={accent}
                bodyStyle={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 172 }}
              >
                <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 750,
                        fontSize: 15,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </div>
                    <div className="row gap6 dim" style={{ fontSize: 12, marginTop: 3 }}>
                      <Pill tone="outline">{p.code}</Pill>
                      {p.faculty && (
                        <>
                          <Icon name="cap" size={12} /> {p.faculty}
                        </>
                      )}
                    </div>
                  </div>
                  <Pill tone={meta.tone} icon={p.status === "activo" ? "dot" : undefined}>
                    {meta.label}
                  </Pill>
                </div>

                <div className="row" style={{ gap: 20 }}>
                  <div>
                    <div className="tnum" style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>
                      <Num value={p.leadCount ?? 0} />
                    </div>
                    <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                      leads
                    </div>
                  </div>
                  {dl !== null && (
                    <div>
                      <div
                        className="tnum"
                        style={{
                          fontSize: 22,
                          fontWeight: 800,
                          lineHeight: 1,
                          color: dl < 0 ? "var(--red)" : dl <= 14 ? "var(--gold)" : "var(--text-1)",
                        }}
                      >
                        {dl < 0 ? "Vencido" : dl}
                      </div>
                      <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                        {dl < 0 ? "" : "días restantes"}
                      </div>
                    </div>
                  )}
                </div>

                {p.health && p.health.leads > 0 && (
                  <div title="Distribución por etapa">
                    <SegBar
                      segments={Object.entries(p.health.byStage).map(([, n], i) => ({
                        v: n,
                        color: BAR_COLORS[i % BAR_COLORS.length],
                      }))}
                    />
                  </div>
                )}

                <div className="grow" />

                {/* Acciones */}
                <div className="row gap6 wrap" style={{ alignItems: "center" }}>
                  <Btn
                    variant="soft"
                    size="sm"
                    iconR="arrowRight"
                    onClick={() => enter(p)}
                    title="Entrar: setea este programa como activo y abre Leads"
                  >
                    Entrar
                  </Btn>
                  {canManage && (
                    <>
                      {NEXT[p.status].map(({ to, label, Icon: PhI }) => (
                        <Btn
                          key={to}
                          variant="ghost"
                          size="sm"
                          onClick={() => doTransition(p, to)}
                          disabled={busy}
                          title={label}
                        >
                          <PhI size={13} /> {label}
                        </Btn>
                      ))}
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setMsg(null);
                          setEditing({ ...p });
                        }}
                        title="Editar"
                      >
                        <PencilSimple size={13} />
                      </Btn>
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => doDelete(p)}
                        disabled={busy}
                        title="Borrar"
                        style={{ color: "var(--red)" }}
                      >
                        <Trash size={13} />
                      </Btn>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal importar CSV (R3) */}
      <Modal
        open={importText !== null}
        onOpenChange={(o) => {
          if (!o) setImportText(null);
        }}
        title="Importar programas"
        className="max-w-xl"
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setImportText(null)}>
              Cancelar
            </Btn>
            <Btn variant="primary" size="sm" icon="upload" onClick={doImport} disabled={busy}>
              {busy ? "Importando…" : "Importar"}
            </Btn>
          </>
        }
      >
        <p className="dim" style={{ margin: "10px 0 10px", fontSize: 12 }}>
          Una línea por programa: <code>código,nombre,facultad</code> (facultad opcional). Exporta
          tu Excel a CSV y pega aquí.
        </p>
        <textarea
          value={importText ?? ""}
          onChange={(e) => setImportText(e.target.value)}
          rows={8}
          placeholder={
            "ded261,Diplomado en Educación 2026-I,Humanidades\ntoefl264,TOEFL Preparación,Idiomas"
          }
          style={{ ...inp, resize: "vertical", fontFamily: "monospace", padding: "8px 10px" }}
        />
      </Modal>

      {/* Modal crear/editar */}
      <Modal
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        title={editing?.programId ? "Editar programa" : "Nuevo programa"}
        className="max-w-xl"
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancelar
            </Btn>
            <Btn variant="primary" size="sm" icon="check" onClick={doSave} disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </Btn>
          </>
        }
      >
        {editing && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
            <Field label="Código *">
              <input
                value={editing.code}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                placeholder="ej. ded261"
                style={inp}
              />
            </Field>
            <Field label="Facultad">
              <input
                value={editing.faculty || ""}
                onChange={(e) => setEditing({ ...editing, faculty: e.target.value })}
                placeholder="ej. Posgrado"
                style={inp}
                list="faculties-dl"
              />
              <datalist id="faculties-dl">
                {faculties.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
            <Field label="Nombre *" full>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="ej. Diplomado en Educación 2026-I"
                style={inp}
              />
            </Field>
            <Field label="Descripción" full>
              <textarea
                value={editing.description || ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                rows={2}
                style={{ ...inp, resize: "vertical" }}
              />
            </Field>
            <Field label="Inicio">
              <input
                type="date"
                value={(editing.startDate || "").slice(0, 10)}
                onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                style={inp}
              />
            </Field>
            <Field label="Fin (auto-archiva)">
              <input
                type="date"
                value={(editing.endDate || "").slice(0, 10)}
                onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
                style={inp}
              />
            </Field>
            <Field label="Estado">
              <select
                value={editing.status}
                onChange={(e) =>
                  setEditing({ ...editing, status: e.target.value as ProgramStatus })
                }
                style={inp}
              >
                {(Object.keys(STATUS_META) as ProgramStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Color">
              <input
                type="color"
                value={editing.color || "#22d3ee"}
                onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                style={{ ...inp, height: 38, padding: 4 }}
              />
            </Field>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
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
