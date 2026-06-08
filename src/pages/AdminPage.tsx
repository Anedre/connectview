import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import * as Icon from "@/components/vox/primitives";
import {
  Avatar,
  Card,
  CardBody,
  CardHead,
  Kpi,
  StatusPill,
} from "@/components/vox/primitives";
import { TaxonomyEditor } from "@/components/admin/TaxonomyEditor";
import { CatalogEditor } from "@/components/admin/CatalogEditor";
import { AuditLogViewer } from "@/components/admin/AuditLogViewer";
import { PermissionsEditor } from "@/components/admin/PermissionsEditor";
import { IntegrationsManager } from "@/components/admin/IntegrationsManager";
import { QueuesPanel } from "@/components/admin/QueuesPanel";
import { RoutingRulesPanel } from "@/components/admin/RoutingRulesPanel";
import { TeamManager } from "@/components/admin/TeamManager";
import { PageHeader } from "@/components/vox/PageHeader";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { ConnectUserRoleModal } from "@/components/admin/ConnectUserRoleModal";

interface ConnectUser {
  userId: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  enabled: boolean;
  created: string;
  groups: string[];
  groupIds: string[];
}

const PROFILE_CHIP: Record<string, string> = {
  Admin: "chip--red",
  CallCenterManager: "chip--cyan",
  QualityAnalyst: "chip--violet",
  Agent: "chip--green",
};

export function AdminPage() {
  // Instancia de Connect del TENANT (no más hardcode a novasys.my.connect.aws):
  // los links "Gestionar en Connect" abren la consola de SU instancia.
  const { instanceUrl } = useConnectAuth();
  const [users, setUsers] = useState<ConnectUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState("users");
  const [availableProfiles, setAvailableProfiles] = useState<
    { id: string; name: string }[]
  >([]);
  const [editingUser, setEditingUser] = useState<ConnectUser | null>(null);

  const fetchUsers = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const endpoints = getApiEndpoints();
      if (!endpoints?.listUsers) throw new Error("API no configurada");
      const response = await fetch(endpoints.listUsers);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setUsers(data.users || []);
      setAvailableProfiles(data.availableProfiles || []);
      setError(null);
    } catch (err) {
      // En refetch silencioso (focus) mantenemos el último estado bueno en vez
      // de vaciar la lista por un blip de red.
      if (!silent) {
        setError(err instanceof Error ? err.message : "Error cargando usuarios");
        setUsers([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Re-sincroniza la lista al volver el foco a la pestaña (p.ej. tras conectar/
  // desconectar Connect por fuera), sin parpadear el spinner.
  useRefetchOnFocus(useCallback(() => fetchUsers({ silent: true }), [fetchUsers]));

  // OAuth callback de Salesforce (#44): salesforce-oauth-callback redirige
  // a /admin?sf=ok o /admin?sf=err&reason=... — convertimos a toast y
  // limpiamos la URL para que un refresh no re-dispare la notificación.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const sf = url.searchParams.get("sf");
    if (!sf) return;
    if (sf === "ok") {
      toast.success("Salesforce conectado correctamente");
      setSection("integrations");
    } else if (sf === "err") {
      const reason = url.searchParams.get("reason") || "razón desconocida";
      toast.error(`Salesforce no se pudo conectar: ${reason}`);
      setSection("integrations");
    }
    url.searchParams.delete("sf");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const stats = {
    total: users.length,
    admins: users.filter((u) => u.groups.includes("Admin")).length,
    managers: users.filter((u) => u.groups.includes("CallCenterManager")).length,
    agents: users.filter((u) => u.groups.includes("Agent")).length,
  };

  const sections = [
    { id: "users", label: "Usuarios y roles", icon: Icon.Users },
    { id: "tipificacion", label: "Tipificación", icon: Icon.Tag },
    { id: "catalogos", label: "Catálogos", icon: Icon.Pad },
    { id: "channels", label: "Canales", icon: Icon.Globe },
    { id: "queues", label: "Colas", icon: Icon.Queue },
    { id: "routing", label: "Ruteo", icon: Icon.Lightning },
    { id: "integrations", label: "Integraciones", icon: Icon.Lightning },
    { id: "ai", label: "IA y Contact Lens", icon: Icon.Sparkles },
    { id: "security", label: "Seguridad", icon: Icon.Shield },
  ];

  return (
    <div className="view" style={{ maxWidth: 1500 }}>
      <PageHeader
        crumb="Sistema"
        title="Configuración"
        filterPill="Todos"
        sub={
          <>
            {/* Inconsistencia cross-página: el resto de subtítulos están
                en español puro, este mezclaba "Workspace · Connect users". */}
            Sistema · Usuarios de Connect · {stats.total} en total
          </>
        }
        actions={
          <>
            <button
              className="btn"
              onClick={() =>
                window.open(`${instanceUrl}/connect/users`, "_blank")
              }
            >
              Abrir en Connect
            </button>
            <button className="btn" onClick={() => fetchUsers()} disabled={loading}>
              <Icon.Refresh size={14} /> Actualizar
            </button>
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 18 }}>
        <Card style={{ height: "fit-content" }}>
          <CardBody style={{ padding: 8 }}>
            {sections.map((s) => {
              const Icn = s.icon;
              return (
                <div
                  key={s.id}
                  className={`sb__item ${section === s.id ? "sb__item--active" : ""}`}
                  onClick={() => setSection(s.id)}
                  style={{ margin: 0 }}
                >
                  <Icn className="sb__icon" size={16} />
                  <div className="sb__label">{s.label}</div>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <div>
          {section === "users" && (
            <div className="col" style={{ gap: 16 }}>
              {/* Equipo de Vox (Cognito) — la gente que se loguea a la app +
                  el flujo de invitación. Es lo que un admin gestiona. */}
              <TeamManager />

              {/* Agentes de Amazon Connect (telefonía) — capa separada: los que
                  toman llamadas/chats. Acá solo se ven; se crean/gestionan en la
                  consola de Connect. La separación enseña el modelo de 2 capas. */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 18, marginTop: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>
                  Agentes de Amazon Connect · telefonía
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  Los que toman llamadas y chats. Se crean y gestionan en la consola de Amazon Connect.
                </div>
              </div>

              <div className="kpi-grid">
                <Kpi label="Usuarios totales" value={String(stats.total)} deltaDir="flat" />
                {/* Mantenemos el español puro para alinear con el resto
                    de la app. "Managers" → "Supervisores" para reflejar el
                    rol CallCenterManager del Connect security profile. */}
                <Kpi label="Administradores" value={String(stats.admins)} deltaDir="flat" />
                <Kpi label="Supervisores" value={String(stats.managers)} deltaDir="flat" />
                <Kpi label="Agentes" value={String(stats.agents)} deltaDir="flat" />
              </div>
              <div
                className="muted"
                style={{ fontSize: 11.5, marginTop: -4 }}
              >
                Un mismo usuario puede tener varios perfiles, por lo que la suma de
                Administradores/Supervisores/Agentes puede superar el total.
              </div>

              {error && (
                <div
                  style={{
                    padding: 12,
                    background: "var(--accent-red-soft)",
                    color: "var(--accent-red)",
                    borderRadius: 8,
                    fontSize: 12.5,
                  }}
                >
                  {error}
                </div>
              )}

              <Card>
                <CardHead
                  title="Usuarios de Amazon Connect"
                  right={
                    <button
                      className="btn btn--sm"
                      onClick={() =>
                        window.open(`${instanceUrl}/connect/users`, "_blank", "noopener")
                      }
                    >
                      Gestionar en Connect <Icon.ChevRight size={12} />
                    </button>
                  }
                />
                <CardBody flush>
                  {users.length === 0 && !loading ? (
                    <div
                      style={{
                        padding: 48,
                        textAlign: "center",
                        color: "var(--text-3)",
                        fontSize: 13,
                      }}
                    >
                      {error ? "No fue posible cargar usuarios." : "No hay usuarios."}
                    </div>
                  ) : (
                    <table className="t">
                      <thead>
                        <tr>
                          <th>Usuario</th>
                          <th>Nombre</th>
                          <th>Email</th>
                          {/* Inconsistencia: el resto de la app usa español;
                              "Security profiles" → "Perfiles de seguridad". */}
                          <th>Perfiles de seguridad</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.username}>
                            <td>
                              <div className="row">
                                <Avatar
                                  name={
                                    u.firstName || u.lastName
                                      ? `${u.firstName} ${u.lastName}`.trim()
                                      : u.username
                                  }
                                />
                                <span style={{ fontWeight: 500 }}>{u.username}</span>
                              </div>
                            </td>
                            <td className="col-muted">
                              {u.firstName || u.lastName
                                ? `${u.firstName} ${u.lastName}`.trim()
                                : "—"}
                            </td>
                            <td className="col-muted mono" style={{ fontSize: 11.5 }}>
                              {u.email || "—"}
                            </td>
                            <td>
                              <div
                                className="row"
                                style={{ flexWrap: "wrap", gap: 4, alignItems: "center" }}
                              >
                                {u.groups.map((p) => (
                                  <span
                                    key={p}
                                    className={`chip ${PROFILE_CHIP[p] || ""}`}
                                  >
                                    {p}
                                  </span>
                                ))}
                                {availableProfiles.length > 0 && (
                                  <button
                                    className="btn btn--sm"
                                    style={{ padding: "2px 8px", fontSize: 11, height: "auto" }}
                                    onClick={() => setEditingUser(u)}
                                  >
                                    Editar
                                  </button>
                                )}
                              </div>
                            </td>
                            <td>
                              <StatusPill status={u.enabled ? "Activo" : "Pausado"} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardBody>
              </Card>
              {editingUser && (
                <ConnectUserRoleModal
                  user={{
                    userId: editingUser.userId,
                    username: editingUser.username,
                    firstName: editingUser.firstName,
                    lastName: editingUser.lastName,
                    groupIds: editingUser.groupIds || [],
                  }}
                  available={availableProfiles}
                  onClose={() => setEditingUser(null)}
                  onSaved={() => fetchUsers()}
                />
              )}
            </div>
          )}

          {section === "tipificacion" && <TaxonomyEditor />}
          {section === "catalogos" && <CatalogEditor />}
          {section === "integrations" && <IntegrationsManager />}
          {section === "queues" && <QueuesPanel />}
          {section === "routing" && <RoutingRulesPanel />}
          {section === "security" && (
            <div className="col" style={{ gap: 16 }}>
              <PermissionsEditor />
              <AuditLogViewer />
            </div>
          )}

          {section !== "users" && section !== "tipificacion" && section !== "catalogos" && section !== "security" && section !== "integrations" && section !== "queues" && section !== "routing" && (
            <Card>
              <CardBody
                style={{
                  padding: 48,
                  textAlign: "center",
                  color: "var(--text-3)",
                }}
              >
                <Icon.Sparkles size={32} style={{ opacity: 0.4 }} />
                <div style={{ marginTop: 12, fontSize: 14 }}>
                  Próximamente · {sections.find((s) => s.id === section)?.label}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>
                  Por ahora gestiona esta sección desde la consola de Amazon Connect.
                </div>
                <button
                  className="btn btn--ghost btn--sm"
                  style={{ marginTop: 14 }}
                  onClick={() =>
                    window.open(
                      `${instanceUrl}/connect`,
                      "_blank",
                      "noopener"
                    )
                  }
                >
                  Abrir consola de Connect <Icon.ChevRight size={12} />
                </button>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
