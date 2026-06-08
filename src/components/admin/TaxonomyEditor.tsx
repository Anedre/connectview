import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody, CardHead } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import {
  VALORACION_META,
  type DispositionStage,
  type Valoracion,
  type TaxonomyDoc,
} from "@/lib/dispositions";

/**
 * TaxonomyEditor — the admin UI for the unified disposition taxonomy.
 * This is the single source of truth that replaces the client's 3 separate
 * taxonomies (Salesforce / Chattigo / Kommo). Edits here flow to every
 * channel's wrap-up via the manage-taxonomy Lambda + useTaxonomy hook.
 */

const VALORACIONES: Valoracion[] = ["positiva", "negativa", "cierre"];

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

  // When docs load (or the selection changes), hydrate the editable copy.
  useEffect(() => {
    if (loading || docs.length === 0) return;
    const target =
      docs.find((d) => d.taxonomyId === activeId) ??
      docs.find((d) => d.isDefault) ??
      docs[0];
    if (!target) return;
    if (activeId !== target.taxonomyId) setActiveId(target.taxonomyId);
    setName(target.name);
    setStages(toEditStages(target.stages));
    setDirty(false);
     
  }, [loading, docs, activeId]);

  const activeDoc: TaxonomyDoc | undefined = docs.find(
    (d) => d.taxonomyId === activeId
  );

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

  const removeStage = (key: string) =>
    mutate((cur) => cur.filter((s) => s._key !== key));

  const patchStage = (key: string, patch: Partial<DispositionStage>) =>
    mutate((cur) =>
      cur.map((s) => (s._key === key ? { ...s, ...patch } : s))
    );

  const addSub = (key: string) =>
    mutate((cur) =>
      cur.map((s) =>
        s._key === key
          ? { ...s, subStages: [...s.subStages, { id: "", label: "Nuevo sub-stage" }] }
          : s
      )
    );

  const patchSub = (key: string, idx: number, label: string) =>
    mutate((cur) =>
      cur.map((s) =>
        s._key === key
          ? {
              ...s,
              subStages: s.subStages.map((ss, i) =>
                i === idx ? { ...ss, label } : ss
              ),
            }
          : s
      )
    );

  const removeSub = (key: string, idx: number) =>
    mutate((cur) =>
      cur.map((s) =>
        s._key === key
          ? { ...s, subStages: s.subStages.filter((_, i) => i !== idx) }
          : s
      )
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
      const r = await fetch(endpoints.manageTaxonomy, {
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

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card>
        <CardHead
          title="Taxonomía unificada de tipificación"
          right={
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--sm" onClick={newTaxonomy}>
                <Icon.Plus size={12} /> Nueva
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={save}
                disabled={saving || !dirty}
              >
                <Icon.Check size={12} /> {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          }
        />
        <CardBody>
          <div
            className="muted"
            style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}
          >
            Una sola taxonomía que usan <strong>todos los canales</strong> (voz,
            WhatsApp, chat, email) y todos los agentes. Reemplaza las
            tipificaciones separadas que vivían en Salesforce, Chattigo y Kommo.
            Los cambios se aplican al instante en el cierre de cada contacto.
          </div>

          {/* Taxonomy selector + name */}
          <div className="row" style={{ gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            {docs.length > 1 && (
              <select
                value={activeId ?? ""}
                onChange={(e) => setActiveId(e.target.value)}
                style={selectStyle}
              >
                {docs.map((d) => (
                  <option key={d.taxonomyId} value={d.taxonomyId}>
                    {d.name}
                    {d.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            )}
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="Nombre de la taxonomía"
              style={{ ...inputStyle, flex: 1, minWidth: 220, fontWeight: 600 }}
            />
            {activeDoc?.isDefault && (
              <span className="chip chip--violet" style={{ height: 26 }}>
                <Icon.Star size={11} /> Default
              </span>
            )}
          </div>

          {loading && stages.length === 0 ? (
            <div className="muted" style={{ padding: 24, textAlign: "center" }}>
              Cargando taxonomía…
            </div>
          ) : (
            <div className="col" style={{ gap: 10 }}>
              {stages.map((stage) => (
                <div
                  key={stage._key}
                  style={{
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: 10,
                    background: "var(--bg-2)",
                  }}
                >
                  {/* Stage row */}
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <Icon.Tag size={13} style={{ color: "var(--text-3)" }} />
                    <input
                      value={stage.label}
                      onChange={(e) =>
                        patchStage(stage._key, { label: e.target.value })
                      }
                      style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
                    />
                    <select
                      value={stage.valoracion}
                      onChange={(e) =>
                        patchStage(stage._key, {
                          valoracion: e.target.value as Valoracion,
                        })
                      }
                      style={selectStyle}
                    >
                      {VALORACIONES.map((v) => (
                        <option key={v} value={v}>
                          {VALORACION_META[v].label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => removeStage(stage._key)}
                      title="Eliminar stage"
                    >
                      <Icon.Trash size={12} />
                    </button>
                  </div>

                  {/* Description + Salesforce Lead Status mapping */}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <input
                      value={stage.description ?? ""}
                      onChange={(e) =>
                        patchStage(stage._key, { description: e.target.value })
                      }
                      placeholder="Descripción (opcional)"
                      style={{ ...inputStyle, flex: 1, fontSize: 11.5 }}
                    />
                    <input
                      value={stage.salesforceValue ?? ""}
                      onChange={(e) =>
                        patchStage(stage._key, { salesforceValue: e.target.value })
                      }
                      placeholder="SF Lead Status →"
                      title="Valor del campo Status de Lead en Salesforce al que mapea este stage"
                      style={{ ...inputStyle, width: 160, fontSize: 11.5 }}
                    />
                  </div>

                  {/* Sub-stages */}
                  <div
                    style={{
                      marginTop: 8,
                      paddingLeft: 12,
                      borderLeft: "2px solid var(--border-1)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                    }}
                  >
                    {stage.subStages.map((sub, i) => (
                      <div key={i} className="row" style={{ gap: 6 }}>
                        <Icon.ChevRight size={11} style={{ color: "var(--text-3)" }} />
                        <input
                          value={sub.label}
                          onChange={(e) => patchSub(stage._key, i, e.target.value)}
                          style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                        />
                        <button
                          className="btn btn--sm btn--ghost"
                          onClick={() => removeSub(stage._key, i)}
                          title="Eliminar sub-stage"
                        >
                          <Icon.Close size={11} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => addSub(stage._key)}
                      style={{ alignSelf: "flex-start", marginTop: 2 }}
                    >
                      <Icon.Plus size={11} /> Sub-stage
                    </button>
                  </div>
                </div>
              ))}

              <button
                className="btn"
                onClick={addStage}
                style={{ alignSelf: "flex-start" }}
              >
                <Icon.Plus size={13} /> Agregar stage
              </button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-1)",
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  padding: "6px 9px",
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  background: "var(--bg-1)",
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  padding: "6px 9px",
  color: "var(--text-1)",
  fontSize: 12.5,
  outline: "none",
};
