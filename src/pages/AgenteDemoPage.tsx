import { AgentDayHero } from "@/components/dashboard/AgentDayHero";

/**
 * /agente-demo — preview sin auth del Inicio del AGENTE premium (AgentDayHero
 * con la familia ExecStat: count-up + sparkline). DEV only (gated en App.tsx).
 * Data mock — el Inicio real está tras Cognito + el rol Agents.
 */
export function AgenteDemoPage() {
  return (
    <div style={{ height: "100vh", overflow: "auto", background: "var(--bg-0)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Inicio del agente · preview (mock)
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 4px", color: "var(--text-1)" }}>
          Hola, Andrea
        </h1>
        <div className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          Sin contactos en cola · todo tranquilo por ahora.
        </div>
        <AgentDayHero
          atendidos={23}
          ahtSec={185}
          sentimentPosPct={78}
          enCola={4}
          attendedSpark={[2, 4, 3, 6, 5, 8, 7, 11, 9, 12, 10, 15]}
        />
      </div>
    </div>
  );
}
