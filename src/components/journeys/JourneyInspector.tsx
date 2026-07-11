import { useEffect, useState } from "react";
import { Trash2, X, Plus } from "lucide-react";
import type { Journey, JourneyNode, JourneyStats } from "@/hooks/useJourneys";
import { useSegments, type FilterRule, type FilterOp } from "@/hooks/useSegments";
import { getApiEndpoints } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented";
import { JOURNEY_KINDS, JOURNEY_ICONS } from "@/lib/journeyFlow";

/**
 * JourneyInspector — el panel derecho de edición de un paso del journey. Portado
 * del builder viejo (línea de vida) al nuevo canvas: misma lógica de params por
 * kind (entry/send/wait/branch/split/action/exit), re-cableado a JOURNEY_KINDS +
 * journeyIcon y con botón de cerrar. Reutiliza la CSS .jb-inspect*.
 */
type NodeParams = Record<string, unknown>;

const OP_LABELS: Record<FilterOp, string> = {
  eq: "es igual a",
  neq: "no es igual a",
  contains: "contiene",
  gte: "mayor o igual",
  lte: "menor o igual",
  in: "está en (lista)",
  exists: "tiene valor",
  notexists: "no tiene valor",
};
const LEAD_FIELDS = [
  "score",
  "grade",
  "stageId",
  "source",
  "email",
  "company",
  "montoEstimado",
  "utmSource",
];

function jbInput(width?: number): React.CSSProperties {
  return {
    width,
    flex: width ? undefined : 1,
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 7,
    border: "1px solid var(--border-2)",
    background: "var(--bg-1)",
    color: "var(--text-1)",
  };
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)" }}>{label}</span>
      {children}
    </label>
  );
}

function RuleRows({
  rules,
  onChange,
}: {
  rules: FilterRule[];
  onChange: (r: FilterRule[]) => void;
}) {
  const set = (i: number, patch: Partial<FilterRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <datalist id="jb-fields">
        {LEAD_FIELDS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {rules.map((r, i) => {
        const noVal = r.op === "exists" || r.op === "notexists";
        return (
          <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <input
              list="jb-fields"
              value={r.field}
              onChange={(e) => set(i, { field: e.target.value })}
              placeholder="campo"
              style={jbInput(84)}
            />
            <select
              value={r.op}
              onChange={(e) => set(i, { op: e.target.value as FilterOp })}
              style={jbInput(92)}
            >
              {(Object.keys(OP_LABELS) as FilterOp[]).map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {!noVal && (
              <input
                value={String(r.value ?? "")}
                onChange={(e) => set(i, { value: e.target.value })}
                placeholder="valor"
                style={jbInput(64)}
              />
            )}
            <button
              onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
              title="Quitar"
              style={{ ...jbInput(26), color: "var(--red)", cursor: "pointer", padding: 0 }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => onChange([...rules, { field: "score", op: "gte", value: "70" }])}
        className="jb-btn"
        style={{ alignSelf: "flex-start" }}
      >
        <Plus size={12} /> Condición
      </button>
    </div>
  );
}

export function JourneyInspector({
  node,
  entry,
  reenroll,
  stats,
  onEntry,
  onReenroll,
  onParams,
  onDelete,
  onClose,
}: {
  node: JourneyNode;
  entry: NonNullable<Journey["entry"]>;
  reenroll: boolean;
  stats: JourneyStats | null;
  onEntry: (e: NonNullable<Journey["entry"]>) => void;
  onReenroll: (b: boolean) => void;
  onParams: (id: string, patch: NodeParams) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { segments } = useSegments();
  const [templates, setTemplates] = useState<Array<{ name: string }>>([]);
  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.listWhatsAppTemplates) return;
    fetch(ep.listWhatsAppTemplates)
      .then((r) => r.json())
      .then((j) => setTemplates(Array.isArray(j.templates) ? j.templates : []))
      .catch(() => {});
  }, []);

  const def = JOURNEY_KINDS[node.kind];
  const Icon = JOURNEY_ICONS[def.icon] || JOURNEY_ICONS.action;
  const p = (node.params as NodeParams) || {};
  const set = (patch: NodeParams) => onParams(node.id, patch);

  return (
    <div className="jb-inspect">
      <div className="jb-inspect__head">
        <span className="jb-inspect__ico" style={{ "--_c": def.accent } as React.CSSProperties}>
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span className="jb-inspect__title">{def.label}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {node.kind !== "entry" && (
            <button
              onClick={() => onDelete(node.id)}
              title="Eliminar paso"
              className="jb-inspect__del"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button onClick={onClose} title="Cerrar" className="jb-inspect__del">
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {node.kind === "entry" && (
          <>
            <Field label="Cómo entran los leads">
              <select
                value={entry.segmentId ? "segment" : entry.trigger || "manual"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "manual") onEntry({ manual: true });
                  else if (v === "segment")
                    onEntry({ segmentId: segments[0]?.segmentId, manual: false });
                  else onEntry({ trigger: v, manual: false });
                }}
                style={jbInput()}
              >
                <option value="manual">Manual (los inscribes tú)</option>
                <option value="new_lead">Al crearse un lead nuevo</option>
                <option value="form_submit">Al enviar un formulario</option>
                <option value="stage_change">Al cambiar de etapa</option>
                <option value="segment">Cuando entra a un segmento</option>
              </select>
            </Field>
            {(entry.segmentId !== undefined || entry.trigger) && (
              <Field label="Segmento (filtro de entrada, opcional)">
                <select
                  value={entry.segmentId || ""}
                  onChange={(e) => onEntry({ ...entry, segmentId: e.target.value || undefined })}
                  style={jbInput()}
                >
                  <option value="">— Sin filtro —</option>
                  {segments.map((s) => (
                    <option key={s.segmentId} value={s.segmentId}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
              <Switch
                checked={reenroll}
                onCheckedChange={onReenroll}
                accent="var(--green)"
                aria-label="Permitir re-inscripción"
              />
              <span
                onClick={() => onReenroll(!reenroll)}
                style={{
                  cursor: "pointer",
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.4,
                }}
              >
                Permitir re-inscripción (volver a entrar si ya pasó)
              </span>
            </div>
            <div className="jb-note">
              La entrada automática por disparador/segmento la activa el tick del runner. La
              inscripción manual ya funciona desde Leads.
            </div>
          </>
        )}

        {node.kind === "send" && (
          <>
            <Field label="Canal">
              <SegmentedControl
                value={String(p.channel || "whatsapp")}
                onValueChange={(channel) => set({ channel })}
                options={[
                  { value: "whatsapp", label: "WhatsApp", color: "var(--green)" },
                  { value: "email", label: "Email", color: "var(--gold)" },
                ]}
                block
              />
            </Field>
            {p.channel === "email" ? (
              <>
                <Field label="Asunto">
                  <input
                    value={String(p.subject || "")}
                    onChange={(e) => set({ subject: e.target.value })}
                    placeholder="Asunto del correo"
                    style={jbInput()}
                  />
                </Field>
                <Field label="Cuerpo">
                  <textarea
                    value={String(p.body || "")}
                    onChange={(e) => set({ body: e.target.value })}
                    rows={4}
                    placeholder="Texto del correo…"
                    style={{ ...jbInput(), resize: "vertical", fontFamily: "inherit" }}
                  />
                </Field>
              </>
            ) : (
              <Field label="Plantilla de WhatsApp">
                <input
                  list="jb-templates"
                  value={String(p.templateName || "")}
                  onChange={(e) => set({ templateName: e.target.value })}
                  placeholder="nombre_de_la_plantilla"
                  style={jbInput()}
                />
                <datalist id="jb-templates">
                  {templates.map((t) => (
                    <option key={t.name} value={t.name} />
                  ))}
                </datalist>
              </Field>
            )}
            <div className="jb-note">
              El envío pasa por el gate de supresión (no le manda a un DNC).
            </div>
          </>
        )}

        {node.kind === "wait" && (
          <>
            <Field label="Tipo de espera">
              <select
                value={Array.isArray(p.untilRule) ? "until" : "days"}
                onChange={(e) =>
                  set(
                    e.target.value === "until"
                      ? { untilRule: [{ field: "grade", op: "eq", value: "A" }], days: undefined }
                      : { days: 1, untilRule: undefined },
                  )
                }
                style={jbInput()}
              >
                <option value="days">Días fijos</option>
                <option value="until">Hasta que se cumpla una condición</option>
              </select>
            </Field>
            {Array.isArray(p.untilRule) ? (
              <Field label="Esperar hasta que (todas)">
                <RuleRows
                  rules={p.untilRule as FilterRule[]}
                  onChange={(r) => set({ untilRule: r })}
                />
              </Field>
            ) : (
              <Field label="Días a esperar">
                <input
                  type="number"
                  min={0}
                  value={Number(p.days ?? 1)}
                  onChange={(e) => set({ days: Math.max(0, Number(e.target.value)) })}
                  style={jbInput(90)}
                />
              </Field>
            )}
          </>
        )}

        {node.kind === "branch" && (
          <>
            <Field label="Coincidir">
              <select
                value={String(p.match || "all")}
                onChange={(e) => set({ match: e.target.value })}
                style={jbInput()}
              >
                <option value="all">Todas las condiciones (Y)</option>
                <option value="any">Cualquier condición (O)</option>
              </select>
            </Field>
            <Field label="Condiciones">
              <RuleRows
                rules={(p.rules as FilterRule[]) || []}
                onChange={(r) => set({ rules: r })}
              />
            </Field>
            <div className="jb-note">
              <strong>Sí</strong> = el lead cumple · <strong>No</strong> = no cumple.
            </div>
          </>
        )}

        {node.kind === "split" && (
          <>
            <Field label="% que va a la rama A">
              <input
                type="number"
                min={0}
                max={100}
                value={Number(p.percent ?? 50)}
                onChange={(e) =>
                  set({ percent: Math.max(0, Math.min(100, Number(e.target.value))) })
                }
                style={jbInput(90)}
              />
            </Field>
            <div className="jb-note">
              Reparte los leads de forma estable: el mismo lead cae siempre en la misma rama.{" "}
              <strong>A</strong> recibe {Number(p.percent ?? 50)}% · <strong>B</strong> el resto.
            </div>
          </>
        )}

        {node.kind === "action" && (
          <>
            <Field label="Tipo de acción">
              <select
                value={String(p.type || "moveStage")}
                onChange={(e) => set({ type: e.target.value })}
                style={jbInput()}
              >
                <option value="moveStage">Mover a etapa</option>
                <option value="webhook">Llamar webhook</option>
                <option value="enqueueDialer">Llamar (encolar al dialer)</option>
              </select>
            </Field>
            {p.type === "webhook" ? (
              <Field label="URL del webhook">
                <input
                  value={String(p.url || "")}
                  onChange={(e) => set({ url: e.target.value })}
                  placeholder="https://…"
                  style={jbInput()}
                />
              </Field>
            ) : p.type === "enqueueDialer" ? (
              <Field label="Campaña (id, opcional)">
                <input
                  value={String(p.campaignId || "")}
                  onChange={(e) => set({ campaignId: e.target.value })}
                  placeholder="id de campaña"
                  style={jbInput()}
                />
              </Field>
            ) : (
              <Field label="Etapa destino (stageId)">
                <input
                  value={String(p.stageId || "")}
                  onChange={(e) => set({ stageId: e.target.value })}
                  placeholder='p.ej. "won"'
                  style={jbInput()}
                />
              </Field>
            )}
          </>
        )}

        {node.kind === "exit" && (
          <div className="jb-note" style={{ fontSize: 12.5 }}>
            Fin del recorrido. Al llegar aquí, el lead sale del journey (enrollment «done»).
          </div>
        )}

        {stats && stats.total > 0 && (
          <div className="jb-note" style={{ fontSize: 12 }}>
            {stats.byNode?.[node.id] || 0} lead(s) en este paso ahora.
          </div>
        )}
      </div>
    </div>
  );
}
