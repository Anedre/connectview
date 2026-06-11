import { Headphones, Timer, Smile, Users } from "lucide-react";
import { ExecStat } from "@/components/dashboard/exec/ExecStat";
import { formatDurationSec } from "@/lib/utils";
import "@/styles/exec.css";

/**
 * AgentDayHero — el cockpit personal del agente en el Inicio, con la MISMA
 * familia visual premium que la vista ejecutiva (tiles ExecStat: count-up,
 * sparkline, hover-lift). Reemplaza las KPI cards viejas (strings) por tiles
 * numéricos. "Mi día" (atendidos / AHT / sentiment) + el contexto del equipo
 * (cola). Presentacional: recibe todo por props (testeable / demoable).
 */

export interface AgentDayHeroProps {
  /** Contactos que el agente cerró hoy. */
  atendidos: number;
  /** AHT promedio del agente (seg). */
  ahtSec: number;
  /** % de sus contactos con sentiment positivo. */
  sentimentPosPct: number;
  /** Contexto del equipo: contactos en cola ahora. */
  enCola: number;
  /** Sparkline opcional de atendidos por hora/día. */
  attendedSpark?: number[];
  loading?: boolean;
}

export function AgentDayHero({
  atendidos,
  ahtSec,
  sentimentPosPct,
  enCola,
  attendedSpark,
  loading,
}: AgentDayHeroProps) {
  if (loading) {
    return (
      <div
        className="exec-vars"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="exec-skel" style={{ height: 116, borderRadius: 14 }} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="exec-vars"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}
    >
      <ExecStat
        index={0}
        period="agent"
        label="Atendidos hoy"
        icon={Headphones}
        accent="#25B873"
        value={atendidos}
        note={atendidos === 0 ? "sin actividad registrada hoy" : "contactos que cerraste"}
        spark={attendedSpark && attendedSpark.length > 1 ? attendedSpark : undefined}
        sparkColor="#25B873"
      />
      <ExecStat
        index={1}
        period="agent"
        label="AHT promedio"
        icon={Timer}
        accent="#F5A524"
        value={ahtSec}
        formatter={(n) => (n ? formatDurationSec(Math.round(n)) : "—")}
        note="tu tiempo medio de manejo"
      />
      <ExecStat
        index={2}
        period="agent"
        label="Sentiment positivo"
        icon={Smile}
        accent="#9B8CF0"
        value={sentimentPosPct}
        unit="%"
        note="de tus contactos analizados"
      />
      <ExecStat
        index={3}
        period="agent"
        label="En cola ahora"
        icon={Users}
        accent="#2BC6E6"
        value={enCola}
        note={enCola === 0 ? "todo tranquilo por ahora" : "contactos esperando al equipo"}
      />
    </div>
  );
}
