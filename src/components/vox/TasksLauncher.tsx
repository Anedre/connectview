import { useEffect, useState } from "react";
import { ListTodo, X, Plus } from "lucide-react";
import { useEscapeKey } from "@/hooks/useDropdown";
import { COPILOT_ACTION_EVENT } from "@/lib/copilotActions";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCallbacks } from "@/hooks/useCallbacks";
import { FollowupRow } from "@/components/workspace/CallbackHistoryDrawer";
import { ScheduleCallbackModal } from "@/components/workspace/ScheduleCallbackModal";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";

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
  // Escape cierra el panel (salvo que esté abierto el modal de crear tarea).
  useEscapeKey(() => setOpen(false), open && !createOpen);

  // El Copilot puede pedir "crear tarea" (marcador [[do|…|task.new]]) → abre el modal.
  useEffect(() => {
    const onAction = (e: Event) => {
      if ((e as CustomEvent<{ id?: string }>).detail?.id === "task.new") {
        setOpen(true);
        setCreateOpen(true);
      }
    };
    window.addEventListener(COPILOT_ACTION_EVENT, onAction);
    return () => window.removeEventListener(COPILOT_ACTION_EVENT, onAction);
  }, []);

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

  // Agrupar por tiempo: Vencidas (pasó su hora o estado DUE), Hoy (resto del
  // día) y Próximas (días futuros). Convierte la lista plana en bandeja de trabajo.
  // eslint-disable-next-line react-hooks/purity -- hora actual para bucketizar por tiempo; recomputar por render es intencional y benigno
  const now = Date.now();
  const isToday = (t: number) => {
    const d = new Date(t);
    const n = new Date(now);
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    );
  };
  const buckets: {
    key: string;
    label: string;
    tone: string;
    items: typeof callbacks;
  }[] = [
    { key: "overdue", label: "Vencidas", tone: "var(--accent-red)", items: [] },
    { key: "today", label: "Hoy", tone: "var(--accent-amber)", items: [] },
    { key: "upcoming", label: "Próximas", tone: "var(--text-3)", items: [] },
  ];
  for (const c of callbacks) {
    const t = new Date(c.scheduledAt).getTime();
    const overdue = c.status === "DUE" || (Number.isFinite(t) && t < now);
    const b = overdue ? buckets[0] : Number.isFinite(t) && isToday(t) ? buckets[1] : buckets[2];
    b.items.push(c);
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
          {loading && count === 0 ? (
            <SkeletonList rows={4} />
          ) : error ? (
            <ErrorState description={error} onRetry={refetch} />
          ) : count === 0 ? (
            <EmptyState
              icon={<ListTodo />}
              title="No tienes tareas pendientes"
              description="Crea una para recordar un seguimiento, una llamada o un correo."
              action={
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="btn btn--sm"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <Plus size={13} /> Crear tarea
                </button>
              }
            />
          ) : (
            buckets.map((b) =>
              b.items.length === 0 ? null : (
                <div key={b.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10.5,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                      color: b.tone,
                      margin: "2px 0",
                    }}
                  >
                    <span
                      style={{ width: 6, height: 6, borderRadius: "50%", background: b.tone }}
                    />
                    {b.label} · {b.items.length}
                  </div>
                  {b.items.map((c) => (
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
              ),
            )
          )}
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
