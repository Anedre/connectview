import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChatsCircle, Stack } from "@phosphor-icons/react";
import { useNotifications } from "@/hooks/useNotifications";

/** Tiempo relativo corto para los avisos. */
function relTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

/**
 * NotificationsBell — campana + badge de NO vistos + popover con la lista.
 * Compartida por el top bar (`placement="down"`) y el dock del sidebar
 * (`placement="up"`). Al abrir marca todo como visto (limpia el badge) pero
 * resalta con un punto violeta los que eran nuevos en esta apertura.
 */
export function NotificationsBell({
  buttonClassName = "tb__ico",
  iconSize = 18,
  placement = "down",
}: {
  buttonClassName?: string;
  iconSize?: number;
  placement?: "down" | "up";
}) {
  const navigate = useNavigate();
  const { notifs, unseenCount, markAllSeen, isUnseen } = useNotifications();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Set<string>>(new Set());

  const toggle = () => {
    if (!open) {
      // Captura qué era nuevo (para el punto violeta) y limpia el badge.
      setSnapshot(new Set(notifs.filter((n) => isUnseen(n.callbackId)).map((n) => n.callbackId)));
      markAllSeen();
      setOpen(true);
    } else {
      setOpen(false);
    }
  };
  const close = () => setOpen(false);

  const up = placement === "up";
  const panelStyle: CSSProperties = {
    position: "absolute",
    width: 320,
    zIndex: 200,
    right: up ? "auto" : 0,
    left: up ? 0 : "auto",
    top: up ? "auto" : "calc(100% + 8px)",
    bottom: up ? "calc(100% + 10px)" : "auto",
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={buttonClassName}
        title="Notificaciones"
        aria-expanded={open}
        aria-label={unseenCount > 0 ? `Notificaciones (${unseenCount} sin ver)` : "Notificaciones"}
        onClick={toggle}
        style={{ position: "relative" }}
      >
        <Bell size={iconSize} />
        {unseenCount > 0 && (
          <span className="aria-notif-badge">{unseenCount > 9 ? "9+" : unseenCount}</span>
        )}
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 199 }} />
          <div className="tbx__menu aria-notif-panel" style={panelStyle}>
            <div className="tbx__menu-head">Notificaciones</div>
            {notifs.length === 0 ? (
              <div style={{ padding: "26px 20px", textAlign: "center" }}>
                <Bell size={24} style={{ color: "var(--text-3)", opacity: 0.5 }} />
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: "var(--text-1)",
                  }}
                >
                  Estás al día
                </div>
                <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-3)" }}>
                  No hay notificaciones nuevas.
                </div>
              </div>
            ) : (
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {notifs.map((n) => {
                  const isNew = snapshot.has(n.callbackId);
                  return (
                    <div key={n.callbackId} className="aria-notif-item">
                      <span
                        className="aria-notif-dot"
                        style={{
                          background: isNew ? "var(--accent-violet)" : "var(--border-2)",
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, color: "var(--text-1)", lineHeight: 1.4 }}>
                          {n.notes || "Notificación"}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>
                          {n.customerName ? `${n.customerName} · ` : ""}
                          {relTime(n.createdAt || n.scheduledAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                padding: 10,
                borderTop: "1px solid var(--border-1)",
              }}
            >
              <button
                className="btn btn--ghost btn--sm"
                style={{ flex: 1 }}
                onClick={() => {
                  close();
                  navigate("/inbox");
                }}
              >
                <ChatsCircle size={15} /> Conversaciones
              </button>
              <button
                className="btn btn--ghost btn--sm"
                style={{ flex: 1 }}
                onClick={() => {
                  close();
                  navigate("/queue");
                }}
              >
                <Stack size={15} /> Cola en vivo
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
