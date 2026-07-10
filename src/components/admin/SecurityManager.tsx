import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import * as Icon from "@/components/vox/primitives";
import { Avatar, Card, CardBody, Kpi } from "@/components/vox/primitives";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminAudit, type AdminAuditEntry } from "@/hooks/useAdminAudit";

/**
 * SecurityManager — "Seguridad" de Configuración: el centro de gobierno de la
 * plataforma. Une, premium y cohesivo, las dos piezas que antes estaban sueltas
 * (PermissionsEditor + AuditLogViewer):
 *
 * - KPI strip de postura de seguridad (capacidades, restringidas a Admin,
 *   eventos y errores en 24h).
 * - Matriz de permisos RBAC con segmented de color (Agente+ / Supervisor+ /
 *   Solo Admin) — más intuitivo que un select. Guarda a `manage-permissions`;
 *   `useCan()` lo aplica en vivo, sin redeploy.
 * - Bitácora de auditoría EN VIVO (auto-refresh 15s) con búsqueda, filtros,
 *   export CSV y filas premium (avatar del admin, chip de acción, pill de
 *   resultado). Toda acción privilegiada aterriza aquí.
 */

const ROLE_SEQ = ["Agents", "Supervisors", "Admins"] as const;
const ROLE_META: Record<string, { label: string; tone: string; soft: string }> = {
  Agents: { label: "Agente+", tone: "var(--accent-green)", soft: "var(--accent-green-soft)" },
  Supervisors: {
    label: "Supervisor+",
    tone: "var(--accent-cyan)",
    soft: "var(--accent-cyan-soft)",
  },
  Admins: { label: "Solo Admin", tone: "var(--accent-red)", soft: "var(--accent-red-soft)" },
};

const CAP_META: Record<string, { label: string; desc: string; icon: React.ElementType }> = {
  manage_campaigns: {
    label: "Gestionar campañas",
    desc: "Crear, editar y lanzar campañas outbound.",
    icon: Icon.Megaphone,
  },
  manage_leads: {
    label: "Gestionar leads",
    desc: "Mover y editar el embudo de leads.",
    icon: Icon.Ticket,
  },
  manage_appointments: {
    label: "Gestionar citas",
    desc: "Agendar y reprogramar citas.",
    icon: Icon.Calendar,
  },
  edit_taxonomy: {
    label: "Editar tipificación",
    desc: "Cambiar el árbol de tipificación.",
    icon: Icon.Tag,
  },
  manage_catalogs: {
    label: "Gestionar catálogos",
    desc: "Editar las tablas de catálogos.",
    icon: Icon.Pad,
  },
  manage_users: {
    label: "Gestionar usuarios",
    desc: "Invitar y asignar roles del equipo.",
    icon: Icon.Users,
  },
  view_audit: {
    label: "Ver auditoría",
    desc: "Acceder a la bitácora de seguridad.",
    icon: Icon.Eye,
  },
  monitor_agents: {
    label: "Monitorear agentes",
    desc: "Escuchar e intervenir llamadas en vivo.",
    icon: Icon.Headset,
  },
  view_reports: {
    label: "Ver reportes",
    desc: "Acceder a dashboards y reportes.",
    icon: Icon.Chart,
  },
  view_live_queue: {
    label: "Ver cola en vivo",
    desc: "Ver el estado de las colas en tiempo real.",
    icon: Icon.Queue,
  },
  use_copilot: {
    label: "Usar Copilot",
    desc: "Ver y usar el asistente Copilot flotante.",
    icon: Icon.Sparkles,
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function timeAgo(ts: string): string {
  const t = new Date(ts).getTime();
  if (!t) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "hace seg";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function prettyAction(a: string): string {
  const p = a.replace(/[_-]+/g, " ").trim();
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : a;
}

function targetToString(t: AdminAuditEntry["target"]): string {
  if (t == null) return "";
  if (typeof t === "string") return t;
  return Object.entries(t)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" · ");
}

const filterStyle: React.CSSProperties = {
  background: "var(--bg-1)",
  border: "1px solid var(--border-1)",
  borderRadius: 8,
  padding: "8px 11px",
  color: "var(--text-1)",
  fontSize: 12.5,
  outline: "none",
};

export function SecurityManager() {
  const { user } = useAuth();
  const { matrix: initial, loading: permLoading, refresh: refreshPerms } = usePermissions();
  const { entries, loading: auditLoading, refresh: refreshAudit } = useAdminAudit(300, 15000);

  // ── Permisos ─────────────────────────────────────────────────────────────
  const [matrix, setMatrix] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!permLoading) {
      setMatrix({ ...initial });
      setDirty(false);
    }
  }, [permLoading, initial]);

  const setRole = (cap: string, role: string) => {
    setMatrix((m) => ({ ...m, [cap]: role }));
    setDirty(true);
  };

  const savePerms = async () => {
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
      await refreshPerms();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const caps = useMemo(
    () =>
      Object.keys(matrix).sort((a, b) =>
        (CAP_META[a]?.label || a).localeCompare(CAP_META[b]?.label || b),
      ),
    [matrix],
  );

  // ── Auditoría: filtros ──────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");

  const actions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action))).sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries
      .filter((e) => (action ? e.action === action : true))
      .filter((e) => (result ? e.result === result : true))
      .filter((e) => {
        if (!needle) return true;
        const hay =
          `${e.action} ${e.actor} ${targetToString(e.target)} ${e.errorMsg || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  }, [entries, q, action, result]);

  const exportCsv = () => {
    const head = ["timestamp", "action", "actor", "result", "target", "error"];
    const lines = filtered.map((e) =>
      [
        e.timestamp,
        e.action,
        e.actor,
        e.result,
        targetToString(e.target).replace(/"/g, "'"),
        (e.errorMsg || "").replace(/"/g, "'"),
      ]
        .map((c) => `"${String(c ?? "")}"`)
        .join(","),
    );
    const csv = [head.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── KPIs ────────────────────────────────────────────────────────────────
  const now = Date.now();
  const adminOnly = caps.filter((c) => matrix[c] === "Admins").length;
  const events24h = entries.filter((e) => now - new Date(e.timestamp).getTime() < DAY_MS).length;
  const errors24h = entries.filter(
    (e) => e.result === "error" && now - new Date(e.timestamp).getTime() < DAY_MS,
  ).length;

  const refreshAll = () => {
    refreshPerms();
    refreshAudit();
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header */}
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
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Seguridad</div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 660, lineHeight: 1.5 }}
          >
            Quién puede hacer qué, y un registro de todo lo sensible. Los permisos se aplican{" "}
            <strong>en vivo</strong> y cada acción privilegiada queda auditada.
          </div>
        </div>
        <button
          className="btn btn--sm"
          onClick={refreshAll}
          disabled={auditLoading || permLoading}
          style={{ flex: "0 0 auto" }}
        >
          <Icon.Refresh size={13} /> Actualizar
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14 }}>
        <Kpi
          label="Capacidades gobernadas"
          value={<span>{caps.length}</span>}
          color="var(--accent-cyan)"
        />
        <Kpi
          label="Restringidas a Admin"
          value={
            <span style={{ color: adminOnly > 0 ? "var(--accent-red)" : "var(--text-3)" }}>
              {adminOnly}
            </span>
          }
          color="var(--accent-red)"
        />
        <Kpi label="Eventos (24h)" value={<span>{events24h}</span>} color="var(--accent-violet)" />
        <Kpi
          label="Errores (24h)"
          value={
            <span style={{ color: errors24h > 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
              {errors24h}
            </span>
          }
          color={errors24h > 0 ? "var(--accent-red)" : "var(--accent-green)"}
        />
      </div>

      {/* Permisos por rol */}
      <Card>
        <CardBody>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Permisos por rol</div>
              <div
                className="muted"
                style={{ fontSize: 12, marginTop: 3, maxWidth: 560, lineHeight: 1.5 }}
              >
                Define el <strong>rol mínimo</strong> de cada capacidad. La app lo verifica en vivo
                (vía <code>useCan</code>) — cambiarlo re-escala quién puede hacer qué, sin redeploy.
              </div>
            </div>
            <div className="row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
              {dirty && (
                <span className="chip chip--amber" style={{ height: 28 }}>
                  <span className="dot" /> Sin guardar
                </span>
              )}
              <button
                className="btn btn--primary btn--sm"
                onClick={savePerms}
                disabled={saving || !dirty}
              >
                <Icon.Check size={13} /> {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>

          {/* Leyenda */}
          <div className="row" style={{ gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            {ROLE_SEQ.map((r) => (
              <span
                key={r}
                className="row"
                style={{ gap: 5, alignItems: "center", fontSize: 11, color: "var(--text-3)" }}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: 999, background: ROLE_META[r].tone }}
                />{" "}
                {ROLE_META[r].label}
              </span>
            ))}
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              · de menos a más restrictivo
            </span>
          </div>

          <div style={{ marginTop: 8 }}>
            {permLoading ? (
              <div className="muted" style={{ padding: 24, textAlign: "center" }}>
                Cargando permisos…
              </div>
            ) : caps.length === 0 ? (
              <div className="muted" style={{ padding: 24, textAlign: "center" }}>
                No hay capacidades configuradas.
              </div>
            ) : (
              caps.map((cap) => {
                const meta = CAP_META[cap];
                const Icn = meta?.icon || Icon.Shield;
                return (
                  <div
                    key={cap}
                    className="row"
                    style={{
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 0",
                      borderBottom: "1px solid var(--border-1)",
                    }}
                  >
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        background: "var(--bg-2)",
                        color: "var(--text-2)",
                        flex: "0 0 auto",
                      }}
                    >
                      <Icn size={17} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{meta?.label || cap}</div>
                      {meta?.desc && (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
                          {meta.desc}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        background: "var(--bg-2)",
                        border: "1px solid var(--border-1)",
                        borderRadius: 9,
                        padding: 2,
                        gap: 2,
                        flex: "0 0 auto",
                      }}
                    >
                      {ROLE_SEQ.map((r) => {
                        const active = matrix[cap] === r;
                        const rm = ROLE_META[r];
                        return (
                          <button
                            key={r}
                            onClick={() => setRole(cap, r)}
                            style={{
                              border: "none",
                              cursor: "pointer",
                              borderRadius: 7,
                              padding: "5px 11px",
                              fontSize: 11.5,
                              fontWeight: 700,
                              transition: "all .12s",
                              background: active ? rm.soft : "transparent",
                              color: active ? rm.tone : "var(--text-3)",
                            }}
                          >
                            {rm.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardBody>
      </Card>

      {/* Bitácora de auditoría */}
      <Card>
        <CardBody>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div className="row" style={{ gap: 9, alignItems: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Bitácora de auditoría</div>
              <span
                className="row"
                style={{
                  gap: 5,
                  alignItems: "center",
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "var(--accent-green)",
                  background: "var(--accent-green-soft)",
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                <span className="dot" style={{ background: "var(--accent-green)" }} /> En vivo · 15s
              </span>
            </div>
            <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
              <span className="muted" style={{ fontSize: 11.5, alignSelf: "center" }}>
                {filtered.length}
                {filtered.length !== entries.length ? ` de ${entries.length}` : ""} eventos
              </span>
              <button className="btn btn--sm" onClick={exportCsv} disabled={filtered.length === 0}>
                <Icon.Download size={12} /> CSV
              </button>
            </div>
          </div>

          {/* Filtros */}
          <div className="row" style={{ gap: 8, margin: "13px 0", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <Icon.Search
                size={13}
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-3)",
                }}
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar acción, admin, target…"
                style={{ ...filterStyle, width: "100%", paddingLeft: 31 }}
              />
            </div>
            <select value={action} onChange={(e) => setAction(e.target.value)} style={filterStyle}>
              <option value="">Todas las acciones</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {prettyAction(a)}
                </option>
              ))}
            </select>
            <select value={result} onChange={(e) => setResult(e.target.value)} style={filterStyle}>
              <option value="">Todos</option>
              <option value="success">OK</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div
            style={{
              maxHeight: 540,
              overflowY: "auto",
              borderRadius: 10,
              border: "1px solid var(--border-1)",
            }}
          >
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "var(--bg-2)", zIndex: 1 }}>
                  {["Cuándo", "Acción", "Admin", "Target", "Resultado"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "9px 12px",
                        color: "var(--text-3)",
                        fontWeight: 700,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: ".04em",
                        borderBottom: "1px solid var(--border-1)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ padding: 36, textAlign: "center", color: "var(--text-3)" }}
                    >
                      {auditLoading ? "Cargando…" : "Sin entradas que coincidan."}
                    </td>
                  </tr>
                )}
                {filtered.map((e) => (
                  <tr key={e.auditId} style={{ borderBottom: "1px solid var(--border-1)" }}>
                    <td
                      style={{ padding: "9px 12px", color: "var(--text-3)", whiteSpace: "nowrap" }}
                      title={new Date(e.timestamp).toLocaleString("es-PE")}
                    >
                      {timeAgo(e.timestamp)}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 11.5,
                          color: "var(--text-1)",
                          background: "var(--bg-2)",
                          border: "1px solid var(--border-1)",
                          borderRadius: 7,
                          padding: "2px 8px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {prettyAction(e.action)}
                      </span>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <span className="row" style={{ gap: 7, alignItems: "center" }}>
                        <Avatar name={e.actor || "—"} size="sm" />
                        <span style={{ fontSize: 12 }}>{e.actor || "—"}</span>
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "9px 12px",
                        color: "var(--text-3)",
                        fontSize: 11,
                        maxWidth: 300,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={e.errorMsg || targetToString(e.target)}
                    >
                      {targetToString(e.target) || "—"}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <span
                        className={`chip ${e.result === "success" ? "chip--green" : "chip--red"}`}
                      >
                        <span className="dot" /> {e.result === "success" ? "OK" : "Error"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
