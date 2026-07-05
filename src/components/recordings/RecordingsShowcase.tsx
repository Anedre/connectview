import { useEffect, useMemo, useState } from "react";
import {
  Phone,
  MessageCircle,
  Mail,
  Paperclip,
  History,
  Search,
  Sparkles,
  ChevronDown,
  ArrowRight,
  LayoutGrid,
  X,
  Share2,
  Download,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Clock,
  FileText,
  Image as ImageIcon,
  TrendingUp,
  Tag,
  RefreshCw,
  Play,
  Pause,
  Calendar as CalIcon,
  Home,
  Headphones,
  ListChecks,
  Users,
  Megaphone,
  Bot,
  Zap,
  BarChart3,
  Mic,
  Settings,
  Bell,
  Moon,
  User,
} from "lucide-react";
import { WaveformTimeline } from "@/components/recordings/WaveformTimeline";
import { Sparkline } from "@/components/recordings/Sparkline";
import * as D from "@/components/recordings/demoData";
import type { TranscriptSegment } from "@/types/recordings";
import { initials } from "@/lib/initials";

/**
 * RecordingsShowcase — vista de DEMOSTRACIÓN de Historial y Grabaciones, idéntica
 * al mockup de Claude Design, alimentada por el dataset de ejemplo (demoData).
 * Se monta SOLO en /recordings-demo; la pantalla real (/recordings) usa datos
 * reales y nunca importa esto. Reutiliza las clases .hg + WaveformTimeline +
 * Sparkline para no divergir del look real. Ver [[project_recordings_redesign]].
 */

const cv = (v: string) => `var(${v})`;
const fmtDur = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const fmtClock = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const sentTone = (s: D.Sent) =>
  s === "positivo"
    ? "POSITIVE"
    : s === "negativo"
      ? "NEGATIVE"
      : s === "mixto"
        ? "MIXED"
        : "NEUTRAL";
const DEMO_TODAY = new Date(2026, 5, 13);

type Tab = "resumen" | "calls" | "whatsapp" | "emails" | "archivos" | "actividad";
const CH: {
  id: Exclude<Tab, "resumen">;
  label: string;
  icon: React.ElementType;
  tone: string;
  soft: string;
  count: number;
}[] = [
  {
    id: "calls",
    label: "Llamadas",
    icon: Phone,
    tone: "--cian",
    soft: "--cian-soft",
    count: D.counts.llamadas,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    tone: "--verde",
    soft: "--verde-soft",
    count: D.counts.whatsapp,
  },
  {
    id: "emails",
    label: "Emails",
    icon: Mail,
    tone: "--ambar",
    soft: "--ambar-soft",
    count: D.counts.emails,
  },
  {
    id: "archivos",
    label: "Archivos",
    icon: Paperclip,
    tone: "--violeta",
    soft: "--violeta-soft",
    count: D.counts.archivos,
  },
  {
    id: "actividad",
    label: "Actividad",
    icon: History,
    tone: "--text-2",
    soft: "--bg-3",
    count: D.counts.historial,
  },
];

/* ─── Heatmap coloreado por sentimiento ─── */
function Heatmap({ weeks, onPick }: { weeks: number; onPick?: () => void }) {
  const { cols, monthLabels } = useMemo(() => {
    const start = new Date(DEMO_TODAY);
    start.setDate(start.getDate() - (weeks * 7 - 1));
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const grid: { date: Date; sent: D.Sent | null; n: number; future: boolean }[][] = [];
    const labels: { col: number; label: string }[] = [];
    const cur = new Date(start);
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const col: { date: Date; sent: D.Sent | null; n: number; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const calls = D.porDia[D.dayKey(cur)] || [];
        let sent: D.Sent | null = null;
        if (calls.length) {
          const tally: Record<string, number> = {};
          calls.forEach((c) => {
            tally[c.sent] = (tally[c.sent] || 0) + 1;
          });
          sent = (Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] as D.Sent) || "neutral";
        }
        col.push({ date: new Date(cur), sent, n: calls.length, future: cur > DEMO_TODAY });
        if (d === 0 && cur.getMonth() !== lastMonth) {
          labels.push({ col: w, label: D.MES[cur.getMonth()].slice(0, 3) });
          lastMonth = cur.getMonth();
        }
        cur.setDate(cur.getDate() + 1);
      }
      grid.push(col);
    }
    return { cols: grid, monthLabels: labels };
  }, [weeks]);
  const intensity = (n: number) =>
    n <= 0 ? 0 : n === 1 ? 0.45 : n <= 2 ? 0.65 : n <= 4 ? 0.82 : 1;
  return (
    <div style={{ overflowX: "auto" }}>
      <div className="hg-heat-months">
        {cols.map((_, w) => (
          <span key={w} className="hg-heat-mlabel">
            {monthLabels.find((m) => m.col === w)?.label || ""}
          </span>
        ))}
      </div>
      <div className="hg-heat">
        {cols.map((col, w) => (
          <div className="hg-heat-col" key={w}>
            {col.map((cell, d) => (
              <span
                key={d}
                className="hg-heat-cell"
                title={
                  cell.future
                    ? ""
                    : `${cell.date.getDate()} ${D.MES[cell.date.getMonth()].slice(0, 3)} · ${cell.n} llamada${cell.n === 1 ? "" : "s"}${cell.sent ? ` · ${cell.sent}` : ""}`
                }
                onClick={() => cell.n > 0 && onPick?.()}
                style={{
                  background: cell.sent ? cv(D.sentColor[cell.sent]) : cv("--bg-3"),
                  opacity: cell.future ? 0 : cell.sent ? intensity(cell.n) : 1,
                  cursor: cell.n > 0 ? "pointer" : "default",
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SentLegend() {
  const items: [string, D.Sent][] = [
    ["positivo", "positivo"],
    ["mixto", "mixto"],
    ["negativo", "negativo"],
    ["neutral", "neutral"],
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        fontSize: 11.5,
        color: cv("--text-3"),
        fontWeight: 700,
        flexWrap: "wrap",
      }}
    >
      {items.map(([l, s]) => (
        <span key={l} style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: cv(D.sentColor[s]) }} />{" "}
          {l}
        </span>
      ))}
    </div>
  );
}

/* ─── Hero ─── */
function Hero({ onSwitch, onOpenAI }: { onSwitch: () => void; onOpenAI: () => void }) {
  return (
    <div className="hg-card hg-hero">
      <div className="hg-hero__av">AE</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <button className="hg-hero__switch" onClick={onSwitch} title="Cambiar de contacto (⌘K)">
          <span className="hg-hero__name">Andre Elian Alata Calle</span>
          <ChevronDown size={18} style={{ color: cv("--text-3"), flex: "0 0 auto" }} />
        </button>
        <div className="hg-hero__meta">
          <span className="hg-chip" style={{ background: cv("--cian"), color: "#fff" }}>
            Teléfono
          </span>
          <span className="hg-chip">No contactado</span>
          <span className="hg-chip mono">70498978</span>
          <span
            className="hg-chip"
            style={{ background: cv("--cian-soft"), color: cv("--cian-2") }}
          >
            Última: llamada · hace 5 d
          </span>
        </div>
      </div>
      <div className="hg-hero__actions">
        <span className="hg-act" style={{ color: cv("--cian") }}>
          <Phone size={17} />
        </span>
        <span className="hg-act" style={{ color: cv("--verde") }}>
          <MessageCircle size={17} />
        </span>
        <span className="hg-act" style={{ color: cv("--ambar") }}>
          <Mail size={17} />
        </span>
        <button
          className="hg-btn hg-btn--primary"
          onClick={onOpenAI}
          style={{ background: cv("--violeta") }}
        >
          <Sparkles size={15} /> Resumen IA
        </button>
      </div>
    </div>
  );
}

/* ─── Channel navigator ─── */
function ChannelNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const resumenOn = active === "resumen";
  return (
    <nav className="hg-chnav" aria-label="Canales">
      <button
        className={`hg-chnav__btn ${resumenOn ? "hg-chnav__btn--on" : ""}`}
        onClick={() => onChange("resumen")}
        style={resumenOn ? { background: cv("--bg-1"), boxShadow: cv("--sh-2") } : undefined}
      >
        <span
          className="hg-chnav__chip"
          style={{ background: cv("--bg-3"), color: cv("--text-1") }}
        >
          <LayoutGrid size={17} />
        </span>
        <span className="hg-chnav__col">
          <span
            className="hg-chnav__label"
            style={{ fontWeight: 800, fontSize: 13, color: cv("--text-1") }}
          >
            Resumen
          </span>
          <span style={{ fontSize: 10.5, color: cv("--text-3"), fontWeight: 600 }}>
            Vista general
          </span>
        </span>
      </button>
      <span className="hg-chnav__div" />
      {CH.map((c) => {
        const on = active === c.id;
        return (
          <button
            key={c.id}
            className={`hg-chnav__btn hg-chnav__btn--flex ${on ? "hg-chnav__btn--on" : ""}`}
            onClick={() => onChange(c.id)}
            style={on ? { background: cv(c.tone), boxShadow: cv("--sh-2") } : undefined}
          >
            <span
              className="hg-chnav__chip"
              style={{
                background: on ? "rgba(255,255,255,.22)" : cv(c.soft),
                color: on ? "#fff" : cv(c.tone),
              }}
            >
              <c.icon size={17} />
            </span>
            <span className="hg-chnav__col">
              <span
                className="hg-chnav__label"
                style={{ color: on ? "rgba(255,255,255,.88)" : cv("--text-3") }}
              >
                {c.label}
              </span>
              <span className="hg-chnav__count" style={{ color: on ? "#fff" : cv("--text-1") }}>
                {c.count}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ─── Resumen ─── */
function Resumen({ onGoto, onOpenAI }: { onGoto: (t: Tab) => void; onOpenAI: () => void }) {
  const tl = [
    {
      ch: "voice",
      icon: Phone,
      tone: "--cian",
      title: "Llamada saliente · Promesa de pago",
      dot: "--ambar",
      meta: "Camila Rojas · hace 5 días",
      body: "Reverso de cobro duplicado + promesa de pago para el 28.",
    },
    {
      ch: "chat",
      icon: MessageCircle,
      tone: "--verde",
      title: "WhatsApp · 12 mensajes",
      dot: "--verde",
      meta: "Andre · hace 6 días",
      body: "Compartió captura de Yape y confirmó pago parcial.",
    },
    {
      ch: "voice",
      icon: PhoneMissed,
      tone: "--cian",
      title: "Llamada perdida",
      dot: "--rojo",
      meta: "Cola: Cobranzas · hace 8 días",
      body: "No contestada · 0:00",
    },
    {
      ch: "email",
      icon: Mail,
      tone: "--violeta",
      title: "Email · Consulta admisión 2027",
      dot: "--text-3",
      meta: "Andre · hace 22 días",
      body: "Solicita información sobre Ingeniería de Sistemas.",
    },
  ];
  const mix = [
    { k: "Llamadas", n: 118, t: "--cian" },
    { k: "WhatsApp", n: 80, t: "--verde" },
    { k: "Emails", n: 2, t: "--ambar" },
    { k: "Archivos", n: 3, t: "--violeta" },
  ];
  const sm = D.sentMix;
  return (
    <div className="hg-ov">
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        <div className="hg-card" style={{ padding: "18px 20px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 15 }}>Mapa de actividad</div>
            <button className="hg-fchip" onClick={() => onGoto("calls")}>
              Ver llamadas <ArrowRight size={13} style={{ verticalAlign: -2 }} />
            </button>
          </div>
          <Heatmap weeks={27} onPick={() => onGoto("calls")} />
        </div>
        <div className="hg-card" style={{ padding: "20px 22px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 15 }}>Línea de tiempo · todos los canales</div>
            <span style={{ fontSize: 12, color: cv("--text-3"), fontWeight: 700 }}>
              {D.counts.total} interacciones
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {tl.map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: 32,
                    flex: "0 0 auto",
                  }}
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: cv(it.tone + "-soft"),
                      color: cv(it.tone),
                      flex: "0 0 auto",
                    }}
                  >
                    <it.icon size={14} />
                  </span>
                  {i < tl.length - 1 && (
                    <span
                      style={{
                        flex: 1,
                        width: 2,
                        background: cv("--border-1"),
                        marginTop: 2,
                        minHeight: 14,
                      }}
                    />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingBottom: 16, borderLeft: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{it.title}</span>
                    <span
                      style={{ width: 7, height: 7, borderRadius: 99, background: cv(it.dot) }}
                    />
                  </div>
                  <div style={{ fontSize: 11.5, color: cv("--text-3"), marginTop: 2 }}>
                    {it.meta}
                  </div>
                  <div style={{ fontSize: 13, color: cv("--text-2"), marginTop: 4 }}>{it.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div className="hg-card" style={{ padding: "18px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>Resumen del cliente</div>
          <div className="hg-row">
            <span style={{ color: cv("--text-3"), fontWeight: 600 }}>Última interacción</span>
            <b>Llamada · hace 5 d</b>
          </div>
          <div className="hg-row">
            <span style={{ color: cv("--text-3"), fontWeight: 600 }}>Canal principal</span>
            <b>Llamadas</b>
          </div>
          <div className="hg-row">
            <span style={{ color: cv("--text-3"), fontWeight: 600 }}>Total interacciones</span>
            <b className="mono">{D.counts.total}</b>
          </div>
          <div
            style={{ margin: "12px 0 8px", fontSize: 12, fontWeight: 700, color: cv("--text-3") }}
          >
            Mezcla de canales
          </div>
          <div style={{ display: "flex", gap: 2, height: 10 }}>
            {mix.map((c) => (
              <div
                key={c.k}
                title={`${c.k}: ${c.n}`}
                style={{ flex: c.n, background: cv(c.t), borderRadius: 99 }}
              />
            ))}
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              marginTop: 10,
              fontSize: 11.5,
              color: cv("--text-3"),
              fontWeight: 700,
              flexWrap: "wrap",
            }}
          >
            {mix.map((c) => (
              <span key={c.k} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: cv(c.t) }} />{" "}
                {c.n}
              </span>
            ))}
          </div>
        </div>

        <div className="hg-card" style={{ padding: "18px 20px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 14 }}>Sentimiento global</div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: cv("--verde"),
                background: cv("--verde-soft"),
                padding: "2px 8px",
                borderRadius: 99,
              }}
            >
              +12% vs mes ant.
            </span>
          </div>
          <div style={{ display: "flex", gap: 2, height: 10, marginBottom: 12 }}>
            <div style={{ flex: sm.positivo, background: cv("--verde"), borderRadius: 99 }} />
            <div style={{ flex: sm.neutral, background: cv("--text-3"), borderRadius: 99 }} />
            <div style={{ flex: sm.mixto, background: cv("--ambar"), borderRadius: 99 }} />
            <div style={{ flex: sm.negativo, background: cv("--rojo"), borderRadius: 99 }} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px 16px",
              fontSize: 12.5,
            }}
          >
            {(
              [
                ["positivo", sm.positivo, "--verde"],
                ["neutral", sm.neutral, "--text-3"],
                ["mixto", sm.mixto, "--ambar"],
                ["negativo", sm.negativo, "--rojo"],
              ] as const
            ).map(([l, v, t]) => (
              <div
                key={l}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span
                  style={{ display: "flex", gap: 6, alignItems: "center", color: cv("--text-2") }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: cv(t) }} /> {l}
                </span>
                <b className="mono">{v}%</b>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onOpenAI}
          className="hg-card hg-lift"
          style={{
            padding: "18px 20px",
            textAlign: "left",
            cursor: "pointer",
            background: "linear-gradient(135deg,var(--violeta-soft),var(--bg-1))",
            border: "1px solid var(--violeta-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 9,
                background: cv("--violeta"),
                color: "#fff",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Sparkles size={16} />
            </span>
            <span style={{ fontWeight: 800, fontSize: 14, color: cv("--violeta-2") }}>
              Sugerencia IA
            </span>
          </div>
          <div style={{ fontSize: 13, color: cv("--text-2"), lineHeight: 1.55 }}>
            El cliente tiene una promesa de pago para el 28. Programa un recordatorio por WhatsApp 2
            días antes.
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 12.5,
              fontWeight: 800,
              color: cv("--violeta"),
              display: "flex",
              gap: 5,
              alignItems: "center",
            }}
          >
            Ver resumen IA <ArrowRight size={14} />
          </div>
        </button>
      </div>
    </div>
  );
}

/* ─── Llamadas ─── */
function dirIcon(c: D.DemoCall) {
  return c.perdida ? PhoneMissed : c.dir === "entrante" ? PhoneIncoming : PhoneOutgoing;
}
function Llamadas({
  selId,
  setSelId,
  onOpenAI,
}: {
  selId: string;
  setSelId: (id: string) => void;
  onOpenAI: () => void;
}) {
  const dayCalls = useMemo(() => {
    const k = D.dayKey(D.ejemploCall.date);
    return [...(D.porDia[k] || [])].sort((a, b) => a.date.getTime() - b.date.getTime());
  }, []);
  const sel = useMemo(() => D.llamadas.find((c) => c.id === selId) || D.ejemploCall, [selId]);
  const weekly = useMemo(() => {
    const W = 12;
    const arr = new Array(W).fill(0);
    D.llamadas.forEach((c) => {
      const wa = Math.floor((DEMO_TODAY.getTime() - c.date.getTime()) / (7 * 86400000));
      if (wa >= 0 && wa < W) arr[W - 1 - wa]++;
    });
    return arr;
  }, []);
  const segments: TranscriptSegment[] = useMemo(() => {
    const t = sel.transcript || [];
    return t.map((seg, i) => ({
      participant: (seg.who === "Agente"
        ? "AGENT"
        : "CUSTOMER") as TranscriptSegment["participant"],
      content: seg.text,
      beginOffsetMillis: seg.t * 1000,
      endOffsetMillis: (t[i + 1]?.t ?? sel.dur) * 1000,
      sentiment: sentTone(seg.s),
    }));
  }, [sel]);
  const [curSec, setCurSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setCurSec(0);
    setPlaying(false);
  }, [selId]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () => setCurSec((s) => (s + 1 >= sel.dur ? (clearInterval(t), sel.dur) : s + 1)),
      1000,
    );
    return () => clearInterval(t);
  }, [playing, sel.dur]);

  const metrics: {
    label: string;
    value: string;
    data: number[];
    tone: string;
    icon: React.ElementType;
  }[] = [
    {
      label: "Llamadas",
      value: String(D.metrics.total),
      data: weekly,
      tone: "--cian",
      icon: Phone,
    },
    {
      label: "Contestadas",
      value: D.metrics.contestPct + "%",
      data: weekly.map((n) => Math.round(n * 0.86)),
      tone: "--verde",
      icon: Phone,
    },
    {
      label: "Duración prom",
      value: fmtDur(D.metrics.durProm),
      data: weekly.map((_n, i) => 200 + ((i * 37) % 120)),
      tone: "--violeta",
      icon: Clock,
    },
    {
      label: "Perdidas",
      value: String(D.metrics.perdidas),
      data: weekly.map((n) => Math.round(n * 0.14)),
      tone: "--rojo",
      icon: PhoneMissed,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        {metrics.map((m) => (
          <div key={m.label} className="hg-card" style={{ padding: "16px 18px" }}>
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>
                  {m.value}
                </div>
                <div style={{ fontSize: 12, color: cv("--text-3"), fontWeight: 600 }}>
                  {m.label}
                </div>
              </div>
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: cv(m.tone + "-soft"),
                  color: cv(m.tone),
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <m.icon size={15} />
              </span>
            </div>
            <div style={{ marginTop: 10, height: 26 }}>
              <Sparkline data={m.data} color={cv(m.tone)} />
            </div>
          </div>
        ))}
      </div>

      <div className="hg-card" style={{ padding: "18px 20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 14,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              Actividad de llamadas · últimos 7 meses
            </div>
            <div style={{ fontSize: 12, color: cv("--text-3"), marginTop: 2 }}>
              Cada celda es un día · color = sentimiento dominante · intensidad = volumen
            </div>
          </div>
          <SentLegend />
        </div>
        <Heatmap weeks={30} />
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 18, alignItems: "start" }}
      >
        <div className="hg-card" style={{ padding: "16px 8px 12px 16px" }}>
          <div style={{ padding: "0 8px 12px 0" }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              {D.ejemploCall.date.getDate()} de {D.MES[D.ejemploCall.date.getMonth()]}
            </div>
            <div style={{ fontSize: 12, color: cv("--text-3") }}>
              {dayCalls.length} llamadas · toca una para reproducir
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingRight: 8 }}>
            {dayCalls.map((c) => {
              const Ic = dirIcon(c);
              const on = c.id === selId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelId(c.id)}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    textAlign: "left",
                    padding: "10px 11px",
                    borderRadius: 12,
                    border: "none",
                    cursor: "pointer",
                    background: on ? cv("--cian-soft") : "transparent",
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: cv("--text-3"), fontWeight: 700, width: 38 }}
                  >
                    {fmtClock(c.date)}
                  </span>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      display: "grid",
                      placeItems: "center",
                      flex: "0 0 26px",
                      background: c.perdida ? cv("--rojo-soft") : cv("--cian-soft"),
                      color: c.perdida ? cv("--rojo") : cv("--cian"),
                    }}
                  >
                    <Ic size={13} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {c.agente}
                      </span>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 99,
                          flex: "0 0 7px",
                          background: cv(D.sentColor[c.sent]),
                        }}
                      />
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: cv("--text-3") }}>
                      {c.tipi}
                    </span>
                  </span>
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 3,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 99,
                        background: c.perdida ? cv("--rojo-soft") : cv("--verde-soft"),
                        color: c.perdida ? cv("--rojo") : cv("--verde"),
                      }}
                    >
                      {c.status}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: cv("--text-3") }}>
                      {c.perdida ? "—" : fmtDur(c.dur)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="hg-card" style={{ padding: "18px 20px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: cv("--cian-soft"),
                color: cv("--cian"),
                display: "grid",
                placeItems: "center",
                flex: "0 0 30px",
              }}
            >
              <Phone size={15} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 800,
                  fontSize: 15,
                }}
              >
                {sel.dir === "entrante" ? "Llamada entrante" : "Llamada saliente"}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 99,
                    textTransform: "capitalize",
                    background: `color-mix(in srgb, ${cv(D.sentColor[sel.sent])} 16%, transparent)`,
                    color: cv(D.sentColor[sel.sent]),
                  }}
                >
                  {sel.sent}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: cv("--text-3") }}>
                {sel.agente} · {sel.date.getDate()} de {D.MES[sel.date.getMonth()]} ·{" "}
                {fmtDur(sel.dur)}
              </div>
            </div>
            <button className="hg-act" onClick={onOpenAI} title="Resumen IA">
              <Sparkles size={16} style={{ color: cv("--violeta") }} />
            </button>
          </div>

          {sel.transcript ? (
            <>
              <div style={{ margin: "14px 0 4px" }}>
                <WaveformTimeline
                  durationSec={sel.dur}
                  currentSec={curSec}
                  segments={segments}
                  onSeekSec={(s) => setCurSec(s)}
                  height={64}
                />
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 14px" }}
              >
                <button
                  onClick={() => setPlaying((p) => !p)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 99,
                    border: "none",
                    cursor: "pointer",
                    background: cv("--cian"),
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {playing ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <span className="mono" style={{ fontSize: 12, color: cv("--text-2") }}>
                  {fmtDur(curSec)} / {fmtDur(sel.dur)}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {["1×", "1.5×", "2×"].map((s, i) => (
                    <span
                      key={s}
                      className="hg-chip"
                      style={i === 0 ? { background: cv("--bg-3") } : undefined}
                    >
                      {s}
                    </span>
                  ))}
                </span>
              </div>

              <div
                style={{
                  borderTop: `1px solid ${cv("--border-1")}`,
                  paddingTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {sel.transcript.map((seg, i) => (
                  <div key={i} style={{ display: "flex", gap: 10 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: cv("--text-3"),
                        width: 36,
                        flex: "0 0 36px",
                        paddingTop: 2,
                      }}
                    >
                      {fmtDur(seg.t)}
                    </span>
                    <div>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                          color: seg.who === "Agente" ? cv("--cian") : cv("--text-2"),
                        }}
                      >
                        {seg.who}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13.5,
                          color: cv("--text-1"),
                          lineHeight: 1.5,
                        }}
                      >
                        {seg.text}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: `1px solid ${cv("--border-1")}`,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                      color: cv("--text-3"),
                      marginBottom: 8,
                    }}
                  >
                    Tipificación
                  </div>
                  <span
                    className="hg-chip"
                    style={{ background: cv("--cian-soft"), color: cv("--cian-2") }}
                  >
                    <Tag size={12} /> {sel.tipi}
                  </span>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                      color: cv("--text-3"),
                      margin: "14px 0 6px",
                    }}
                  >
                    Notas del agente
                  </div>
                  <div style={{ fontSize: 13, color: cv("--text-2") }}>
                    {sel.nota || "Confirmó datos de contacto."}
                  </div>
                </div>
                <button
                  onClick={onOpenAI}
                  className="hg-lift"
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    padding: "14px 16px",
                    borderRadius: 12,
                    background: "linear-gradient(135deg,var(--violeta-soft),var(--bg-1))",
                    border: "1px solid var(--violeta-soft)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 8,
                        background: cv("--violeta"),
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Sparkles size={13} />
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 13, color: cv("--violeta-2") }}>
                      Resumen IA
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: cv("--text-2"),
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {sel.resumenIA}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      fontWeight: 800,
                      color: cv("--violeta"),
                      display: "flex",
                      gap: 5,
                      alignItems: "center",
                    }}
                  >
                    Ver análisis completo <ArrowRight size={13} />
                  </div>
                </button>
              </div>
            </>
          ) : (
            <div className="muted" style={{ padding: "40px 0", textAlign: "center", fontSize: 13 }}>
              {sel.perdida
                ? "Llamada perdida — sin grabación."
                : "Esta llamada no tiene transcripción."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── WhatsApp ─── */
function WhatsApp() {
  let lastDay = "";
  return (
    <div
      className="hg-card"
      style={{ padding: 0, overflow: "hidden", maxWidth: 760, margin: "0 auto", width: "100%" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 18px",
          borderBottom: `1px solid ${cv("--border-1")}`,
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: cv("--verde-soft"),
            color: cv("--verde"),
            display: "grid",
            placeItems: "center",
          }}
        >
          <MessageCircle size={17} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Hilo unificado de WhatsApp</div>
          <div style={{ fontSize: 11.5, color: cv("--text-3") }}>
            {D.counts.whatsapp} mensajes · varias conversaciones
          </div>
        </div>
        <span className="hg-chip">
          <CalIcon size={12} /> Saltar a fecha
        </span>
      </div>
      <div
        style={{
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: cv("--bg-2"),
        }}
      >
        {D.waMsgs.slice(0, 24).map((m, i) => {
          const dl = `${m.date.getDate()} ${D.MES[m.date.getMonth()]}`;
          const showDay = dl !== lastDay;
          lastDay = dl;
          const out = m.dir === "out";
          return (
            <div key={i}>
              {showDay && (
                <div style={{ textAlign: "center", margin: "8px 0" }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: cv("--text-3"),
                      background: cv("--bg-1"),
                      padding: "3px 12px",
                      borderRadius: 99,
                      textTransform: "capitalize",
                    }}
                  >
                    {dl}
                  </span>
                </div>
              )}
              <div
                className="hg-bubble-in"
                style={{
                  display: "flex",
                  justifyContent: out ? "flex-end" : "flex-start",
                  animationDelay: `${(i * 0.04).toFixed(2)}s`,
                }}
              >
                <div
                  style={{
                    maxWidth: "76%",
                    padding: "9px 13px",
                    borderRadius: 14,
                    fontSize: 13.5,
                    lineHeight: 1.45,
                    background: out ? cv("--verde-soft") : cv("--bg-1"),
                    border: `1px solid ${out ? "transparent" : cv("--border-1")}`,
                    borderBottomRightRadius: out ? 4 : 14,
                    borderBottomLeftRadius: out ? 14 : 4,
                  }}
                >
                  {m.file ? (
                    <span
                      style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}
                    >
                      {/\.pdf$/.test(m.text) ? (
                        <FileText size={15} style={{ color: cv("--rojo") }} />
                      ) : (
                        <ImageIcon size={15} style={{ color: cv("--verde") }} />
                      )}{" "}
                      {m.text}
                    </span>
                  ) : (
                    m.text
                  )}
                  <span
                    style={{
                      display: "block",
                      textAlign: "right",
                      fontSize: 10,
                      color: cv("--text-3"),
                      marginTop: 3,
                    }}
                  >
                    {fmtClock(m.date)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Emails ─── */
function Emails() {
  const [open, setOpen] = useState(0);
  return (
    <div
      style={{
        maxWidth: 820,
        margin: "0 auto",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: cv("--text-3"),
          fontSize: 12.5,
          fontWeight: 600,
          padding: "0 4px",
        }}
      >
        <Mail size={14} /> +51 953 730 189 · {D.emails.length} hilos · {D.counts.emails} emails
      </div>
      {D.emails.map((e, i) => (
        <div key={i} className="hg-card" style={{ padding: 0, overflow: "hidden" }}>
          <button
            onClick={() => setOpen(open === i ? -1 : i)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: cv("--ambar-soft"),
                color: cv("--ambar"),
                display: "grid",
                placeItems: "center",
                flex: "0 0 32px",
              }}
            >
              <Mail size={15} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{e.asunto}</span>
              <span style={{ fontSize: 12, color: cv("--text-3") }}>
                {e.from} · {e.msgs.length} mensaje · último {e.msgs[0].date}
              </span>
            </span>
            <ChevronDown
              size={18}
              style={{
                color: cv("--text-3"),
                transform: open === i ? "rotate(180deg)" : "none",
                transition: "transform .15s",
              }}
            />
          </button>
          {open === i && (
            <div style={{ padding: "0 18px 16px 62px" }}>
              {e.msgs.map((m, j) => (
                <div key={j} style={{ borderTop: `1px solid ${cv("--border-1")}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: cv("--text-3"), marginBottom: 4 }}>
                    <b style={{ color: cv("--text-1") }}>{m.who}</b> · {m.date}
                  </div>
                  <div style={{ fontSize: 13.5, color: cv("--text-1"), lineHeight: 1.55 }}>
                    {m.text}
                  </div>
                  {m.file && (
                    <span className="hg-chip" style={{ marginTop: 10 }}>
                      <FileText size={12} style={{ color: cv("--rojo") }} /> {m.file}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Archivos ─── */
function Archivos() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["Todos · 3", "Imágenes · 1", "PDFs · 2"].map((f, i) => (
          <span key={f} className={`hg-fchip ${i === 0 ? "hg-fchip--on" : ""}`}>
            {f}
          </span>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
          gap: 14,
        }}
      >
        {D.archivos.map((a, i) => (
          <div key={i} className="hg-card hg-lift" style={{ padding: 16, cursor: "pointer" }}>
            <div
              style={{
                height: 96,
                borderRadius: 10,
                background: cv(a.color + "-soft"),
                display: "grid",
                placeItems: "center",
                marginBottom: 12,
                color: cv(a.color),
              }}
            >
              {a.tipo === "img" ? <ImageIcon size={30} /> : <FileText size={30} />}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {a.nombre}
            </div>
            <div style={{ fontSize: 11.5, color: cv("--text-3"), marginTop: 2 }}>
              {a.canal} · {a.quien}
            </div>
            <div style={{ fontSize: 11, color: cv("--text-3"), marginTop: 2 }}>{a.size}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Actividad ─── */
function Actividad() {
  const ic = (k: string) => (k === "trending" ? TrendingUp : k === "tag" ? Tag : RefreshCw);
  return (
    <div
      className="hg-card"
      style={{ padding: "22px 24px", maxWidth: 720, margin: "0 auto", width: "100%" }}
    >
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 18 }}>Ciclo de vida del lead</div>
      {D.historial.map((h, i) => {
        const Ic = ic(h.icon);
        return (
          <div key={i} style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flex: "0 0 auto",
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: cv(h.color + "-soft"),
                  color: cv(h.color),
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Ic size={15} />
              </span>
              {i < D.historial.length - 1 && (
                <span
                  style={{
                    flex: 1,
                    width: 2,
                    background: cv("--border-1"),
                    marginTop: 4,
                    minHeight: 18,
                  }}
                />
              )}
            </div>
            <div style={{ paddingBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{h.title}</div>
              <div style={{ fontSize: 12, color: cv("--text-3"), marginTop: 2 }}>{h.meta}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Command palette ─── */
function CmdPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const filtered = D.contactos.filter(
    (c) => !q || c.nombre.toLowerCase().includes(q.toLowerCase()) || c.tel.includes(q),
  );
  if (!open) return null;
  return (
    <>
      <div className="hg-cmd-scrim" onClick={onClose} />
      <div className="hg-cmd" role="dialog">
        <div className="hg-cmd__search">
          <Search size={18} style={{ color: cv("--text-3") }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            placeholder="Buscar contacto por nombre, teléfono o empresa…"
          />
          <span className="hg-chip">esc</span>
        </div>
        <div className="hg-cmd__filters">
          {["Todos", "Teléfono", "WhatsApp", "Correo", "Salesforce"].map((f, i) => (
            <button key={f} className={`hg-fchip ${i === 0 ? "hg-fchip--on" : ""}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="hg-cmd__list">
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`hg-cmd__row ${i === cursor ? "hg-cmd__row--cursor" : ""} ${c.activo ? "hg-cmd__row--sel" : ""}`}
              onMouseEnter={() => setCursor(i)}
              onClick={onClose}
            >
              <span className="rec-row__av">{initials(c.nombre)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontWeight: 700,
                    fontSize: 14,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {c.nombre}
                </span>
                <span style={{ display: "block", fontSize: 12, color: cv("--text-3") }}>
                  {c.sub}
                </span>
              </span>
              <span className="rec-row__dot" title={c.origen} style={{ background: cv(c.dot) }} />
            </button>
          ))}
        </div>
        <div className="hg-cmd__foot">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>esc cerrar</span>
        </div>
      </div>
    </>
  );
}

/* ─── AI slide-over ─── */
function AISlide({ onClose }: { onClose: () => void }) {
  const e = D.ejemploCall;
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const lbl = (t: string) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: ".05em",
        color: cv("--text-3"),
        marginBottom: 10,
      }}
    >
      {t}
    </div>
  );
  return (
    <>
      <div className="hg-ai-scrim" onClick={onClose} />
      <div className="hg-ai" role="dialog">
        <div
          style={{
            padding: "20px 22px",
            borderBottom: `1px solid ${cv("--border-1")}`,
            display: "flex",
            alignItems: "center",
            gap: 11,
            position: "sticky",
            top: 0,
            background: cv("--bg-1"),
            zIndex: 2,
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: cv("--violeta"),
              color: "#fff",
              display: "grid",
              placeItems: "center",
              flex: "0 0 34px",
            }}
          >
            <Sparkles size={18} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Resumen IA</div>
            <div style={{ fontSize: 11.5, color: cv("--text-3") }}>
              Andre Elian Alata Calle · Amazon Bedrock
            </div>
          </div>
          <button
            className="hg-act"
            onClick={onClose}
            title="Cerrar"
            style={{ width: 34, height: 34 }}
          >
            <X size={18} />
          </button>
        </div>
        <div
          style={{
            padding: 22,
            display: "flex",
            flexDirection: "column",
            gap: 22,
            overflowY: "auto",
          }}
        >
          <div>
            {lbl("Resumen de la llamada")}
            <div style={{ fontSize: 14, color: cv("--text-1"), lineHeight: 1.65 }}>
              {e.resumenIA}
            </div>
          </div>
          <div>
            {lbl("Momentos clave")}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(e.momentos || []).map((m, i) => (
                <div
                  key={i}
                  className="hg-card2"
                  style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 13px" }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 12, fontWeight: 700, color: cv("--text-3") }}
                  >
                    {fmtDur(m.t)}
                  </span>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      flex: "0 0 8px",
                      background: cv(D.sentColor[m.tone]),
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            {lbl("Sentimiento")}
            <div className="rec-sent__bar">
              <span style={{ flex: 46, background: cv("--verde") }} />
              <span style={{ flex: 34, background: cv("--text-3") }} />
              <span style={{ flex: 13, background: cv("--ambar") }} />
              <span style={{ flex: 7, background: cv("--rojo") }} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function RecordingsShowcase() {
  const [tab, setTab] = useState<Tab>("resumen");
  const [selId, setSelId] = useState(D.ejemploCall.id);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="hg hg--scroll">
      <div className="hg-inner">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            padding: "4px 2px 16px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: cv("--text-3"), marginBottom: 5 }}>
              Crecimiento <span style={{ opacity: 0.5, margin: "0 3px" }}>›</span> Grabaciones
            </div>
            <h1
              style={{
                fontSize: 27,
                fontWeight: 800,
                letterSpacing: "-.02em",
                margin: 0,
                color: cv("--text-1"),
              }}
            >
              Historial y Grabaciones
            </h1>
            <div style={{ fontSize: 13.5, color: cv("--text-2"), marginTop: 5 }}>
              Toda la actividad del contacto —llamadas, WhatsApp, emails y archivos— conectada en un
              solo lugar.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flex: "0 0 auto" }}>
            <button className="hg-btn hg-btn--ghost">
              <Share2 size={15} /> Compartir
            </button>
            <button className="hg-btn hg-btn--ghost">
              <Download size={15} /> Exportar
            </button>
          </div>
        </div>
        <Hero onSwitch={() => setCmdOpen(true)} onOpenAI={() => setAiOpen(true)} />
        <ChannelNav active={tab} onChange={setTab} />
        <div key={tab} className="hg-fade">
          {tab === "resumen" && <Resumen onGoto={setTab} onOpenAI={() => setAiOpen(true)} />}
          {tab === "calls" && (
            <Llamadas selId={selId} setSelId={setSelId} onOpenAI={() => setAiOpen(true)} />
          )}
          {tab === "whatsapp" && <WhatsApp />}
          {tab === "emails" && <Emails />}
          {tab === "archivos" && <Archivos />}
          {tab === "actividad" && <Actividad />}
        </div>
      </div>
      <CmdPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      {aiOpen && <AISlide onClose={() => setAiOpen(false)} />}
    </div>
  );
}

/* ─── Mock app chrome (nav + topbar) para el showcase de página completa ─── */
const NAV: Record<string, [string, React.ElementType][]> = {
  Operación: [
    ["Inicio", Home],
    ["Agent Desktop", Headphones],
    ["Cola en vivo", ListChecks],
  ],
  Crecimiento: [
    ["Leads", Users],
    ["Campañas", Megaphone],
    ["Bots", Bot],
    ["Automatizaciones", Zap],
    ["Agente IA", Sparkles],
    ["Citas", CalIcon],
    ["Reportes", BarChart3],
    ["Grabaciones", Mic],
  ],
  Sistema: [["Configuración", Settings]],
};
const INTEG: [string, string][] = [
  ["WhatsApp", "--verde"],
  ["Salesforce", "#1f6fd6"],
  ["Amazon Connect", "--ambar"],
];

function DemoChrome({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", height: "100vh", background: cv("--bg-2"), overflow: "hidden" }}>
      <nav
        style={{
          width: 236,
          flex: "0 0 236px",
          background: cv("--bg-1"),
          borderRight: `1px solid ${cv("--border-1")}`,
          display: "flex",
          flexDirection: "column",
          padding: "16px 12px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px 18px" }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: "linear-gradient(135deg,#ff6a3d,#e8442b)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontWeight: 900,
              fontSize: 13,
            }}
          >
            ◆
          </span>
          <span className="aria-wordmark" style={{ fontSize: 15 }}>
            AR<b>IA</b>
          </span>
        </div>
        {Object.entries(NAV).map(([group, items]) => (
          <div key={group} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: ".08em",
                color: cv("--text-3"),
                textTransform: "uppercase",
                padding: "0 8px 6px",
              }}
            >
              {group}
            </div>
            {items.map(([label, Ic]) => {
              const active = label === "Grabaciones";
              return (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 9,
                    fontSize: 13.5,
                    fontWeight: active ? 700 : 500,
                    color: active ? cv("--cian") : cv("--text-2"),
                    background: active ? cv("--cian-soft") : "transparent",
                    marginBottom: 1,
                  }}
                >
                  <Ic size={16} /> {label}
                </div>
              );
            })}
          </div>
        ))}
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: ".08em",
              color: cv("--text-3"),
              textTransform: "uppercase",
              padding: "0 8px 6px",
            }}
          >
            Integraciones
          </div>
          {INTEG.map(([label, color]) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                fontSize: 13.5,
                color: cv("--text-2"),
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: color.startsWith("--") ? cv(color) : color,
                }}
              />{" "}
              {label}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "10px 8px",
            borderTop: `1px solid ${cv("--border-1")}`,
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: cv("--violeta-soft"),
              color: cv("--violeta"),
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            A
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>anedre12345</div>
            <div style={{ fontSize: 11, color: cv("--text-3") }}>Admin</div>
          </div>
        </div>
      </nav>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            height: 60,
            flex: "0 0 60px",
            borderBottom: `1px solid ${cv("--border-1")}`,
            background: cv("--bg-1"),
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 24px",
          }}
        >
          <div
            style={{
              flex: 1,
              maxWidth: 520,
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: cv("--bg-2"),
              border: `1px solid ${cv("--border-1")}`,
              borderRadius: 10,
              padding: "8px 14px",
            }}
          >
            <Search size={16} style={{ color: cv("--text-3") }} />
            <span style={{ fontSize: 13, color: cv("--text-3"), flex: 1 }}>
              Buscar contactos, agentes, casos, transcripciones…
            </span>
            <span className="hg-chip">Ctrl K</span>
          </div>
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: cv("--text-2"),
              background: cv("--ambar-soft"),
              padding: "5px 11px",
              borderRadius: 99,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: cv("--ambar") }} />{" "}
            Conectando…
          </span>
          <Moon size={18} style={{ color: cv("--text-3") }} />
          <Bell size={18} style={{ color: cv("--text-3") }} />
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 99,
              background: cv("--bg-3"),
              color: cv("--text-2"),
              display: "grid",
              placeItems: "center",
            }}
          >
            <User size={16} />
          </span>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );
}

export function RecordingsShowcasePage() {
  return (
    <DemoChrome>
      <RecordingsShowcase />
    </DemoChrome>
  );
}
