import { useState } from "react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { useAuth } from "@/hooks/useAuth";
import { useSegments, type Segment, type FilterRule, type FilterOp } from "@/hooks/useSegments";

/**
 * SegmentsManager — Configuración → Segmentos (Fase 2 · F2.3). Crea audiencias
 * dinámicas reutilizables (predicado sobre score/grade/origen/etapa/valor/…). Se
 * consumen como audiencia de campaña, entrada de journey (Fase 3) y filtro de
 * export. El CRUD + el preview corren en manage-leads.
 */

// Campos filtrables (curados) con su tipo → decide los operadores y el input.
const FIELDS: { value: string; label: string; kind: "num" | "text" | "flag" }[] = [
  { value: "score", label: "Score (0-100)", kind: "num" },
  { value: "grade", label: "Grado (A-F)", kind: "text" },
  { value: "source", label: "Origen", kind: "text" },
  { value: "stageId", label: "Etapa (id)", kind: "text" },
  { value: "montoEstimado", label: "Valor estimado", kind: "num" },
  { value: "golpesCount", label: "# de golpes", kind: "num" },
  { value: "assignedAgent", label: "Agente asignado", kind: "text" },
  { value: "email", label: "Email", kind: "flag" },
  { value: "company", label: "Empresa", kind: "flag" },
  { value: "synced", label: "Sync Salesforce (sf/local)", kind: "text" },
];
const OPS_BY_KIND: Record<string, { value: FilterOp; label: string }[]> = {
  num: [
    { value: "gte", label: "≥" },
    { value: "lte", label: "≤" },
    { value: "eq", label: "=" },
  ],
  text: [
    { value: "eq", label: "es" },
    { value: "neq", label: "no es" },
    { value: "contains", label: "contiene" },
  ],
  flag: [
    { value: "exists", label: "tiene" },
    { value: "notexists", label: "no tiene" },
  ],
};
const fieldKind = (f: string) => FIELDS.find((x) => x.value === f)?.kind || "text";
const fieldLabel = (f: string) => FIELDS.find((x) => x.value === f)?.label || f;

function ruleText(r: FilterRule): string {
  const ops = OPS_BY_KIND[fieldKind(r.field)] || [];
  const opl = ops.find((o) => o.value === r.op)?.label || r.op;
  const needsValue = r.op !== "exists" && r.op !== "notexists";
  return `${fieldLabel(r.field)} ${opl}${needsValue ? ` ${r.value ?? ""}` : ""}`.trim();
}

const inp: React.CSSProperties = {
  background: "var(--bg-2)",
  border: "1px solid var(--border-1)",
  borderRadius: 8,
  padding: "7px 9px",
  color: "var(--text-1)",
  fontSize: 12.5,
  outline: "none",
};

export function SegmentsManager() {
  const { user } = useAuth();
  const { segments, loading, error, save, remove, preview } = useSegments();

  const [name, setName] = useState("");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [rules, setRules] = useState<FilterRule[]>([{ field: "score", op: "gte", value: 70 }]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState<Record<string, number | "…">>({});

  const reset = () => {
    setName("");
    setMatch("all");
    setRules([{ field: "score", op: "gte", value: 70 }]);
    setEditingId(null);
  };

  const setRule = (i: number, patch: Partial<FilterRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { field: "grade", op: "eq", value: "A" }]);
  const rmRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));

  const doSave = async () => {
    if (!name.trim()) {
      toast.error("Ponle un nombre al segmento");
      return;
    }
    setSaving(true);
    try {
      // Coerce números en reglas numéricas.
      const clean = rules.map((r) =>
        fieldKind(r.field) === "num" && r.op !== "exists" && r.op !== "notexists"
          ? { ...r, value: Number(r.value) || 0 }
          : r,
      );
      await save(
        { segmentId: editingId || undefined, name: name.trim(), match, rules: clean },
        user?.username || "admin",
      );
      toast.success(editingId ? "Segmento actualizado" : "Segmento creado");
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const edit = (s: Segment) => {
    setEditingId(s.segmentId);
    setName(s.name);
    setMatch(s.match);
    setRules(s.rules?.length ? s.rules : [{ field: "score", op: "gte", value: 70 }]);
  };

  const doPreview = async (s: Segment) => {
    setCounts((c) => ({ ...c, [s.segmentId]: "…" }));
    const n = await preview(s.segmentId);
    setCounts((c) => ({ ...c, [s.segmentId]: n ?? 0 }));
  };

  const doRemove = async (s: Segment) => {
    if (!confirm(`¿Borrar el segmento "${s.name}"?`)) return;
    try {
      await remove(s.segmentId);
      toast.success("Segmento borrado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo borrar");
    }
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Segmentos</div>
        <div
          className="muted"
          style={{ fontSize: 12.5, marginTop: 3, maxWidth: 640, lineHeight: 1.5 }}
        >
          Audiencias dinámicas reutilizables. Defínelas una vez (por score, grado, origen, etapa…) y
          úsalas como audiencia de campaña, filtro de export y —pronto— entrada de un journey.
        </div>
      </div>

      {/* Builder */}
      <Card>
        <CardBody>
          <div className="col" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del segmento (ej. Calientes sin contactar)"
                style={{ ...inp, flex: 1, minWidth: 220 }}
              />
              <select
                value={match}
                onChange={(e) => setMatch(e.target.value as "all" | "any")}
                style={inp}
              >
                <option value="all">Cumple TODAS</option>
                <option value="any">Cumple ALGUNA</option>
              </select>
            </div>

            {rules.map((r, i) => {
              const kind = fieldKind(r.field);
              const ops = OPS_BY_KIND[kind] || [];
              const needsValue = r.op !== "exists" && r.op !== "notexists";
              return (
                <div key={i} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <select
                    value={r.field}
                    onChange={(e) => {
                      const nf = e.target.value;
                      const nk = fieldKind(nf);
                      setRule(i, { field: nf, op: (OPS_BY_KIND[nk] || [])[0]?.value || "eq" });
                    }}
                    style={{ ...inp, flex: "0 0 190px" }}
                  >
                    {FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={r.op}
                    onChange={(e) => setRule(i, { op: e.target.value as FilterOp })}
                    style={{ ...inp, flex: "0 0 110px" }}
                  >
                    {ops.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {needsValue ? (
                    <input
                      type={kind === "num" ? "number" : "text"}
                      value={String(r.value ?? "")}
                      onChange={(e) => setRule(i, { value: e.target.value })}
                      placeholder="valor"
                      style={{ ...inp, flex: 1 }}
                    />
                  ) : (
                    <div style={{ flex: 1 }} />
                  )}
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => rmRule(i)}
                    disabled={rules.length === 1}
                    title="Quitar regla"
                  >
                    <Icon.Close size={13} />
                  </button>
                </div>
              );
            })}

            <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
              <button className="btn btn--ghost btn--sm" onClick={addRule}>
                <Icon.Plus size={12} /> Agregar regla
              </button>
              <div className="row" style={{ gap: 8 }}>
                {editingId && (
                  <button className="btn btn--ghost btn--sm" onClick={reset}>
                    Cancelar
                  </button>
                )}
                <button className="btn btn--primary btn--sm" onClick={doSave} disabled={saving}>
                  {saving ? "Guardando…" : editingId ? "Actualizar segmento" : "Crear segmento"}
                </button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Lista */}
      {error && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          {error}
        </div>
      )}
      {loading ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Cargando…
        </div>
      ) : segments.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5, padding: 12 }}>
          Aún no hay segmentos. Crea el primero arriba.
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {segments.map((s) => (
            <Card key={s.segmentId}>
              <CardBody>
                <div
                  className="row"
                  style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      {s.match === "all" ? "Todas: " : "Alguna: "}
                      {(s.rules || []).map(ruleText).join(s.match === "all" ? " · " : " ó ") ||
                        "sin reglas"}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6, flex: "0 0 auto", alignItems: "center" }}>
                    <span
                      className="chip"
                      style={{ fontSize: 11 }}
                      title="Leads que coinciden ahora"
                    >
                      {counts[s.segmentId] === undefined ? "—" : `${counts[s.segmentId]} leads`}
                    </span>
                    <button className="btn btn--ghost btn--sm" onClick={() => doPreview(s)}>
                      Contar
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => edit(s)}>
                      Editar
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => doRemove(s)}>
                      <Icon.Trash size={13} />
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
