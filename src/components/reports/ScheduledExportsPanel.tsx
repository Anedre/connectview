import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2, Play, Clock, Mail } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * ScheduledExportsPanel — gestión de los exports programados (#7). Lista los
 * jobs, permite crear/editar (dataset + frecuencia + hora + destinatarios),
 * generar ahora, activar/pausar y borrar. El runner arma el XLSX y lo manda por
 * SES en la próxima corrida (o al instante con "Generar ahora").
 */

interface ExportJob {
  exportId: string;
  name: string;
  dataset: string;
  frequency: "daily" | "weekly" | "monthly";
  hourUtc: number;
  recipients: string[];
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
}

const FREQS: { id: ExportJob["frequency"]; label: string }[] = [
  { id: "daily", label: "Diario" },
  { id: "weekly", label: "Semanal" },
  { id: "monthly", label: "Mensual" },
];

const blankForm = {
  exportId: "",
  name: "",
  dataset: "leads",
  frequency: "daily" as ExportJob["frequency"],
  hourUtc: 13,
  recipients: "",
  enabled: true,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--border-2)",
  background: "var(--bg-2)",
  color: "var(--text-1)",
  fontSize: 12.5,
};

function fmt(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ScheduledExportsPanel() {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ep = getApiEndpoints();
  const url = ep?.manageScheduledExports;

  const load = useCallback(async () => {
    if (!url) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await authedFetch(url);
      const j = await r.json();
      setJobs(Array.isArray(j.exports) ? j.exports : []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!url) return;
    if (!form.name.trim()) { toast.error("Ponle un nombre"); return; }
    const recipients = form.recipients.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /\S+@\S+\.\S+/.test(s));
    if (recipients.length === 0) { toast.error("Agregá al menos un email válido"); return; }
    setSaving(true);
    try {
      const r = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exportId: form.exportId || undefined,
          name: form.name, dataset: form.dataset, frequency: form.frequency,
          hourUtc: form.hourUtc, recipients, enabled: form.enabled,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast.success(form.exportId ? "Export actualizado" : "Export programado creado");
      setForm(blankForm);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const act = async (job: ExportJob, kind: "runNow" | "toggle" | "delete") => {
    if (!url) return;
    setBusy(job.exportId);
    try {
      if (kind === "delete") {
        const r = await authedFetch(`${url}?exportId=${encodeURIComponent(job.exportId)}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast.success("Borrado");
      } else if (kind === "runNow") {
        const r = await authedFetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "runNow", exportId: job.exportId }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast.success("Generando y enviando el XLSX ahora…");
      } else {
        const r = await authedFetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...job, recipients: job.recipients, enabled: !job.enabled }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  };

  if (!url) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.6 }}>
        <Clock size={26} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 10, fontWeight: 600 }}>Exports programados no configurado</div>
        <div style={{ marginTop: 4, color: "var(--text-3)" }}>
          Corré <code>node scripts/create-scheduled-exports.mjs</code> y pegá la URL en <code>apiEndpoints.manageScheduledExports</code>.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Form */}
      <div style={{ border: "1px solid var(--border-1)", borderRadius: 12, padding: 14, background: "var(--bg-2)" }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
          {form.exportId ? "Editar export" : "Nuevo export programado"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 0.7fr", gap: 8, marginBottom: 8 }}>
          <input style={inputStyle} placeholder="Nombre (ej. Leads diarios)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <select style={inputStyle} value={form.dataset} onChange={(e) => setForm((f) => ({ ...f, dataset: e.target.value }))}>
            <option value="leads">Leads</option>
          </select>
          <select style={inputStyle} value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as ExportJob["frequency"] }))}>
            {FREQS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "0.6fr 2fr", gap: 8, marginBottom: 10 }}>
          <select style={inputStyle} value={form.hourUtc} onChange={(e) => setForm((f) => ({ ...f, hourUtc: Number(e.target.value) }))} title="Hora de envío (UTC)">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00 UTC</option>)}
          </select>
          <input style={inputStyle} placeholder="Destinatarios (emails separados por coma)" value={form.recipients} onChange={(e) => setForm((f) => ({ ...f, recipients: e.target.value }))} />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            <Plus size={13} /> {form.exportId ? "Guardar cambios" : "Crear export"}
          </button>
          {form.exportId && <button className="btn btn--sm" onClick={() => setForm(blankForm)}>Cancelar</button>}
        </div>
      </div>

      {/* Lista */}
      <div className="row" style={{ gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Programados ({jobs.length})</span>
        <button className="btn btn--sm" onClick={load} disabled={loading}><RefreshCw size={13} /> Refrescar</button>
      </div>
      {loading ? (
        <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12.5 }}>Cargando…</div>
      ) : jobs.length === 0 ? (
        <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12.5 }}>Todavía no hay exports programados.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {jobs.map((j) => (
            <div key={j.exportId} style={{ border: "1px solid var(--border-1)", borderRadius: 10, padding: "10px 12px", background: "var(--bg-1)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{j.name}</span>
                  <span className="chip" style={{ height: 17, fontSize: 10 }}>{FREQS.find((f) => f.id === j.frequency)?.label} · {String(j.hourUtc).padStart(2, "0")}:00 UTC</span>
                  {j.lastStatus && <span className="chip" style={{ height: 17, fontSize: 10, background: j.lastStatus === "ok" ? "var(--accent-green-soft)" : "var(--accent-red-soft)", color: j.lastStatus === "ok" ? "var(--accent-green)" : "var(--accent-red)" }}>{j.lastStatus === "ok" ? "última OK" : "última falló"}</span>}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <Mail size={11} /> {j.recipients.join(", ")} · próximo {fmt(j.nextRunAt)}{j.lastRunAt ? ` · última corrida ${fmt(j.lastRunAt)}` : ""}
                </div>
              </div>
              <button className={`chip ${j.enabled ? "chip--green" : ""}`} style={{ cursor: "pointer", border: "none" }} onClick={() => act(j, "toggle")} disabled={busy === j.exportId} title={j.enabled ? "Pausar" : "Activar"}>
                <span className="dot" /> {j.enabled ? "Activo" : "Pausado"}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => act(j, "runNow")} disabled={busy === j.exportId} title="Generar y enviar ahora"><Play size={13} /></button>
              <button className="btn btn--ghost btn--sm" onClick={() => setForm({ exportId: j.exportId, name: j.name, dataset: j.dataset, frequency: j.frequency, hourUtc: j.hourUtc, recipients: j.recipients.join(", "), enabled: j.enabled })} title="Editar">✎</button>
              <button className="btn btn--ghost btn--sm" onClick={() => act(j, "delete")} disabled={busy === j.exportId} title="Borrar"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
