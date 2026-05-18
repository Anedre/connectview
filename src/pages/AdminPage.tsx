import { useState, useEffect, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";
import {
  Avatar,
  Card,
  CardBody,
  CardHead,
  Kpi,
  StatusPill,
} from "@/components/vox/primitives";

interface ConnectUser {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  enabled: boolean;
  created: string;
  groups: string[];
}

const PROFILE_CHIP: Record<string, string> = {
  Admin: "chip--red",
  CallCenterManager: "chip--cyan",
  QualityAnalyst: "chip--violet",
  Agent: "chip--green",
};

export function AdminPage() {
  const [users, setUsers] = useState<ConnectUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState("users");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoints = getApiEndpoints();
      if (endpoints?.listUsers) {
        const response = await fetch(endpoints.listUsers);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setUsers(data.users || []);
      } else {
        throw new Error("API no configurada");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando usuarios");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const stats = {
    total: users.length,
    admins: users.filter((u) => u.groups.includes("Admin")).length,
    managers: users.filter((u) => u.groups.includes("CallCenterManager")).length,
    agents: users.filter((u) => u.groups.includes("Agent")).length,
  };

  const sections = [
    { id: "users", label: "Usuarios y roles", icon: Icon.Users },
    { id: "channels", label: "Canales", icon: Icon.Globe },
    { id: "queues", label: "Colas", icon: Icon.Queue },
    { id: "integrations", label: "Integraciones", icon: Icon.Lightning },
    { id: "ai", label: "IA y Contact Lens", icon: Icon.Sparkles },
    { id: "security", label: "Seguridad", icon: Icon.Shield },
  ];

  return (
    <div className="view" style={{ maxWidth: 1500 }}>
      <div className="view__head">
        <div>
          <div className="view__crumb">
            <span>Sistema</span>
          </div>
          <h1 className="view__title">Configuración</h1>
          <div className="view__sub">
            Workspace · Connect users · {stats.total} usuarios totales
          </div>
        </div>
        <div className="view__actions">
          <button
            className="btn"
            onClick={() =>
              window.open("https://novasys.my.connect.aws/connect/users", "_blank")
            }
          >
            Abrir en Connect
          </button>
          <button className="btn" onClick={fetchUsers} disabled={loading}>
            <Icon.Refresh size={14} /> Actualizar
          </button>
        </div>
      </div>

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
              <div className="kpi-grid">
                <Kpi label="Usuarios totales" value={String(stats.total)} delta="—" deltaDir="flat" />
                <Kpi label="Admins" value={String(stats.admins)} delta="—" deltaDir="flat" />
                <Kpi label="Managers" value={String(stats.managers)} delta="—" deltaDir="flat" />
                <Kpi label="Agentes" value={String(stats.agents)} delta="—" deltaDir="flat" />
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
                    <button className="btn btn--primary btn--sm">
                      <Icon.Plus size={12} /> Invitar usuario
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
                          <th>Security profiles</th>
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
                              <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                                {u.groups.map((p) => (
                                  <span
                                    key={p}
                                    className={`chip ${PROFILE_CHIP[p] || ""}`}
                                  >
                                    {p}
                                  </span>
                                ))}
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
            </div>
          )}

          {section !== "users" && (
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
                  Sección en construcción · {sections.find((s) => s.id === section)?.label}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>
                  Disponible cuando se conecte con la consola de Amazon Connect.
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
