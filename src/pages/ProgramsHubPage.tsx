import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePrograms, type Program, type ProgramStatus } from "@/hooks/usePrograms";
import { useProgram } from "@/context/ProgramContext";
import { useRoles } from "@/hooks/useRoles";
import { getApiEndpoints } from "@/lib/api";
import {
  Plus,
  PencilSimple,
  Trash,
  Play,
  Pause,
  CheckCircle,
  Archive,
  GraduationCap,
  X,
  ArrowRight,
  type Icon as PhIcon,
} from "@phosphor-icons/react";

/**
 * ProgramsHubPage (Pilar 1) — hub de programas con tarjetas accionables: salud
 * (leads), ciclo de vida (activar/pausar/cerrar/archivar), crear/editar, y
 * "Entrar" (setea el programa activo global y va a Leads). Ver design/pilar-1-programa.md.
 */

const STATUS_META: Record<ProgramStatus, { label: string; fg: string; bg: string }> = {
  borrador: { label: "Borrador", fg: "var(--text-2)", bg: "var(--bg-3)" },
  activo: { label: "Activo", fg: "var(--accent-green)", bg: "var(--accent-green-soft)" },
  pausado: { label: "Pausado", fg: "var(--accent-amber)", bg: "var(--accent-amber-soft)" },
  cerrado: { label: "Cerrado", fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)" },
  archivado: { label: "Archivado", fg: "var(--text-3)", bg: "var(--bg-3)" },
};

const BAR_COLORS = ["var(--accent-cyan)", "var(--accent-green)", "var(--accent-amber)", "var(--accent-pink)", "var(--accent-red)", "var(--text-3)"];

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
  const { programs, loading, error, saveProgram, transitionProgram, removeProgram, importPrograms } =
    usePrograms({ includeArchived: showArchived });

  const [q, setQ] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("all");
  const [editing, setEditing] = useState<FormState | null>(null);
  const [importText, setImportText] = useState<string | null>(null); // null = modal cerrado
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const endpointReady = !!getApiEndpoints()?.managePrograms;

  const faculties = useMemo(
    () => [...new Set(programs.map((p) => p.faculty).filter(Boolean) as string[])].sort(),
    [programs]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return programs
      .filter((p) => facultyFilter === "all" || p.faculty === facultyFilter)
      .filter(
        (p) =>
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          p.code.toLowerCase().includes(needle)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [programs, q, facultyFilter]);

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
      setMsg({ kind: "error", text: "Pegá al menos una fila: código,nombre,facultad" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await importPrograms(rows);
      setImportText(null);
      setMsg({ kind: "ok", text: `Importados: ${res?.imported?.created ?? 0} nuevos, ${res?.imported?.updated ?? 0} actualizados.` });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Error al importar" });
    } finally {
      setBusy(false);
    }
  }

  async function doTransition(p: Program, to: ProgramStatus) {
    if (to === "cerrado" && !confirm(`¿Cerrar "${p.name}"? Se congelan sus métricas y se pausan sus campañas.`)) return;
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
    if (!confirm(`¿Borrar el programa "${p.name}"? Esta acción no se puede deshacer.`)) return;
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
    <div style={{ padding: "18px 22px", height: "100%", overflow: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Programas</h1>
          <p style={{ margin: "2px 0 0", color: "var(--text-3)", fontSize: 13 }}>
            Cada programa es una unidad comercial con su propia salud y ciclo de vida. Elegí uno arriba para scopear toda la app.
          </p>
        </div>
        {canManage && (
          <button
            className="tbx__status"
            style={{ background: "var(--bg-3)", color: "var(--text-1)" }}
            onClick={() => { setMsg(null); setImportText(""); }}
            title="Importar programas desde CSV (código,nombre,facultad)"
          >
            Importar CSV
          </button>
        )}
        {canManage && (
          <button
            className="tbx__status"
            style={{ background: "var(--accent-green-soft)", color: "var(--accent-green)" }}
            onClick={() => { setMsg(null); setEditing({ ...EMPTY }); }}
          >
            <Plus size={14} weight="bold" /> Nuevo programa
          </button>
        )}
      </div>

      {!endpointReady && (
        <div className="chip chip--amber" style={{ marginBottom: 12, display: "block", padding: "8px 12px" }}>
          El endpoint <code>managePrograms</code> aún no está configurado. Corré{" "}
          <code>node scripts/create-programs.mjs</code> y pegá la URL en <code>amplify_outputs.json</code>.
        </div>
      )}

      {msg && (
        <div
          className={`chip ${msg.kind === "error" ? "chip--red" : "chip--green"}`}
          style={{ marginBottom: 12, display: "block", padding: "8px 12px" }}
        >
          {msg.text}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o código…"
          style={{ flex: 1, minWidth: 200, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text-1)", fontSize: 13 }}
        />
        <select
          value={facultyFilter}
          onChange={(e) => setFacultyFilter(e.target.value)}
          style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text-1)", fontSize: 13 }}
        >
          <option value="all">Todas las facultades</option>
          {faculties.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2)" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Incluir archivados
        </label>
      </div>

      {/* Grid de tarjetas */}
      {loading ? (
        <div style={{ color: "var(--text-3)", padding: 40, textAlign: "center" }}>Cargando programas…</div>
      ) : error ? (
        <div className="chip chip--red" style={{ display: "block", padding: "10px 12px" }}>Error: {error}</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "var(--text-3)", padding: 40, textAlign: "center" }}>
          {programs.length === 0 ? "No hay programas todavía." : "Ningún programa coincide con el filtro."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14 }}>
          {filtered.map((p) => {
            const meta = STATUS_META[p.status];
            const dl = daysLeft(p.endDate);
            return (
              <div
                key={p.programId}
                style={{
                  background: "var(--bg-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ height: 4, background: p.color || "var(--accent-cyan)" }} />
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 650, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <code>{p.code}</code>
                        {p.faculty && (
                          <>
                            <span>·</span>
                            <GraduationCap size={12} /> {p.faculty}
                          </>
                        )}
                      </div>
                    </div>
                    <span className="chip" style={{ color: meta.fg, background: meta.bg, whiteSpace: "nowrap" }}>
                      {meta.label}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{p.leadCount ?? 0}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>leads</div>
                    </div>
                    {dl !== null && (
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: dl < 0 ? "var(--accent-red)" : dl <= 14 ? "var(--accent-amber)" : "var(--text-1)" }}>
                          {dl < 0 ? "Vencido" : dl}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{dl < 0 ? "" : "días restantes"}</div>
                      </div>
                    )}
                  </div>

                  {p.health && p.health.leads > 0 && (
                    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--bg-3)" }} title="Distribución por etapa">
                      {Object.entries(p.health.byStage).map(([stage, n], i) => (
                        <div key={stage} title={`${stage}: ${n}`} style={{ width: `${(n / p.health!.leads) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                      ))}
                    </div>
                  )}

                  <div style={{ flex: 1 }} />

                  {/* Acciones */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      onClick={() => enter(p)}
                      className="tbx__status"
                      style={{ background: "var(--bg-3)", color: "var(--text-1)" }}
                      title="Entrar: setea este programa como activo y abre Leads"
                    >
                      Entrar <ArrowRight size={13} />
                    </button>
                    {canManage && (
                      <>
                        {NEXT[p.status].map(({ to, label, Icon }) => (
                          <button
                            key={to}
                            onClick={() => doTransition(p, to)}
                            disabled={busy}
                            className="tbx__status"
                            style={{ background: "var(--bg-3)", color: "var(--text-2)" }}
                            title={label}
                          >
                            <Icon size={13} /> {label}
                          </button>
                        ))}
                        <button
                          onClick={() => { setMsg(null); setEditing({ ...p }); }}
                          className="tbx__status"
                          style={{ background: "var(--bg-3)", color: "var(--text-2)" }}
                          title="Editar"
                        >
                          <PencilSimple size={13} />
                        </button>
                        <button
                          onClick={() => doDelete(p)}
                          disabled={busy}
                          className="tbx__status"
                          style={{ background: "var(--bg-3)", color: "var(--accent-red)" }}
                          title="Borrar"
                        >
                          <Trash size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal importar CSV (R3) */}
      {importText !== null && (
        <div onClick={() => setImportText(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 14, width: "min(560px, 100%)", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 17, flex: 1 }}>Importar programas</h2>
              <button onClick={() => setImportText(null)} className="tbx__status" style={{ background: "var(--bg-3)" }}><X size={14} /></button>
            </div>
            <p style={{ margin: "0 0 10px", color: "var(--text-3)", fontSize: 12 }}>
              Una línea por programa: <code>código,nombre,facultad</code> (facultad opcional). Exportá tu Excel a CSV y pegá acá.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder={"ded261,Diplomado en Educación 2026-I,Humanidades\ntoefl264,TOEFL Preparación,Idiomas"}
              style={{ ...inp, resize: "vertical", fontFamily: "monospace" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setImportText(null)} className="tbx__status" style={{ background: "var(--bg-3)", color: "var(--text-2)" }}>Cancelar</button>
              <button onClick={doImport} disabled={busy} className="tbx__status" style={{ background: "var(--accent-green-soft)", color: "var(--accent-green)" }}>{busy ? "Importando…" : "Importar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal crear/editar */}
      {editing && (
        <div
          onClick={() => setEditing(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 14, width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto", padding: 20 }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 17, flex: 1 }}>{editing.programId ? "Editar programa" : "Nuevo programa"}</h2>
              <button onClick={() => setEditing(null)} className="tbx__status" style={{ background: "var(--bg-3)" }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Código *">
                <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="ej. ded261" style={inp} />
              </Field>
              <Field label="Facultad">
                <input value={editing.faculty || ""} onChange={(e) => setEditing({ ...editing, faculty: e.target.value })} placeholder="ej. Posgrado" style={inp} list="faculties-dl" />
                <datalist id="faculties-dl">
                  {faculties.map((f) => <option key={f} value={f} />)}
                </datalist>
              </Field>
              <Field label="Nombre *" full>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="ej. Diplomado en Educación 2026-I" style={inp} />
              </Field>
              <Field label="Descripción" full>
                <textarea value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} style={{ ...inp, resize: "vertical" }} />
              </Field>
              <Field label="Inicio">
                <input type="date" value={(editing.startDate || "").slice(0, 10)} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} style={inp} />
              </Field>
              <Field label="Fin (auto-archiva)">
                <input type="date" value={(editing.endDate || "").slice(0, 10)} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} style={inp} />
              </Field>
              <Field label="Estado">
                <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as ProgramStatus })} style={inp}>
                  {(Object.keys(STATUS_META) as ProgramStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_META[s].label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Color">
                <input type="color" value={editing.color || "#22d3ee"} onChange={(e) => setEditing({ ...editing, color: e.target.value })} style={{ ...inp, height: 38, padding: 4 }} />
              </Field>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setEditing(null)} className="tbx__status" style={{ background: "var(--bg-3)", color: "var(--text-2)" }}>
                Cancelar
              </button>
              <button onClick={doSave} disabled={busy} className="tbx__status" style={{ background: "var(--accent-green-soft)", color: "var(--accent-green)" }}>
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text-1)",
  fontSize: 13,
};

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: full ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</span>
      {children}
    </label>
  );
}
