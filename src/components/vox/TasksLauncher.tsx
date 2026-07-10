import { useState } from "react";
import { ListTodo, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCallbacks } from "@/hooks/useCallbacks";
import { FollowupRow } from "@/components/workspace/CallbackHistoryDrawer";
import { ScheduleCallbackModal } from "@/components/workspace/ScheduleCallbackModal";

/**
 * TasksLauncher — el ÚNICO punto de entrada a las Tareas del agente. Un pill
 * flotante "Tasks" debajo del de Copilot (borde derecho, global en toda la app)
 * que abre un panel con las tareas pendientes y un botón para crear una nueva.
 *
 * Una "tarea" es un row de `connectview-callbacks`: puede ser una tarea simple
 * (channel=task, sin auto-dispatch) o agendar una llamada/email/WhatsApp — todo
 * vive aquí. Reemplaza al bubble flotante `CallbackHistoryDrawer` y absorbe el
 * follow-up dentro de "Tasks". Reusa `FollowupRow` (lista) y
 * `ScheduleCallbackModal` (crear, ahora con canal "Tarea").
 */
export function TasksLauncher() {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { user } = useAuth();
  const { callbacks, loading, error, refetch, cancel, complete, available } = useCallbacks({
    status: "PENDING",
    pollIntervalSec: 60,
  });

  const count = callbacks.length;
  const dueNow = callbacks.filter((c) => c.status === "DUE").length;

  // Sin endpoint desplegado no hay nada que mostrar ni crear.
  if (!available) return null;

  // ── Launcher colapsado — pill ámbar debajo del de Copilot (violeta) ──
  if (!open) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          title="Tareas"
          style={{
            position: "fixed",
            right: 0,
            top: "calc(50% + 58px)",
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "12px 7px",
            border: "none",
            borderRadius: "12px 0 0 12px",
            background: "linear-gradient(160deg, #E0A82E, #B8761A)",
            color: "#fff",
            cursor: "pointer",
            boxShadow: "-4px 0 16px -4px rgba(184,118,26,0.55)",
            writingMode: "vertical-rl",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.4,
          }}
        >
          <ListTodo size={15} style={{ writingMode: "horizontal-tb" }} />
          Tasks
          {count > 0 && (
            <span
              style={{
                writingMode: "horizontal-tb",
                fontSize: 10,
                fontWeight: 800,
                background: dueNow > 0 ? "#E5484D" : "rgba(255,255,255,0.28)",
                borderRadius: 999,
                padding: "1px 6px",
                minWidth: 16,
                textAlign: "center",
              }}
            >
              {count}
            </span>
          )}
        </button>
        <ScheduleCallbackModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          phone={null}
          customerName={null}
          assignedAgentUserId={user?.userId || ""}
          defaultChannel="task"
          onScheduled={() => refetch()}
        />
      </>
    );
  }

  // ── Panel abierto ──
  return (
    <>
      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          top: 72,
          width: 360,
          maxWidth: "calc(100vw - 32px)",
          zIndex: 60,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
          overflow: "hidden",
          fontFamily: "var(--font-ui)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "12px 14px",
            background: "linear-gradient(135deg, rgba(224,168,46,0.16), transparent)",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 26,
              height: 26,
              borderRadius: 8,
              background: "linear-gradient(150deg, #E0A82E, #B8761A)",
              color: "#fff",
            }}
          >
            <ListTodo size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Tareas</div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
              {count === 0
                ? "Sin pendientes"
                : `${count} pendiente${count === 1 ? "" : "s"}${
                    dueNow > 0 ? ` · ${dueNow} ahora` : ""
                  }`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="btn btn--sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <Plus size={13} /> Crear
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Cerrar"
            aria-label="Cerrar"
            className="btn btn--ghost btn--sm btn--icon"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body — lista de pendientes */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {loading && count === 0 && (
            <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: 16 }}>
              Cargando…
            </div>
          )}
          {error && (
            <div
              style={{
                fontSize: 12,
                color: "var(--accent-red)",
                padding: "8px 10px",
                background: "var(--accent-red-soft)",
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
          {!loading && count === 0 && !error && (
            <div
              style={{
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 12.5,
                padding: "28px 12px",
                lineHeight: 1.6,
              }}
            >
              <ListTodo size={30} style={{ opacity: 0.4 }} />
              <div style={{ marginTop: 10 }}>No tienes tareas pendientes.</div>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="btn btn--sm"
                style={{
                  marginTop: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Plus size={13} /> Crear tarea
              </button>
            </div>
          )}
          {callbacks.map((c) => (
            <FollowupRow
              key={c.callbackId}
              record={c}
              onCancel={async () => {
                try {
                  await cancel(c.callbackId);
                  toast.success("Tarea cancelada");
                  refetch();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "No se pudo cancelar");
                }
              }}
              onComplete={async () => {
                try {
                  await complete(c.callbackId);
                  toast.success("Tarea completada");
                  refetch();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "No se pudo completar");
                }
              }}
            />
          ))}
        </div>
      </div>

      <ScheduleCallbackModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        phone={null}
        customerName={null}
        assignedAgentUserId={user?.userId || ""}
        defaultChannel="task"
        onScheduled={() => refetch()}
      />
    </>
  );
}
