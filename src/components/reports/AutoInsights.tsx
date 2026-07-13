import { useMemo } from "react";
import { TrendingUp, TrendingDown, AlertTriangle, Sparkles, Award, Clock } from "lucide-react";
import type { ContactRecord } from "@/types/monitoring";
import { formatDurationSec } from "@/lib/utils";

/**
 * AutoInsights — detección automática de patrones/anomalías del período, narrados
 * en lenguaje natural y accionables. Todo client-side sobre los contactos ya
 * cargados: días pico, agentes destacados o en riesgo por sentimiento, AHT
 * elevado, contactos sin atender, canal dominante. Es la capa "explicativa" que
 * complementa los charts: en vez de que el supervisor lea 4 gráficos, le decimos
 * qué mirar.
 */

type Tone = "pos" | "warn" | "info";
interface Insight {
  tone: Tone;
  icon: "up" | "down" | "warn" | "award" | "clock" | "spark";
  text: string;
  weight: number;
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const looksUuid = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s);

function computeInsights(
  contacts: ContactRecord[],
  resolveName?: (id: string) => string,
): Insight[] {
  const out: Insight[] = [];
  const total = contacts.length;
  if (total === 0) return out;

  const nameOf = (id: string) => {
    const n = resolveName?.(id);
    if (n && !looksUuid(n)) return n;
    return looksUuid(id) || !id ? "un agente" : id;
  };

  // ── Sentimiento por agente (min 5 contactos analizados) ──
  const byAgent = new Map<
    string,
    { total: number; pos: number; neg: number; durSum: number; durN: number }
  >();
  const byDay = new Map<string, number>();
  let missed = 0;
  let negTotal = 0;
  let posTotal = 0;
  const byChannel = new Map<string, number>();

  for (const c of contacts) {
    const a = c.agentUsername || "";
    if (!byAgent.has(a)) byAgent.set(a, { total: 0, pos: 0, neg: 0, durSum: 0, durN: 0 });
    const rec = byAgent.get(a)!;
    rec.total++;
    const s = (c.sentiment || "").toUpperCase();
    if (s === "POSITIVE") {
      rec.pos++;
      posTotal++;
    } else if (s === "NEGATIVE") {
      rec.neg++;
      negTotal++;
    }
    if (typeof c.duration === "number" && c.duration > 0) {
      rec.durSum += c.duration;
      rec.durN++;
    } else if (c.duration === 0) {
      missed++;
    }
    const d = new Date(c.initiationTimestamp);
    if (!Number.isNaN(d.getTime())) {
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      byDay.set(k, (byDay.get(k) || 0) + 1);
    }
    const ch = (c.channel || "").toUpperCase();
    byChannel.set(ch, (byChannel.get(ch) || 0) + 1);
  }

  // Día pico
  let peakDay = "";
  let peakN = 0;
  for (const [k, n] of byDay) {
    if (n > peakN) {
      peakN = n;
      peakDay = k;
    }
  }
  if (peakDay && byDay.size > 1) {
    const [, m, day] = peakDay.split("-").map(Number);
    out.push({
      tone: "info",
      icon: "up",
      text: `El día más movido fue el ${day} de ${MES[m]} con ${peakN} contactos (${Math.round((peakN / total) * 100)}% del período).`,
      weight: 30,
    });
  }

  // Agente destacado por sentimiento positivo (min 5)
  const agents = [...byAgent.entries()].filter(([a, r]) => a && r.total >= 5);
  if (agents.length > 1) {
    const posRate = (r: { pos: number; total: number }) => r.pos / r.total;
    const best = agents.slice().sort((a, b) => posRate(b[1]) - posRate(a[1]))[0];
    if (posRate(best[1]) >= 0.5) {
      out.push({
        tone: "pos",
        icon: "award",
        text: `${nameOf(best[0])} lidera en sentimiento: ${Math.round(posRate(best[1]) * 100)}% de sus ${best[1].total} contactos fueron positivos.`,
        weight: 55,
      });
    }
    // Agente en riesgo (más negativos que el promedio, y ≥25%)
    const avgNeg = negTotal / total;
    const worst = agents.slice().sort((a, b) => b[1].neg / b[1].total - a[1].neg / a[1].total)[0];
    const worstRate = worst[1].neg / worst[1].total;
    if (worstRate >= 0.25 && worstRate > avgNeg * 1.5) {
      out.push({
        tone: "warn",
        icon: "warn",
        text: `${nameOf(worst[0])} acumula ${Math.round(worstRate * 100)}% de contactos negativos (${worst[1].neg}/${worst[1].total}), muy por encima del promedio — vale una escucha.`,
        weight: 70,
      });
    }
    // AHT elevado
    const withDur = agents.filter(([, r]) => r.durN >= 3);
    if (withDur.length > 1) {
      const aht = (r: { durSum: number; durN: number }) => r.durSum / r.durN;
      const globalAht =
        withDur.reduce((s, [, r]) => s + r.durSum, 0) / withDur.reduce((s, [, r]) => s + r.durN, 0);
      const slow = withDur.slice().sort((a, b) => aht(b[1]) - aht(a[1]))[0];
      if (aht(slow[1]) > globalAht * 1.4) {
        out.push({
          tone: "warn",
          icon: "clock",
          text: `${nameOf(slow[0])} tiene un AHT de ${formatDurationSec(Math.round(aht(slow[1])))}, ~${Math.round((aht(slow[1]) / globalAht - 1) * 100)}% sobre el promedio del equipo.`,
          weight: 45,
        });
      }
    }
  }

  // Contactos sin atender
  if (missed > 0 && missed / total >= 0.08) {
    out.push({
      tone: "warn",
      icon: "down",
      text: `${Math.round((missed / total) * 100)}% de los contactos (${missed}) quedaron sin atender — revisa la cobertura en las horas pico.`,
      weight: 60,
    });
  }

  // Sentimiento neto del período
  if (posTotal + negTotal >= 5) {
    const net = Math.round(((posTotal - negTotal) / total) * 100);
    if (net >= 20)
      out.push({
        tone: "pos",
        icon: "spark",
        text: `El clima del período es bueno: score neto de sentimiento +${net} (${posTotal} positivos vs ${negTotal} negativos).`,
        weight: 25,
      });
    else if (net <= -10)
      out.push({
        tone: "warn",
        icon: "down",
        text: `El sentimiento del período es negativo (score neto ${net}): más quejas que satisfacciones, conviene revisar los motivos.`,
        weight: 65,
      });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 5);
}

const TONE_COLOR: Record<Tone, string> = {
  pos: "var(--green)",
  warn: "var(--gold)",
  info: "var(--cyan)",
};

function InsightIcon({ icon }: { icon: Insight["icon"] }) {
  const size = 15;
  switch (icon) {
    case "up":
      return <TrendingUp size={size} />;
    case "down":
      return <TrendingDown size={size} />;
    case "warn":
      return <AlertTriangle size={size} />;
    case "award":
      return <Award size={size} />;
    case "clock":
      return <Clock size={size} />;
    default:
      return <Sparkles size={size} />;
  }
}

export function AutoInsights({
  contacts,
  resolveName,
}: {
  contacts: ContactRecord[];
  resolveName?: (id: string) => string;
}) {
  const insights = useMemo(() => computeInsights(contacts, resolveName), [contacts, resolveName]);
  if (insights.length === 0) {
    if (contacts.length === 0) return null;
    return (
      <div className="dim" style={{ fontSize: 13 }}>
        Sin patrones destacables en este período.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {insights.map((ins, i) => {
        const color = TONE_COLOR[ins.tone];
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 11,
              padding: "11px 13px",
              borderRadius: 11,
              border: "1px solid var(--border-1)",
              borderLeft: `3px solid ${color}`,
              background: `linear-gradient(90deg, color-mix(in srgb, ${color} 6%, var(--bg-1)), var(--bg-1) 60%)`,
            }}
          >
            <span
              style={{
                display: "inline-grid",
                placeItems: "center",
                width: 28,
                height: 28,
                flex: "0 0 auto",
                borderRadius: 8,
                background: `color-mix(in srgb, ${color} 16%, transparent)`,
                color,
                marginTop: 1,
              }}
            >
              <InsightIcon icon={ins.icon} />
            </span>
            <span
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--text-1)",
                fontWeight: 500,
              }}
            >
              {ins.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
