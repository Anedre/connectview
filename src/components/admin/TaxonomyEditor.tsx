import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody, Kpi } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { SegmentedControl } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "@/hooks/useAuth";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { type DispositionStage, type Valoracion, type TaxonomyDoc } from "@/lib/dispositions";

/**
 * TaxonomyEditor — the admin UI for the unified disposition taxonomy.
 * This is the single source of truth that replaces the client's 3 separate
 * taxonomies (Salesforce / Chattigo / Kommo). Edits here flow to every
 * channel's wrap-up via the manage-taxonomy Lambda + useTaxonomy hook.
 *
 * Rediseño premium (#config): KPI strip + stage cards con barra de acento por
 * valoración + segmented de color, sub-tipificaciones como chips/tags. La lógica
 * (estado, save, add/patch/remove) es idéntica al editor anterior; cambió la
 * envoltura visual para emparejar el nivel de "Usuarios y roles".
 */

const VALORACIONES: Valoracion[] = ["inicial", "positiva", "negativa", "cierre"];

/** Color + etiqueta corta por valoración. inicial=cian · positiva=verde ·
 *  negativa=rojo · cierre=violeta — el mismo lenguaje de color que los chips
 *  del wrap-up. "Inicial" = lead recién ingresado, todavía sin gestionar. */
const VAL_COLOR: Record<Valoracion, { color: string; soft: string; short: string }> = {
  inicial: { color: "var(--accent-cyan)", soft: "var(--accent-cyan-soft)", short: "Inicial" },
  positiva: { color: "var(--accent-green)", soft: "var(--accent-green-soft)", short: "Positiva" },
  negativa: { color: "var(--accent-red)", soft: "var(--accent-red-soft)", short: "Negativa" },
  cierre: { color: "var(--accent-violet)", soft: "var(--accent-violet-soft)", short: "Cierre" },
};

// Local editable copy of a stage (adds a transient _key for React lists
// so renames don't remount inputs).
interface EditStage extends DispositionStage {
  _key: string;
}

let keySeq = 0;
const nextKey = () => `k${keySeq++}`;

function toEditStages(stages: DispositionStage[]): EditStage[] {
  return stages.map((s) => ({ ...s, _key: nextKey() }));
}

export function TaxonomyEditor() {
  const { user } = useAuth();
  const { docs, loading, refetch } = useTaxonomy();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [stages, setStages] = useState<EditStage[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Reordenar stages por drag (el orden ES el embudo).
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // When docs load (or the selection changes), hydrate the editable copy.
  useEffect(() => {
    if (loading || docs.length === 0) return;
    const target =
      docs.find((d) => d.taxonomyId === activeId) ?? docs.find((d) => d.isDefault) ?? docs[0];
    if (!target) return;
    if (activeId !== target.taxonomyId) setActiveId(target.taxonomyId);
    setName(target.name);
    setStages(toEditStages(target.stages));
    setDirty(false);
  }, [loading, docs, activeId]);

  const activeDoc: TaxonomyDoc | undefined = docs.find((d) => d.taxonomyId === activeId);

  const mutate = (fn: (draft: EditStage[]) => EditStage[]) => {
    setStages((cur) => fn(cur));
    setDirty(true);
  };

  const addStage = () =>
    mutate((cur) => [
      ...cur,
      {
        _key: nextKey(),
        id: "",
        label: "Nuevo stage",
        valoracion: "positiva",
        subStages: [],
      },
    ]);

  const removeStage = (key: string) => mutate((cur) => cur.filter((s) => s._key !== key));

  /** Reordena un stage (drag-and-drop). El orden de los stages ES el orden del
   *  embudo, así que moverlos aquí cambia cómo se presenta en cada cierre. */
  const moveStage = (fromKey: string, toKey: string) =>
    mutate((cur) => {
      if (fromKey === toKey) return cur;
      const from = cur.findIndex((s) => s._key === fromKey);
      const to = cur.findIndex((s) => s._key === toKey);
      if (from < 0 || to < 0) return cur;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  const patchStage = (key: string, patch: Partial<DispositionStage>) =>
    mutate((cur) => cur.map((s) => (s._key === key ? { ...s, ...patch } : s)));

  const addSub = (key: string) =>
    mutate((cur) =>
      cur.map((s) =>
        s._key === key
          ? { ...s, subStages: [...s.subStages, { id: "", label: "Nuevo sub-stage" }] }
          : s,
      ),
    );

  const patchSub = (key: string, idx: number, label: string) =>
    mutate((cur) =>
      cur.map((s) =>
        s._key === key
          ? {
              ...s,
              subStages: s.subStages.map((ss, i) => (i === idx ? { ...ss, label } : ss)),
            }
          : s,
      ),
    );

  const removeSub = (key: string, idx: number) =>
    mutate((cur) =>
      cur.map((s) =>
        s._key === key ? { ...s, subStages: s.subStages.filter((_, i) => i !== idx) } : s,
      ),
    );

  const save = async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.manageTaxonomy) {
      toast.error("Endpoint de taxonomía no configurado");
      return;
    }
    if (!name.trim()) {
      toast.error("La taxonomía necesita un nombre");
      return;
    }
    if (stages.length === 0) {
      toast.error("Agrega al menos un stage");
      return;
    }
    setSaving(true);
    try {
      // Strip the transient _key; the Lambda re-derives ids from labels
      // when missing and validates the shape.
      const payload = {
        taxonomyId: activeDoc?.taxonomyId,
        name: name.trim(),
        isDefault: activeDoc?.isDefault ?? docs.length === 0,
        stages: stages.map((s) => ({
          id: s.id || undefined,
          label: s.label,
          valoracion: s.valoracion,
          description: s.description,
          salesforceValue: s.salesforceValue,
          subStages: s.subStages.map((ss) => ({
            id: ss.id || undefined,
            label: ss.label,
          })),
        })),
        actor: user?.username || "admin",
      };
      // authedFetch → Bearer idToken: sin él, manage-taxonomy es tenant-scoped
      // y el write se no-opea (toast de éxito pero no persistía por-tenant).
      const r = await authedFetch(endpoints.manageTaxonomy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
      toast.success("Taxonomía guardada · ahora todos los canales la usan");
      setDirty(false);
      await refetch(true); // invalidate cache so wrap-ups pick up the change
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const newTaxonomy = () => {
    setActiveId("__new__");
    setName("Nueva taxonomía");
    setStages([
      {
        _key: nextKey(),
        id: "",
        label: "Contactado",
        valoracion: "positiva",
        subStages: [{ id: "", label: "Volver a llamar" }],
      },
    ]);
    setDirty(true);
  };

  // ── KPIs del strip ──────────────────────────────────────────────────────
  const totalSubs = stages.reduce((a, s) => a + s.subStages.length, 0);
  const iniCount = stages.filter((s) => s.valoracion === "inicial").length;
  const posCount = stages.filter((s) => s.valoracion === "positiva").length;
  const negCount = stages.filter((s) => s.valoracion === "negativa").length;
  const cierreCount = stages.filter((s) => s.valoracion === "cierre").length;

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header: título + descripción + acciones */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
            Taxonomía de tipificación
          </div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 580, lineHeight: 1.5 }}
          >
            Una sola taxonomía para <strong>todos los canales</strong> (voz, WhatsApp, chat, email)
            y todos los agentes. Reemplaza las de Salesforce, Chattigo y Kommo. Los cambios se
            aplican al instante en cada cierre.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          {dirty && (
            <span className="chip chip--amber" style={{ height: 28 }}>
              <span className="dot" /> Sin guardar
            </span>
          )}
          <button className="btn btn--sm" onClick={newTaxonomy}>
            <Icon.Plus size={12} /> Nueva
          </button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={saving || !dirty}>
            <Icon.Check size={12} /> {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* Selector + nombre + default */}
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {docs.length > 0 && (
          <Select value={activeId ?? ""} onValueChange={(v) => setActiveId(v ?? null)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Elige una taxonomía…" />
            </SelectTrigger>
            <SelectContent>
              {docs.map((d) => (
                <SelectItem key={d.taxonomyId} value={d.taxonomyId}>
                  {d.name}
                  {d.isDefault ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          placeholder="Nombre de la taxonomía"
          style={{ flex: 1, minWidth: 240, fontWeight: 700 }}
        />
        {activeDoc?.isDefault && (
          <span className="chip chip--violet" style={{ height: 32 }}>
            <Icon.Star size={11} /> Default
          </span>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
        <Kpi label="Stages" value={stages.length} color="var(--accent-cyan)" />
        <Kpi label="Sub-tipificaciones" value={totalSubs} color="var(--accent-violet)" />
        <Kpi
          label="Positivas"
          value={<span style={{ color: "var(--accent-green)" }}>{posCount}</span>}
          color="var(--accent-green)"
        />
        <Kpi
          label="Inicial · Neg · Cierre"
          value={
            <span>
              <span style={{ color: "var(--accent-cyan)" }}>{iniCount}</span> ·{" "}
              <span style={{ color: "var(--accent-red)" }}>{negCount}</span> ·{" "}
              <span style={{ color: "var(--accent-violet)" }}>{cierreCount}</span>
            </span>
          }
          color="var(--accent-cyan)"
        />
      </div>

      {/* Vista previa del cierre — así lo ve el agente al tipificar */}
      {stages.length > 0 && <WrapUpPreview stages={stages} />}

      {/* Stages */}
      {loading && stages.length === 0 ? (
        <Card>
          <CardBody>
            <div className="muted" style={{ padding: 24, textAlign: "center" }}>
              Cargando taxonomía…
            </div>
          </CardBody>
        </Card>
      ) : stages.length === 0 ? (
        <Card>
          <CardBody>
            <div style={{ textAlign: "center", padding: "36px 24px" }}>
              <div
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: "var(--accent-cyan-soft)",
                  color: "var(--accent-cyan)",
                  marginBottom: 12,
                }}
              >
                <Icon.Tag size={22} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Esta taxonomía no tiene stages</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4, marginBottom: 16 }}>
                Agrega el primero para empezar el embudo.
              </div>
              <button className="btn btn--primary" onClick={addStage} style={{ margin: "0 auto" }}>
                <Icon.Plus size={13} /> Agregar stage
              </button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {stages.map((stage, idx) => {
            const v = VAL_COLOR[stage.valoracion];
            return (
              <div
                key={stage._key}
                data-stage-card
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragKey && dragKey !== stage._key) setOverKey(stage._key);
                }}
                onDragLeave={() => setOverKey((k) => (k === stage._key ? null : k))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragKey) moveStage(dragKey, stage._key);
                  setDragKey(null);
                  setOverKey(null);
                }}
                style={{
                  position: "relative",
                  borderRadius: 12,
                  border: "1px solid var(--border-1)",
                  background: "var(--bg-1)",
                  overflow: "hidden",
                  boxShadow: "0 1px 2px rgba(16,21,37,.04)",
                  opacity: dragKey === stage._key ? 0.4 : 1,
                  outline: overKey === stage._key ? "2px solid var(--accent-cyan)" : "none",
                  outlineOffset: -2,
                  transition: "opacity .12s",
                }}
              >
                {/* Barra de acento por valoración */}
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                    background: v.color,
                  }}
                />
                <div style={{ padding: "14px 16px 16px 20px" }}>
                  {/* Header del stage */}
                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    <div
                      title="Arrastrar para reordenar"
                      draggable
                      onDragStart={(e) => {
                        setDragKey(stage._key);
                        const card = (e.currentTarget as HTMLElement).closest("[data-stage-card]");
                        if (card) e.dataTransfer.setDragImage(card as HTMLElement, 24, 24);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragKey(null);
                        setOverKey(null);
                      }}
                      style={{
                        cursor: "grab",
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 3px)",
                        gap: 3,
                        padding: "3px 2px",
                        flex: "0 0 auto",
                      }}
                    >
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span
                          key={i}
                          style={{
                            width: 3,
                            height: 3,
                            borderRadius: 99,
                            background: "var(--text-3)",
                          }}
                        />
                      ))}
                    </div>
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        flex: "0 0 26px",
                        background: v.soft,
                        color: v.color,
                        fontWeight: 800,
                        fontSize: 12,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <Input
                      value={stage.label}
                      onChange={(e) => patchStage(stage._key, { label: e.target.value })}
                      placeholder="Nombre del stage"
                      style={{ flex: 1, minWidth: 0, fontWeight: 700 }}
                    />
                    {/* Segmented de valoración (con color) */}
                    <SegmentedControl
                      value={stage.valoracion}
                      onValueChange={(vv) => patchStage(stage._key, { valoracion: vv })}
                      options={VALORACIONES.map((vv) => ({
                        value: vv,
                        label: VAL_COLOR[vv].short,
                        color: VAL_COLOR[vv].color,
                      }))}
                      size="sm"
                      aria-label="Valoración del stage"
                    />
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => removeStage(stage._key)}
                      title="Eliminar stage"
                    >
                      <Icon.Trash size={13} />
                    </button>
                  </div>

                  {/* Descripción + mapeo a Salesforce */}
                  <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <Input
                      value={stage.description ?? ""}
                      onChange={(e) => patchStage(stage._key, { description: e.target.value })}
                      placeholder="Descripción (opcional)"
                      style={{ flex: 1, minWidth: 200 }}
                    />
                    <Input
                      value={stage.salesforceValue ?? ""}
                      onChange={(e) => patchStage(stage._key, { salesforceValue: e.target.value })}
                      placeholder="Salesforce →"
                      title="Valor del campo Status de Lead en Salesforce al que mapea este stage"
                      style={{ width: 150, flex: "0 0 auto" }}
                    />
                  </div>

                  {/* Sub-tipificaciones como chips */}
                  <div style={{ marginTop: 13 }}>
                    <div
                      className="muted"
                      style={{
                        fontSize: 10.5,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: ".05em",
                        marginBottom: 8,
                      }}
                    >
                      Sub-tipificaciones · {stage.subStages.length}
                    </div>
                    <div className="row" style={{ gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                      {stage.subStages.map((sub, i) => (
                        <span
                          key={i}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 2,
                            background: "var(--bg-2)",
                            border: "1px solid var(--border-1)",
                            borderRadius: 8,
                            padding: "4px 5px 4px 11px",
                          }}
                        >
                          <input
                            value={sub.label}
                            onChange={(e) => patchSub(stage._key, i, e.target.value)}
                            style={{
                              border: "none",
                              background: "transparent",
                              outline: "none",
                              fontSize: 12.5,
                              color: "var(--text-1)",
                              width: `${Math.max(7, sub.label.length + 1)}ch`,
                              minWidth: 44,
                              maxWidth: 280,
                            }}
                          />
                          <button
                            onClick={() => removeSub(stage._key, i)}
                            title="Quitar sub-tipificación"
                            style={{
                              border: "none",
                              background: "transparent",
                              cursor: "pointer",
                              color: "var(--text-3)",
                              display: "grid",
                              placeItems: "center",
                              padding: 3,
                              borderRadius: 5,
                            }}
                          >
                            <Icon.Close size={11} />
                          </button>
                        </span>
                      ))}
                      <button
                        onClick={() => addSub(stage._key)}
                        className="row"
                        style={{
                          gap: 4,
                          alignItems: "center",
                          background: "transparent",
                          border: "1px dashed var(--border-1)",
                          borderRadius: 8,
                          padding: "5px 11px",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--text-2)",
                        }}
                      >
                        <Icon.Plus size={11} /> Agregar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <button className="btn" onClick={addStage} style={{ alignSelf: "flex-start" }}>
            <Icon.Plus size={13} /> Agregar stage
          </button>
        </div>
      )}
    </div>
  );
}

/** Mini wrap-up en vivo: muestra cómo el AGENTE tipifica un contacto con esta
 *  taxonomía (stage → sub-stage + chip de valoración con su color). Se alimenta
 *  del state de edición, así que refleja los cambios al instante. */
function WrapUpPreview({ stages }: { stages: EditStage[] }) {
  const [si, setSi] = useState(0);
  const [ssi, setSsi] = useState(0);
  if (stages.length === 0) return null;
  const sIdx = Math.min(si, stages.length - 1);
  const stage = stages[sIdx];
  const v = VAL_COLOR[stage.valoracion];
  const subs = stage.subStages;
  const pvLabel: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: ".05em",
    color: "var(--text-3)",
  };
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid var(--border-1)",
        background: "linear-gradient(135deg, var(--bg-2), var(--bg-1))",
        padding: "15px 18px",
      }}
    >
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div className="row" style={{ gap: 9, alignItems: "center" }}>
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: 9,
              background: "var(--accent-violet-soft)",
              color: "var(--accent-violet)",
              flex: "0 0 auto",
            }}
          >
            <Icon.Tag size={15} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Vista previa del cierre</div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              Así lo ve el agente al tipificar un contacto
            </div>
          </div>
        </div>
        <span className="chip" style={{ background: v.soft, color: v.color, fontWeight: 700 }}>
          <span className="dot" style={{ background: v.color }} /> {v.short}
        </span>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <span style={pvLabel}>Tipificación</span>
          <div style={{ marginTop: 5 }}>
            <Select
              value={String(sIdx)}
              onValueChange={(v) => {
                setSi(Number(v));
                setSsi(0);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s, i) => (
                  <SelectItem key={s._key} value={String(i)}>
                    {s.label || "(sin nombre)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <span style={pvLabel}>Sub-tipificación</span>
          <div style={{ marginTop: 5 }}>
            <Select
              value={String(Math.min(ssi, Math.max(0, subs.length - 1)))}
              onValueChange={(v) => setSsi(Number(v))}
              disabled={subs.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— sin sub-tipificaciones —" />
              </SelectTrigger>
              <SelectContent>
                {subs.map((ss, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {ss.label || "(sin nombre)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
