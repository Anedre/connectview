import { useState } from "react";
import { MonitorControlBar } from "@/components/workspace/MonitorControlBar";
import type { MonitorSession } from "@/context/CCPContext";

/**
 * Smoke-test page for the supervisor MonitorControlBar. The real bar only
 * appears when a monitor contact is live on the CCP (needs a real call +
 * supervisor softphone), so this page drives it with local state to QA the
 * listen↔intervene toggle + leave, without any live call.
 */
export function MonitorDemoPage() {
  const [session, setSession] = useState<MonitorSession | null>({
    contactId: "demo-monitor-contact",
    mode: "SILENT_MONITOR",
    capabilities: ["SILENT_MONITOR", "BARGE"],
  });

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Monitor control bar · demo</h1>
      <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6, maxWidth: 620 }}>
        La barra flotante de abajo es el control del supervisor durante un
        monitoreo. En producción aparece sola cuando un contacto de monitoreo
        llega al CCP (headless). Acá la manejo con estado local para que veas
        el cambio <strong>Escuchar ↔ Intervenir</strong> (la barra se pone roja
        al intervenir) y el botón Salir.
      </p>
      {!session && (
        <button
          className="btn btn--primary"
          onClick={() =>
            setSession({
              contactId: "demo-monitor-contact",
              mode: "SILENT_MONITOR",
              capabilities: ["SILENT_MONITOR", "BARGE"],
            })
          }
        >
          Reiniciar demo
        </button>
      )}
      <MonitorControlBar
        sessionOverride={session}
        onSetMode={(mode) =>
          setSession((s) => (s ? { ...s, mode } : s))
        }
        onEnd={() => setSession(null)}
      />
    </div>
  );
}
