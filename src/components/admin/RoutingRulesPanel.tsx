import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { useQueues } from "@/hooks/useQueues";
import { useConnections } from "@/hooks/useConnections";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import * as Icon from "@/components/vox/primitives";

/**
 * RoutingRulesPanel — "Configuración → Ruteo". Builder visual de reglas
 * atributo→cola: elegís un atributo del lead (ej. "programa") y mapeás cada
 * valor a una cola (1→A, 2→B, 3→C). AIRA genera el flow `AIRA-Outbound-Smart`
 * en Connect (Compare por $.Attributes.<atributo> → cola por valor). Las
 * campañas que usen ese flow distribuyen los contactos por atributo, y el
 * panel de agentes deja asignar agentes por cola.
 */
const inputStyle: CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  fontSize: 13.5,
  border: "1px solid var(--border-1)",
  borderRadius: 8,
  background: "var(--bg-2)",
  color: "var(--text-1)",
};
const labelSpan: CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 700,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border-1)", fontWeight: 700, fontSize: 13, background: "var(--bg-2)" }}>{title}</div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

export function RoutingRulesPanel() {
  const { queues } = useQueues();
  const { config, refetch } = useConnections();
  const saved = config.routingRules;
  const ep = getApiEndpoints()?.provisionContactFlows || "";

  const [attribute, setAttribute] = useState("");
  const [rules, setRules] = useState<{ value: string; queueId: string }[]>([{ value: "", queueId: "" }]);
  const [defaultQueueId, setDefaultQueueId] = useState("");
  const [saving, setSaving] = useState(false);

  // (Re)inicializar el form desde lo guardado cuando carga / cambia.
  useEffect(() => {
    if (!saved) return;
    setAttribute(saved.attribute || "");
    setRules(saved.rules && saved.rules.length > 0 ? saved.rules : [{ value: "", queueId: "" }]);
    setDefaultQueueId(saved.defaultQueueId || "");
  }, [saved?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRule = (i: number, patch: Partial<{ value: string; queueId: string }>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { value: "", queueId: "" }]);
  const removeRule = (i: number) => setRules((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const queueName = (id: string) => queues.find((q) => q.id === id)?.name || "";

  const generate = async () => {
    const clean = rules.filter((r) => r.value.trim() && r.queueId);
    if (!attribute.trim() || clean.length === 0 || !defaultQueueId) {
      toast.error("Completá el atributo, al menos una regla (valor → cola) y la cola por defecto.");
      return;
    }
    if (!ep) {
      toast.message("La provisión de flows aún no está desplegada.");
      return;
    }
    setSaving(true);
    try {
      const r = await authedFetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "smartFlow", attribute: attribute.trim(), rules: clean, defaultQueueId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo generar el flow");
      toast.success(`Flow de ruteo ${j.action === "created" ? "creado" : "actualizado"}: ${j.flowName} · ${j.rulesCount} reglas`);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo generar el flow");
    } finally {
      setSaving(false);
    }
  };

  const queueSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, marginTop: 0 }}>
      <option value="">Elegir cola…</option>
      {queues.map((q) => (
        <option key={q.id} value={q.id}>{q.name}</option>
      ))}
    </select>
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ fontWeight: 800, fontSize: 19 }}>Ruteo inteligente</div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4, marginBottom: 18, maxWidth: 600, lineHeight: 1.5 }}>
        Mapeá un atributo del lead a colas. AIRA genera el flow{" "}
        <span className="mono" style={{ fontWeight: 700 }}>AIRA-Outbound-Smart</span>{" "}
        que las campañas usan para distribuir los contactos: ej. <b>programa</b> = 1 → Cola A,
        2 → Cola B, 3 → Cola C. Los valores sin coincidencia caen a la cola por defecto.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Section title="Atributo del lead">
          <label style={{ display: "block" }}>
            <span style={labelSpan}>Nombre del atributo / columna</span>
            <input value={attribute} onChange={(e) => setAttribute(e.target.value)} placeholder="ej. programa · udep_nivel · tipo" style={inputStyle} />
          </label>
          <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
            El nombre EXACTO de la columna del CSV (o atributo del contacto) sobre el que se decide la cola.
          </div>
        </Section>

        <Section title="Reglas · valor → cola">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rules.map((r, i) => (
              <div key={i} className="row" style={{ gap: 10, alignItems: "center" }}>
                <input
                  value={r.value}
                  onChange={(e) => setRule(i, { value: e.target.value })}
                  placeholder="valor (ej. 1)"
                  style={{ ...inputStyle, marginTop: 0, flex: "0 0 160px" }}
                />
                <Icon.ChevRight size={16} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
                <div style={{ flex: 1 }}>{queueSelect(r.queueId, (v) => setRule(i, { queueId: v }))}</div>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => removeRule(i)}
                  disabled={rules.length <= 1}
                  title="Quitar regla"
                  style={{ flex: "0 0 auto" }}
                >
                  <Icon.Trash size={14} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn--sm" onClick={addRule} style={{ marginTop: 12 }}>
            <Icon.Plus size={13} /> Agregar regla
          </button>

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-1)" }}>
            <span style={labelSpan}>Cola por defecto (valores sin coincidencia)</span>
            <div style={{ marginTop: 6, maxWidth: 340 }}>{queueSelect(defaultQueueId, setDefaultQueueId)}</div>
          </div>
        </Section>

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {saved?.flowName ? (
              <>Flow actual: <span className="mono" style={{ fontWeight: 700 }}>{saved.flowName}</span> · {saved.rules?.length || 0} reglas</>
            ) : (
              "Todavía no generaste el flow de ruteo."
            )}
          </div>
          <button className="btn btn--primary" onClick={generate} disabled={saving}>
            {saving ? "Generando…" : saved?.flowId ? "Actualizar flow de ruteo" : "Generar flow de ruteo"}
          </button>
        </div>

        {defaultQueueId && rules.some((r) => r.value.trim() && r.queueId) && (
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: "12px 14px", background: "var(--bg-2)", borderRadius: 10, border: "1px solid var(--border-1)" }}>
            <b>Vista previa:</b> según <span className="mono">{attribute || "<atributo>"}</span> →{" "}
            {rules.filter((r) => r.value.trim() && r.queueId).map((r, i) => (
              <span key={i}>{i > 0 ? " · " : ""}<b>{r.value}</b>→{queueName(r.queueId)}</span>
            ))}
            {" · "}resto → <b>{queueName(defaultQueueId)}</b>
          </div>
        )}
      </div>
    </div>
  );
}
