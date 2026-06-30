import { useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "@/hooks/useAuth";
import { useProgram } from "@/context/ProgramContext";
import * as Icon from "@/components/vox/primitives";

interface QuickCaptureLeadFormProps {
  /** Teléfono pre-cargado (del contacto activo) si está disponible. */
  defaultPhone?: string;
  onCreated?: () => void;
}

/**
 * QuickCaptureLeadForm — alta inline de un lead desde el Agent Desktop (Pilar 5 ·
 * R8). Para referidos / números nuevos que no están en el CRM: el agente lo crea
 * al vuelo (teléfono + nombre + programa) → `manage-leads` → `propagateLead` lo
 * vuelve candidato en Salesforce al toque, sin pasar por una campaña/CSV.
 */
export function QuickCaptureLeadForm({ defaultPhone, onCreated }: QuickCaptureLeadFormProps) {
  const { user } = useAuth();
  const { programs, activeProgramId } = useProgram();
  const activePrograms = programs.filter((p) => p.status !== "archivado");

  const [phone, setPhone] = useState(defaultPhone || "");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [source, setSource] = useState<"referral" | "call">("referral");
  const [programId, setProgramId] = useState(
    activeProgramId !== "all" && activeProgramId !== "none" ? activeProgramId : ""
  );
  const [referredBy, setReferredBy] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const p = phone.trim();
    if (!p) { toast.error("El teléfono es obligatorio"); return; }
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) { toast.error("Endpoint de leads no configurado"); return; }
    setSubmitting(true);
    try {
      const attributes: Record<string, string> = {};
      if (referredBy.trim()) attributes.referredBy = referredBy.trim();
      const r = await authedFetch(ep.manageLeads, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: p,
          name: name.trim() || undefined,
          company: company.trim() || undefined,
          source,
          programId: programId || undefined,
          attributes: Object.keys(attributes).length ? attributes : undefined,
          actor: user?.username || "agente",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      toast.success(d.isNew === false ? "Ese teléfono ya era lead (actualizado)" : "Lead creado → candidato en Salesforce");
      setPhone(defaultPhone || ""); setName(""); setCompany(""); setReferredBy("");
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear el lead");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>Teléfono *</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+51953730189" className="vox-field" />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>Nombre</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del referido" className="vox-field" />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>Empresa (opcional)</span>
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="—" className="vox-field" />
      </label>

      <div style={{ display: "flex", gap: 6 }}>
        {(["referral", "call"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className="btn btn--sm"
            style={{
              flex: 1, justifyContent: "center",
              ...(source === s ? { borderColor: "var(--accent-cyan)", color: "var(--accent-cyan)", background: "var(--accent-cyan-soft)" } : {}),
            }}
          >
            {s === "referral" ? "Referido" : "De la llamada"}
          </button>
        ))}
      </div>

      {source === "referral" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="muted" style={{ fontSize: 10.5 }}>Referido por (opcional)</span>
          <input value={referredBy} onChange={(e) => setReferredBy(e.target.value)} placeholder="Nombre/teléfono de quien refirió" className="vox-field" />
        </label>
      )}

      {activePrograms.length > 0 && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="muted" style={{ fontSize: 10.5 }}>Programa (opcional)</span>
          <select value={programId} onChange={(e) => setProgramId(e.target.value)} className="vox-field">
            <option value="">Sin programa</option>
            {activePrograms.map((p) => (
              <option key={p.programId} value={p.programId}>{p.name}</option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        className="btn btn--success"
        onClick={submit}
        disabled={submitting || !phone.trim()}
        style={{ marginTop: 4, height: 34, justifyContent: "center" }}
      >
        <Icon.User size={13} />
        {submitting ? "Creando…" : "Crear lead"}
      </button>
    </div>
  );
}
