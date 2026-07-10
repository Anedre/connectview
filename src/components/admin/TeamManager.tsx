import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import * as Icon from "@/components/vox/primitives";
import { Avatar, Card, CardBody, CardHead, Kpi } from "@/components/vox/primitives";
import { ROLE_LABEL, type UserRole } from "@/types/auth";

/**
 * TeamManager — gestión del EQUIPO de Vox (usuarios de Cognito del tenant), la
 * gente que se loguea a la web app. Distinto de los agentes de Amazon Connect
 * (telefonía), que se gestionan en la consola de Connect.
 *
 * El Admin invita aquí: el backend (invite-user) crea el usuario en Cognito ya
 * atado a SU organización y le manda un email con contraseña temporal. Así el
 * invitado cae en la org del admin (no se le crea una nueva).
 */

interface TeamMember {
  sub: string;
  email: string;
  name: string; // nombre completo (lo pone el admin al invitar)
  role: string; // Agents | Supervisors | Admins
  status: string; // CONFIRMED | FORCE_CHANGE_PASSWORD | ...
  enabled: boolean;
  createdAt: string;
  assigned: string; // agente que el ADMIN asignó (pendiente de confirmar)
  connectUser: string; // agente CONFIRMADO por el login del propio agente
  isYou: boolean;
}

/** Estado del vínculo Vox↔Connect a partir de asignado + confirmado. */
function linkStatus(u: {
  assigned: string;
  connectUser: string;
}): { label: string; cls: string } | null {
  if (!u.assigned && !u.connectUser) return null; // sin asignar → no mostramos chip
  if (u.assigned && u.connectUser === u.assigned)
    return { label: "Confirmado", cls: "chip--green" };
  if (u.assigned && u.connectUser && u.connectUser !== u.assigned)
    return { label: `Entró como ${u.connectUser}`, cls: "chip--red" };
  return { label: "Pendiente · falta su login", cls: "chip--amber" };
}

interface ConnectAgent {
  username: string;
  userId: string;
}

const ROLE_CHIP: Record<string, string> = {
  Admins: "chip--red",
  Supervisors: "chip--cyan",
  Agents: "chip--green",
};

const ROLE_OPTIONS: { value: UserRole; label: string; hint: string }[] = [
  { value: "Agents", label: "Agente", hint: "Toma llamadas y chats, ve sus campañas." },
  { value: "Supervisors", label: "Supervisor", hint: "Monitorea agentes, ve reportes y colas." },
  { value: "Admins", label: "Admin", hint: "Acceso total: configuración, integraciones, equipo." },
];

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--border-1)",
  borderRadius: 8,
  background: "var(--bg-1)",
  color: "var(--text-1)",
};
const labelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  fontWeight: 600,
  marginBottom: 4,
  display: "block",
};
const menuItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 7,
  border: "none",
  background: "transparent",
  color: "var(--text-1)",
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
};

/** Modal de confirmación para ELIMINAR a un miembro del equipo. Eliminar borra la
 *  cuenta de Cognito (irreversible) — por eso pedimos confirmación explícita.
 *  Para un corte reversible el admin tiene "Desactivar" en el mismo menú. */
function ConfirmDeleteModal({
  member,
  busy,
  onCancel,
  onConfirm,
}: {
  member: TeamMember;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          padding: 24,
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <span
            aria-hidden
            style={{
              flex: "0 0 auto",
              display: "grid",
              placeItems: "center",
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "var(--accent-red-soft)",
              color: "var(--accent-red)",
            }}
          >
            <Icon.Trash size={18} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Eliminar del equipo</h2>
            <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>
              Vas a eliminar a <b>{member.name || member.email}</b>
              {member.name ? ` (${member.email})` : ""}. Perderá el acceso a ARIA y esta acción{" "}
              <b>no se puede deshacer</b>. Si solo quieres cortarle el acceso de forma temporal, usa{" "}
              <b>Desactivar</b> en su lugar.
            </p>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className="btn"
            onClick={onConfirm}
            disabled={busy}
            style={{
              background: "var(--accent-red)",
              color: "white",
              borderColor: "var(--accent-red)",
            }}
          >
            {busy ? (
              "Eliminando…"
            ) : (
              <>
                <Icon.Trash size={13} /> Sí, eliminar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Estado del usuario → etiqueta + clase de chip. Un invitado que todavía no
 *  entró queda en FORCE_CHANGE_PASSWORD = "Invitación pendiente". */
function statusChip(m: TeamMember): { label: string; cls: string } {
  if (!m.enabled) return { label: "Desactivado", cls: "" };
  if (m.status === "FORCE_CHANGE_PASSWORD")
    return { label: "Invitación pendiente", cls: "chip--amber" };
  if (m.status === "CONFIRMED") return { label: "Activo", cls: "chip--green" };
  return { label: m.status || "—", cls: "" };
}

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("Agents");
  const [sending, setSending] = useState(false);
  const ep = getApiEndpoints();

  const submit = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      toast.error("Ingresa un email válido");
      return;
    }
    if (!ep?.inviteUser) {
      toast.error("Backend de invitaciones no configurado");
      return;
    }
    setSending(true);
    try {
      const r = await authedFetch(ep.inviteUser, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e, role, name: name.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo invitar");
      toast.success(
        j.warning
          ? `Invitación enviada a ${e}. ${j.warning}`
          : `Invitación enviada a ${e} — le llegará un email con su contraseña temporal.`,
      );
      onInvited();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falló la invitación");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          padding: 24,
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Invitar a tu equipo</h2>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            <Icon.Close size={13} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>
          Le mandamos un email con una contraseña temporal. Al entrar, queda en
          <b> tu organización</b> con el rol que elijas.
        </p>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Nombre del trabajador</label>
          <input
            style={inputStyle}
            placeholder="Ej. Juan Pérez"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Email del trabajador</label>
          <input
            style={inputStyle}
            type="email"
            placeholder="nombre@tuempresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Rol</label>
          <div className="col" style={{ gap: 8 }}>
            {ROLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRole(opt.value)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: `1px solid ${role === opt.value ? "var(--accent-amber)" : "var(--border-1)"}`,
                  background: role === opt.value ? "var(--accent-amber-soft)" : "var(--bg-2)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flex: "0 0 auto",
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    marginTop: 1,
                    border: `5px solid ${role === opt.value ? "var(--accent-amber)" : "var(--border-2)"}`,
                    background: "var(--bg-1)",
                  }}
                />
                <span>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{opt.label}</span>
                  <span
                    style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginTop: 1 }}
                  >
                    {opt.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <button className="btn" onClick={onClose} disabled={sending}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={sending || !email.trim()}>
            {sending ? (
              "Enviando…"
            ) : (
              <>
                <Icon.Plus size={13} /> Enviar invitación
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeamManager() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const fetchTeam = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    const ep = getApiEndpoints();
    if (!ep?.listTeam) {
      setError("Backend de equipo no configurado");
      setLoading(false);
      return;
    }
    try {
      const r = await authedFetch(ep.listTeam);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setTeam(Array.isArray(j.team) ? j.team : []);
      setError(null);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Error cargando el equipo");
        setTeam([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);
  useRefetchOnFocus(useCallback(() => fetchTeam({ silent: true }), [fetchTeam]));

  // Agentes de Amazon Connect (telefonía) para el dropdown de vínculo (capa 2).
  const [connectAgents, setConnectAgents] = useState<ConnectAgent[]>([]);
  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.listUsers) return;
    (async () => {
      try {
        const r = await authedFetch(ep.listUsers);
        const j = await r.json();
        setConnectAgents(
          (j.users || [])
            .map((u: { username?: string; userId?: string }) => ({
              username: u.username || "",
              userId: u.userId || "",
            }))
            .filter((u: ConnectAgent) => u.username),
        );
      } catch {
        /* sin agentes → dropdown vacío, no es fatal */
      }
    })();
  }, []);

  /** Asigna (o quita, con connectUser="") el agente de Connect a un usuario de
   *  Vox. Optimista: refetch al terminar para reflejar el estado real. */
  const assignLink = useCallback(
    async (targetSub: string, connectUser: string) => {
      const ep = getApiEndpoints();
      if (!ep?.setConnectLink) {
        toast.error("Backend de vínculo no configurado");
        return;
      }
      try {
        const r = await authedFetch(ep.setConnectLink, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetSub, connectUser }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo asignar");
        toast.success(
          connectUser
            ? `Asignado a ${connectUser}. Falta que el agente lo confirme entrando a Connect con sus credenciales.`
            : "Asignación quitada",
        );
        fetchTeam({ silent: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falló el vínculo");
      }
    },
    [fetchTeam],
  );

  // Gestión de miembros (eliminar / desactivar / reactivar). Reusa el endpoint
  // inviteUser con `action`. `menuFor` = sub de la fila con el menú kebab abierto;
  // `confirmDelete` = miembro pendiente de confirmación de borrado (modal).
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TeamMember | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const memberAction = useCallback(
    async (email: string, action: "remove" | "disable" | "enable") => {
      const ep = getApiEndpoints();
      if (!ep?.inviteUser) {
        toast.error("Backend de equipo no configurado");
        return;
      }
      setBusyAction(true);
      try {
        const r = await authedFetch(ep.inviteUser, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, action }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo completar la acción");
        toast.success(
          action === "remove"
            ? "Usuario eliminado del equipo"
            : action === "disable"
              ? "Acceso desactivado"
              : "Acceso reactivado",
        );
        setMenuFor(null);
        setConfirmDelete(null);
        fetchTeam({ silent: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falló la acción");
      } finally {
        setBusyAction(false);
      }
    },
    [fetchTeam],
  );

  const stats = {
    total: team.length,
    admins: team.filter((u) => u.role === "Admins").length,
    supervisors: team.filter((u) => u.role === "Supervisors").length,
    agents: team.filter((u) => u.role === "Agents").length,
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="kpi-grid">
        <Kpi label="Usuarios de ARIA" value={String(stats.total)} deltaDir="flat" />
        <Kpi label="Administradores" value={String(stats.admins)} deltaDir="flat" />
        <Kpi label="Supervisores" value={String(stats.supervisors)} deltaDir="flat" />
        <Kpi label="Agentes" value={String(stats.agents)} deltaDir="flat" />
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
          title="Equipo de ARIA"
          sub="Las personas que se loguean a la app. Invita a tu equipo: les llega un email con su acceso."
          right={
            <button className="btn btn--primary btn--sm" onClick={() => setInviteOpen(true)}>
              <Icon.Plus size={12} /> Invitar usuario
            </button>
          }
        />
        <CardBody flush>
          {team.length === 0 && !loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              {error
                ? "No fue posible cargar el equipo."
                : "Todavía no invitaste a nadie. Toca “Invitar usuario” para empezar."}
            </div>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Agente de Connect</th>
                  <th>Estado</th>
                  <th style={{ width: 44 }} aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {team.map((u) => {
                  const st = statusChip(u);
                  return (
                    <tr key={u.sub}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <Avatar name={u.name || u.email || "?"} />
                          <div style={{ minWidth: 0 }}>
                            <div className="row" style={{ gap: 6 }}>
                              <span style={{ fontWeight: 500 }}>{u.name || u.email || "—"}</span>
                              {u.isYou && (
                                <span className="chip chip--violet" style={{ fontSize: 10 }}>
                                  Tú
                                </span>
                              )}
                            </div>
                            {u.name && (
                              <div className="muted" style={{ fontSize: 11 }}>
                                {u.email}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`chip ${ROLE_CHIP[u.role] || ""}`}>
                          {ROLE_LABEL[u.role as UserRole] || u.role}
                        </span>
                      </td>
                      <td>
                        <div className="col" style={{ gap: 5, alignItems: "flex-start" }}>
                          <select
                            value={u.assigned || ""}
                            onChange={(e) => assignLink(u.sub, e.target.value)}
                            title="Asignar el agente de Amazon Connect. Lo confirma el propio agente entrando a Connect con sus credenciales."
                            style={{
                              padding: "5px 8px",
                              fontSize: 12.5,
                              borderRadius: 7,
                              border: `1px solid ${u.assigned ? "var(--accent-cyan)" : "var(--border-1)"}`,
                              background: "var(--bg-1)",
                              color: u.assigned ? "var(--text-1)" : "var(--text-3)",
                              maxWidth: 180,
                            }}
                          >
                            <option value="">Sin asignar</option>
                            {/* Si el agente asignado ya no está en la lista (p.ej. borrado
                                en Connect), lo mostramos igual para no perder el valor. */}
                            {u.assigned &&
                              !connectAgents.some((a) => a.username === u.assigned) && (
                                <option value={u.assigned}>{u.assigned} (no listado)</option>
                              )}
                            {connectAgents.map((a) => (
                              <option key={a.userId || a.username} value={a.username}>
                                {a.username}
                              </option>
                            ))}
                          </select>
                          {(() => {
                            const ls = linkStatus(u);
                            return ls ? (
                              <span className={`chip ${ls.cls}`} style={{ fontSize: 10 }}>
                                <span className="dot" />
                                {ls.label}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </td>
                      <td>
                        <span className={`chip ${st.cls}`}>
                          <span className="dot" />
                          {st.label}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", position: "relative", overflow: "visible" }}>
                        {!u.isYou && (
                          <>
                            <button
                              className="btn btn--sm btn--ghost"
                              onClick={() => setMenuFor(menuFor === u.sub ? null : u.sub)}
                              title="Acciones"
                              aria-label="Acciones"
                            >
                              <Icon.More size={16} />
                            </button>
                            {menuFor === u.sub && (
                              <>
                                {/* overlay: click afuera cierra el menú */}
                                <div
                                  style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                  onClick={() => setMenuFor(null)}
                                />
                                <div
                                  role="menu"
                                  style={{
                                    position: "absolute",
                                    right: 8,
                                    top: "100%",
                                    zIndex: 41,
                                    background: "var(--bg-1)",
                                    border: "1px solid var(--border-1)",
                                    borderRadius: 10,
                                    boxShadow: "var(--shadow-pop)",
                                    minWidth: 190,
                                    padding: 6,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 2,
                                  }}
                                >
                                  <button
                                    onClick={() =>
                                      memberAction(u.email, u.enabled ? "disable" : "enable")
                                    }
                                    disabled={busyAction}
                                    style={menuItemStyle}
                                  >
                                    <Icon.Shield size={14} />
                                    {u.enabled ? "Desactivar acceso" : "Reactivar acceso"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setMenuFor(null);
                                      setConfirmDelete(u);
                                    }}
                                    disabled={busyAction}
                                    style={{ ...menuItemStyle, color: "var(--accent-red)" }}
                                  >
                                    <Icon.Trash size={14} /> Eliminar del equipo
                                  </button>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {inviteOpen && (
        <InviteModal onClose={() => setInviteOpen(false)} onInvited={() => fetchTeam()} />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          member={confirmDelete}
          busy={busyAction}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => memberAction(confirmDelete.email, "remove")}
        />
      )}
    </div>
  );
}
