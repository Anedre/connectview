import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { Avatar, Card, CardBody, CardHead, StatusPill } from "@/components/vox/primitives";
import { TaxonomyEditor } from "@/components/admin/TaxonomyEditor";
import { CatalogEditor } from "@/components/admin/CatalogEditor";
import { KnowledgeEditor } from "@/components/admin/KnowledgeEditor";
import { ChannelsManager } from "@/components/admin/ChannelsManager";
import { WhatsAppTemplatesManager } from "@/components/admin/WhatsAppTemplatesManager";
import { SuppressionManager } from "@/components/admin/SuppressionManager";
import { SegmentsManager } from "@/components/admin/SegmentsManager";
import { AiContactLensManager } from "@/components/admin/AiContactLensManager";
import { SecurityManager } from "@/components/admin/SecurityManager";
import { IntegrationsManager } from "@/components/admin/IntegrationsManager";
import { ConsumptionManager } from "@/components/admin/ConsumptionManager";
import { QueuesPanel } from "@/components/admin/QueuesPanel";
import { TeamManager } from "@/components/admin/TeamManager";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { ConnectUserRoleModal } from "@/components/admin/ConnectUserRoleModal";
import { Icon, Btn, Stat, HeroBand, Num } from "@/components/aria";
import type { IconName } from "@/components/aria";

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
  const [availableProfiles, setAvailableProfiles] = useState<{ id: string; name: string }[]>([]);
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

  const sections: { id: string; label: string; icon: IconName }[] = [
    { id: "users", label: "Usuarios y roles", icon: "users" },
    { id: "tipificacion", label: "Tipificación", icon: "tag" },
    { id: "catalogos", label: "Catálogos", icon: "layers" },
    { id: "knowledge", label: "Base de conocimiento", icon: "book" },
    { id: "channels", label: "Canales", icon: "globe" },
    { id: "watemplates", label: "Plantillas WhatsApp", icon: "wa" },
    { id: "suppression", label: "Supresión", icon: "shield" },
    { id: "segments", label: "Segmentos", icon: "filter" },
    { id: "queues", label: "Colas", icon: "layers" },
    { id: "integrations", label: "Integraciones", icon: "external" },
    { id: "consumo", label: "Consumo", icon: "chart" },
    { id: "ai", label: "IA y Contact Lens", icon: "sparkle" },
    { id: "security", label: "Seguridad", icon: "lock" },
  ];

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      {/* ARIA hero band — reemplaza el PageHeader por el lenguaje premium de
          ARIA. La navegación master-detail de settings vive intacta debajo. */}
      <HeroBand
        title="Configuración"
        chip={<>Sistema · Usuarios de Connect · {stats.total} en total</>}
        chipIcon="settings"
        chipTone="var(--iris)"
        right={
          <div className="row gap10">
            <Btn
              variant="ghost"
              size="sm"
              icon="external"
              disabled={!instanceUrl}
              onClick={() => instanceUrl && window.open(`${instanceUrl}/connect/users`, "_blank")}
            >
              Abrir en Connect
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              icon="refresh"
              onClick={() => fetchUsers()}
              disabled={loading}
            >
              Actualizar
            </Btn>
          </div>
        }
      />

      {/* Master-detail ARIA (.setg) — nav a la izquierda, contenido real a la
          derecha. Cada panel manage-* se renderiza sin tocar su interior. */}
      <div className="setg">
        <div className="setg__nav">
          {sections.map((s) => (
            <button
              key={s.id}
              className={"setg__item" + (section === s.id ? " setg__item--on" : "")}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={16} />
              {s.label}
            </button>
          ))}
        </div>

        <div className="setg__body">
          {section === "users" && (
            <div className="col" style={{ gap: 16 }}>
              {/* Equipo de Vox (Cognito) — la gente que se loguea a la app +
                  el flujo de invitación. Es lo que un admin gestiona. */}
              <TeamManager />

              {/* Agentes de Amazon Connect (telefonía) — capa separada: los que
                  toman llamadas/chats. Aquí solo se ven; se crean/gestionan en la
                  consola de Connect. La separación enseña el modelo de 2 capas. */}
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 18, marginTop: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>
                  Agentes de Amazon Connect · telefonía
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  Los que toman llamadas y chats. Se crean y gestionan en la consola de Amazon
                  Connect.
                </div>
              </div>

              <div
                className="grid"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}
              >
                <Stat
                  icon="users"
                  color="var(--accent)"
                  label="Usuarios totales"
                  value={<Num value={stats.total} />}
                  sub="en Amazon Connect"
                />
                {/* Mantenemos el español puro para alinear con el resto
                    de la app. "Managers" → "Supervisores" para reflejar el
                    rol CallCenterManager del Connect security profile. */}
                <Stat
                  icon="shield"
                  color="var(--coral)"
                  label="Administradores"
                  value={<Num value={stats.admins} />}
                  sub="perfil Admin"
                />
                <Stat
                  icon="headset"
                  color="var(--cyan)"
                  label="Supervisores"
                  value={<Num value={stats.managers} />}
                  sub="CallCenterManager"
                />
                <Stat
                  icon="phone"
                  color="var(--green)"
                  label="Agentes"
                  value={<Num value={stats.agents} />}
                  sub="perfil Agent"
                />
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: -4 }}>
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
                      disabled={!instanceUrl}
                      onClick={() =>
                        instanceUrl &&
                        window.open(`${instanceUrl}/connect/users`, "_blank", "noopener")
                      }
                    >
                      Gestionar en Connect <Icon name="arrowRight" size={12} />
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
                                  <span key={p} className={`chip ${PROFILE_CHIP[p] || ""}`}>
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
          {section === "knowledge" && <KnowledgeEditor />}
          {section === "channels" && <ChannelsManager />}
          {section === "watemplates" && <WhatsAppTemplatesManager />}
          {section === "suppression" && <SuppressionManager />}
          {section === "segments" && <SegmentsManager />}
          {section === "integrations" && <IntegrationsManager />}
          {section === "consumo" && <ConsumptionManager />}
          {section === "queues" && <QueuesPanel />}
          {section === "ai" && <AiContactLensManager />}
          {section === "security" && <SecurityManager />}

          {section !== "users" &&
            section !== "segments" &&
            section !== "tipificacion" &&
            section !== "catalogos" &&
            section !== "knowledge" &&
            section !== "channels" &&
            section !== "watemplates" &&
            section !== "suppression" &&
            section !== "security" &&
            section !== "integrations" &&
            section !== "consumo" &&
            section !== "queues" &&
            section !== "ai" && (
              <Card>
                <CardBody
                  style={{
                    padding: 48,
                    textAlign: "center",
                    color: "var(--text-3)",
                  }}
                >
                  <Icon name="sparkle" size={32} style={{ opacity: 0.4 }} />
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
                      instanceUrl && window.open(`${instanceUrl}/connect`, "_blank", "noopener")
                    }
                  >
                    Abrir consola de Connect <Icon name="arrowRight" size={12} />
                  </button>
                </CardBody>
              </Card>
            )}
        </div>
      </div>
    </div>
  );
}
