import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody, CardHead } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * PermissionsEditor — granular RBAC matrix editor (roadmap #28). Each
 * capability maps to a minimum role; the app's useCan() enforces it. Lets
 * admins re-scope who can do what without a deploy.
 */
const ROLE_OPTIONS = ["Agents", "Supervisors", "Admins"] as const;

const CAP_LABELS: Record<string, string> = {
  manage_campaigns: "Gestionar campañas",
  manage_leads: "Gestionar leads (embudo)",
  manage_appointments: "Gestionar citas",
  edit_taxonomy: "Editar tipificación",
  manage_catalogs: "Gestionar catálogos",
  manage_users: "Gestionar usuarios",
  view_audit: "Ver auditoría",
  monitor_agents: "Monitorear agentes (escuchar/intervenir)",
  view_reports: "Ver reportes",
  view_live_queue: "Ver cola en vivo",
};

export function PermissionsEditor() {
  const { user } = useAuth();
  const { matrix: initial, loading, refresh } = usePermissions();
  const [matrix, setMatrix] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!loading) setMatrix({ ...initial });
  }, [loading, initial]);

  const setRole = (cap: string, role: string) => {
    setMatrix((m) => ({ ...m, [cap]: role }));
    setDirty(true);
  };

  const save = async () => {
    const ep = getApiEndpoints();
    if (!ep?.managePermissions) return;
    setSaving(true);
    try {
      const r = await authedFetch(ep.managePermissions, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrix, actor: user?.username || "admin" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Permisos guardados — se aplican al instante");
      setDirty(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const caps = Object.keys(matrix).sort((a, b) =>
    (CAP_LABELS[a] || a).localeCompare(CAP_LABELS[b] || b)
  );

  return (
    <Card>
      <CardHead
        title="Permisos por rol"
        right={
          <button className="btn btn--primary btn--sm" onClick={save} disabled={saving || !dirty}>
            <Icon.Check size={12} /> {saving ? "Guardando…" : "Guardar"}
          </button>
        }
      />
      <CardBody>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
          Definí el <strong>rol mínimo</strong> requerido para cada capacidad. La app lo
          verifica en vivo (vía useCan) — cambiar esto re-escala quién puede hacer qué,
          sin necesidad de redeploy.
        </div>
        {loading ? (
          <div className="muted" style={{ padding: 20, textAlign: "center" }}>Cargando…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, maxWidth: 560 }}>
            {caps.map((cap) => (
              <div key={cap} style={{ display: "contents" }}>
                <div style={{ padding: "8px 0", fontSize: 13, borderBottom: "1px solid var(--border-1)" }}>
                  {CAP_LABELS[cap] || cap}
                </div>
                <div style={{ padding: "6px 0", borderBottom: "1px solid var(--border-1)" }}>
                  <select
                    value={matrix[cap]}
                    onChange={(e) => setRole(cap, e.target.value)}
                    style={{
                      padding: "5px 8px", border: "1px solid var(--border-1)", borderRadius: 6,
                      background: "var(--bg-1)", color: "var(--text-1)", fontSize: 12.5,
                    }}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r === "Agents" ? "Agente+" : r === "Supervisors" ? "Supervisor+" : "Solo Admin"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
