import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import * as Icon from "@/components/vox/primitives";
import { Avatar, Card, CardBody, CardHead, Kpi } from "@/components/vox/primitives";
import { ROLE_LABEL, type UserRole } from "@/types/auth";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      className="max-w-md"
      footer={
        <>
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
        </>
      }
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
    </Modal>
  );
}

/** Estado del usuario → etiqueta + clase de chip. Un invitado que todavía no
 *  entró queda en FORCE_CHANGE_PASSWORD = "Invitación pendiente". */
function statusChip(m: TeamMember): { label: string; cls: string } {
  if (!m.enabled) return { label: "Desactivado", cls: "" };
  if (m.status === "FORCE_CHANGE_PASSWORD")
    return { label: "Invitación pendiente", cls: "chip--amber" };
  if (m.status === "RESET_REQUIRED") return { label: "Requiere reset", cls: "chip--amber" };
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
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Invitar a tu equipo"
      className="max-w-md"
      footer={
        <>
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
        </>
      }
    >
      <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>
        Le mandamos un email con una contraseña temporal. Al entrar, queda en
        <b> tu organización</b> con el rol que elijas.
      </p>

      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Nombre del trabajador</label>
        <Input
          placeholder="Ej. Juan Pérez"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Email del trabajador</label>
        <Input
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
    </Modal>
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
    async (email: string, action: "remove" | "disable" | "enable" | "resend") => {
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
              : action === "enable"
                ? "Acceso reactivado"
                : `Le reenviamos el acceso a ${email}. Le llega un correo para volver a entrar.`,
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

  /** Cambia el rol de un miembro existente (Agente/Supervisor/Admin) vía setRole.
   *  Optimista: refleja el nuevo rol de una y revierte si el backend falla. El rol
   *  viaja en el idToken → el afectado debe reingresar para verlo aplicado. */
  const changeRole = useCallback(
    async (u: TeamMember, role: UserRole) => {
      if (role === u.role) return;
      const ep = getApiEndpoints();
      if (!ep?.inviteUser) {
        toast.error("Backend de equipo no configurado");
        return;
      }
      const prev = u.role;
      setTeam((t) => t.map((m) => (m.sub === u.sub ? { ...m, role } : m)));
      try {
        const r = await authedFetch(ep.inviteUser, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: u.email, action: "setRole", role }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo cambiar el rol");
        toast.success(
          `${u.name || u.email} ahora es ${ROLE_LABEL[role]}. Debe cerrar sesión y volver a entrar para que el cambio tome efecto.`,
        );
        fetchTeam({ silent: true });
      } catch (err) {
        setTeam((t) => t.map((m) => (m.sub === u.sub ? { ...m, role: prev } : m)));
        toast.error(err instanceof Error ? err.message : "Falló el cambio de rol");
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
                        {u.isYou ? (
                          // Tu propia fila: chip fijo. No puedes cambiar tu propio
                          // rol (el backend lo bloquea para evitar auto-lockout).
                          <span className={`chip ${ROLE_CHIP[u.role] || ""}`}>
                            {ROLE_LABEL[u.role as UserRole] || u.role}
                          </span>
                        ) : (
                          <Select
                            value={u.role}
                            onValueChange={(v) => v && changeRole(u, v as UserRole)}
                          >
                            <SelectTrigger
                              title="Cambiar el rol de este usuario. El cambio aplica cuando vuelva a iniciar sesión."
                              style={{ maxWidth: 150 }}
                            >
                              <SelectValue>{ROLE_LABEL[u.role as UserRole] || u.role}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td>
                        <div className="col" style={{ gap: 5, alignItems: "flex-start" }}>
                          <Select
                            value={u.assigned || "__none__"}
                            onValueChange={(v) =>
                              assignLink(u.sub, v === "__none__" ? "" : (v ?? ""))
                            }
                          >
                            <SelectTrigger
                              title="Asignar el agente de Amazon Connect. Lo confirma el propio agente entrando a Connect con sus credenciales."
                              style={{ maxWidth: 180 }}
                            >
                              <SelectValue>
                                {u.assigned
                                  ? connectAgents.some((a) => a.username === u.assigned)
                                    ? u.assigned
                                    : `${u.assigned} (no listado)`
                                  : "Sin asignar"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Sin asignar</SelectItem>
                              {/* Si el agente asignado ya no está en la lista (p.ej. borrado
                                  en Connect), lo mostramos igual para no perder el valor. */}
                              {u.assigned &&
                                !connectAgents.some((a) => a.username === u.assigned) && (
                                  <SelectItem value={u.assigned}>
                                    {u.assigned} (no listado)
                                  </SelectItem>
                                )}
                              {connectAgents.map((a) => (
                                <SelectItem key={a.userId || a.username} value={a.username}>
                                  {a.username}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                                    onClick={() => memberAction(u.email, "resend")}
                                    disabled={busyAction}
                                    style={menuItemStyle}
                                    title="Reenvía un correo para entrar: nueva contraseña temporal si la invitación caducó, o un código de restablecimiento si ya tenía cuenta."
                                  >
                                    <Icon.Mail size={14} /> Reenviar acceso
                                  </button>
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
