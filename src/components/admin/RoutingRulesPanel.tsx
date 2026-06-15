import { useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { useQueues } from "@/hooks/useQueues";
import { useConnections } from "@/hooks/useConnections";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import * as Icon from "@/components/vox/primitives";

/**
 * RoutingRulesPanel — "Configuración → Ruteo". Builder visual de reglas
 * atributo→cola: elegís un atributo del lead (ej. "programa") y mapeás cada
 * valor a una cola (1→A, 2→B, 3→C). ARIA genera el flow `ARIA-Outbound-Smart`
 * en Connect (Compare por $.Attributes.<atributo> → cola por valor). Las
 * campañas que usen ese flow distribuyen los contactos por atributo.
 *
 * Rediseño premium (#config): KPI strip + cards + reglas con badge/flecha +
 * vista previa visual del ruteo. La lógica (generate via provisionContactFlows)
 * es idéntica.
 */
const inputStyle: CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 13.5, border: "1px solid var(--border-1)",
  borderRadius: 9, background: "var(--bg-1)", color: "var(--text-1)", outline: "none",
};
const labelStyle: CSSProperties = {
  fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em",
  color: "var(--text-3)", marginBottom: 6, display: "block",
};

export function RoutingRulesPanel() {
  const { queues } = useQueues();
  const { config, refetch } = useConnections();
  const saved = config.routingRules;
  const ep = getApiEndpoints()?.provisionContactFlows || "";

  const [attribute, setAttribute] = useState("");
  const [rules, setRules] = useState<{ value: string; queueId: string }[]>([{ value: "", queueId: "" }]);
  const [defaultQueueId, setDefaultQueueId] = useState("");
  const [saving, setSaving] = useState(false);

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
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value="">Elegir cola…</option>
      {queues.map((q) => (
        <option key={q.id} value={q.id}>{q.name}</option>
      ))}
    </select>
  );

  const validRules = rules.filter((r) => r.value.trim() && r.queueId);
  const usedQueues = new Set([...validRules.map((r) => r.queueId), defaultQueueId].filter(Boolean));
  const flowActive = !!saved?.flowId;

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Ruteo inteligente</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3, maxWidth: 620, lineHeight: 1.5 }}>
            Mapeá un atributo del lead a colas → ARIA genera el flow <span className="mono" style={{ fontWeight: 700 }}>ARIA-Outbound-Smart</span> que
            las campañas usan para distribuir los contactos. Ej. <b>programa</b>: Sistemas → Cola A, Derecho → Cola B.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          <span className={`chip ${flowActive ? "chip--green" : ""}`} style={flowActive ? undefined : { color: "var(--text-3)" }}>
            <span className="dot" style={flowActive ? undefined : { background: "var(--text-3)" }} /> {flowActive ? "Flow activo" : "Sin generar"}
          </span>
          <button className="btn btn--primary btn--sm" onClick={generate} disabled={saving}>
            <Icon.Lightning size={13} /> {saving ? "Generando…" : flowActive ? "Actualizar flow" : "Generar flow"}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 }}>
        <Icon.Kpi label="Reglas" value={validRules.length} color="var(--accent-cyan)" />
        <Icon.Kpi label="Colas usadas" value={<span style={{ color: "var(--accent-violet)" }}>{usedQueues.size}</span>} color="var(--accent-violet)" />
        <Icon.Kpi label="Flow de ruteo" value={<span style={{ color: flowActive ? "var(--accent-green)" : "var(--text-3)" }}>{flowActive ? "Activo" : "—"}</span>} color="var(--accent-green)" />
      </div>

      {/* Atributo */}
      <Icon.Card>
        <Icon.CardBody>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 3 }}>1 · Atributo del lead</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
            El nombre EXACTO de la columna del CSV (o atributo del contacto) sobre el que se decide la cola.
          </div>
          <div style={{ maxWidth: 420 }}>
            <label style={labelStyle}>Nombre del atributo / columna</label>
            <input value={attribute} onChange={(e) => setAttribute(e.target.value)} placeholder="ej. programa · udep_nivel · tipo" style={inputStyle} />
          </div>
        </Icon.CardBody>
      </Icon.Card>

      {/* Reglas */}
      <Icon.Card>
        <Icon.CardBody>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>2 · Reglas · valor → cola</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {rules.map((r, i) => (
              <div key={i} className="row" style={{ gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--border-1)" }}>
                <span style={{ flex: "0 0 auto", display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 7, background: "var(--accent-cyan-soft)", color: "var(--accent-cyan)", fontWeight: 800, fontSize: 11.5 }}>{i + 1}</span>
                <input
                  value={r.value}
                  onChange={(e) => setRule(i, { value: e.target.value })}
                  placeholder="si el valor es… (ej. Sistemas)"
                  style={{ ...inputStyle, background: "var(--bg-1)", flex: "0 0 220px" }}
                />
                <Icon.ChevRight size={16} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
                <div style={{ flex: 1, minWidth: 0 }}>{queueSelect(r.queueId, (v) => setRule(i, { queueId: v }))}</div>
                <button className="btn btn--ghost btn--sm" onClick={() => removeRule(i)} disabled={rules.length <= 1} title="Quitar regla" style={{ flex: "0 0 auto" }}>
                  <Icon.Trash size={14} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn--sm" onClick={addRule} style={{ marginTop: 11 }}>
            <Icon.Plus size={13} /> Agregar regla
          </button>

          {/* Cola por defecto */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-1)" }}>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <span style={{ flex: "0 0 auto", display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 7, background: "var(--accent-amber-soft)", color: "var(--accent-amber)", fontWeight: 800, fontSize: 11 }}>
                <Icon.Queue size={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={{ ...labelStyle, marginBottom: 2 }}>Cola por defecto · el resto cae acá</label>
                <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Los valores sin coincidencia se rutean a esta cola.</div>
                <div style={{ maxWidth: 360 }}>{queueSelect(defaultQueueId, setDefaultQueueId)}</div>
              </div>
            </div>
          </div>
        </Icon.CardBody>
      </Icon.Card>

      {/* Vista previa visual */}
      {(validRules.length > 0 || defaultQueueId) && (
        <div style={{ borderRadius: 12, border: "1px solid var(--border-1)", background: "linear-gradient(135deg, var(--bg-2), var(--bg-1))", padding: "16px 18px" }}>
          <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 14 }}>
            <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: "var(--accent-cyan-soft)", color: "var(--accent-cyan)" }}><Icon.Lightning size={14} /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Vista previa del ruteo</div>
              <div className="muted" style={{ fontSize: 11.5 }}>Según <span className="mono" style={{ fontWeight: 700 }}>{attribute || "<atributo>"}</span>, un lead se rutea así:</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {validRules.map((r, i) => (
              <div key={i} className="row" style={{ gap: 9, alignItems: "center" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent-cyan-2, var(--accent-cyan))", background: "var(--accent-cyan-soft)", borderRadius: 7, padding: "4px 10px", minWidth: 80, textAlign: "center" }}>{r.value}</span>
                <Icon.ChevRight size={14} style={{ color: "var(--text-3)" }} />
                <span className="row" style={{ gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 600 }}><Icon.Queue size={13} style={{ color: "var(--text-3)" }} /> {queueName(r.queueId)}</span>
              </div>
            ))}
            {defaultQueueId && (
              <div className="row" style={{ gap: 9, alignItems: "center" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent-amber)", background: "var(--accent-amber-soft)", borderRadius: 7, padding: "4px 10px", minWidth: 80, textAlign: "center" }}>sin match</span>
                <Icon.ChevRight size={14} style={{ color: "var(--text-3)" }} />
                <span className="row" style={{ gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 600 }}><Icon.Queue size={13} style={{ color: "var(--text-3)" }} /> {queueName(defaultQueueId)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
