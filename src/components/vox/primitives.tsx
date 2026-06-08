import { useMemo, type CSSProperties, type ReactNode, type SVGProps } from "react";

/* ============================================================
   Vox primitives — Avatar, Spark, ChannelChip, Kpi, StatusPill
   Mirrors the prototype's components/ui.jsx
   ============================================================ */

const AVATAR_PALETTE = [
  "#8B7EE8",
  "#22B8D9",
  "#F5A524",
  "#E879A6",
  "#1FAE6C",
  "#E5484D",
  "#5B8DEF",
];

export function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface AvatarProps {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg" | "xl";
  style?: CSSProperties;
}

export function Avatar({ name, color, size = "md", style }: AvatarProps) {
  const cls =
    size === "sm"
      ? "av av--sm"
      : size === "lg"
      ? "av av--lg"
      : size === "xl"
      ? "av av--xl"
      : "av";
  const bg = color || colorFromName(name || "?");
  return (
    <span className={cls} style={{ background: bg, ...style }}>
      {initialsOf(name)}
    </span>
  );
}

interface SparkProps {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
  fill?: string;
}

export function Spark({
  data,
  color = "var(--accent-cyan)",
  w = 80,
  h = 28,
  fill,
}: SparkProps) {
  const path = useMemo(() => {
    if (!data?.length) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    return data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - min) / range) * (h - 2) - 1;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }, [data, w, h]);
  const area = useMemo(() => {
    if (!data?.length || !fill) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    let d = `M 0 ${h}`;
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    d += ` L ${w} ${h} Z`;
    return d;
  }, [data, w, h, fill]);
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {fill && <path d={area} fill={fill} stroke="none" />}
      <path d={path} stroke={color} />
    </svg>
  );
}

export type ChannelType = "voice" | "chat" | "wa" | "sms" | "email";

const CHANNEL_META: Record<
  ChannelType,
  { cls: string; label: string; iconPath: ReactNode }
> = {
  voice: {
    cls: "ch--voice",
    label: "Voz",
    iconPath: (
      <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z" />
    ),
  },
  chat: {
    cls: "ch--chat",
    label: "Chat",
    iconPath: <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />,
  },
  wa: {
    cls: "ch--wa",
    label: "WhatsApp",
    iconPath: (
      <>
        <path d="M21 12a9 9 0 0 1-13.7 7.7L3 21l1.4-4.3A9 9 0 1 1 21 12z" />
        <path d="M9 9c0 4 3 7 7 7l1.5-1.5-2-2-1 .5a4 4 0 0 1-2-2l.5-1-2-2z" />
      </>
    ),
  },
  sms: {
    cls: "ch--sms",
    label: "SMS",
    iconPath: (
      <>
        <path d="M21 12a8 8 0 0 1-13 6.5L3 20l1.5-5A8 8 0 1 1 21 12z" />
        <path d="M8 11h.01M12 11h.01M16 11h.01" />
      </>
    ),
  },
  email: {
    cls: "ch--email",
    label: "Email",
    iconPath: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 7 9-7" />
      </>
    ),
  },
};

interface ChannelChipProps {
  type: ChannelType;
  sm?: boolean;
}

export function ChannelChip({ type, sm }: ChannelChipProps) {
  const c = CHANNEL_META[type] ?? CHANNEL_META.voice;
  return (
    <span
      className={`ch ${c.cls}`}
      title={c.label}
      style={sm ? { width: 18, height: 18 } : undefined}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        width="12"
        height="12"
      >
        {c.iconPath}
      </svg>
    </span>
  );
}

interface KpiProps {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaDir?: "up" | "down" | "flat";
  spark?: number[];
  color?: string;
}

export function Kpi({
  label,
  value,
  delta,
  deltaDir = "up",
  spark,
  color = "var(--accent-cyan)",
}: KpiProps) {
  const cls =
    deltaDir === "up"
      ? "kpi__delta--up"
      : deltaDir === "down"
      ? "kpi__delta--down"
      : "kpi__delta--flat";
  // Show an arrow only for real trends. Bug #21: an up-arrow with value 0
  // and "flat" KPIs (placeholder dashes) used to be misleading — now flat
  // dirs and empty/placeholder deltas render no arrow.
  const arrow =
    deltaDir === "up" ? (
      <ArrowUp size={11} />
    ) : deltaDir === "down" ? (
      <ArrowDown size={11} />
    ) : null;
  const deltaIsPlaceholder =
    typeof delta === "string" && (delta.trim() === "" || delta.trim() === "—");
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      {delta && !deltaIsPlaceholder && (
        <div className={`kpi__delta ${cls}`}>
          {arrow} {delta}
        </div>
      )}
      {spark && (
        <div className="kpi__spark">
          <Spark
            data={spark}
            color={color}
            w={72}
            h={26}
            fill={
              color.includes("green")
                ? "var(--accent-green-soft)"
                : color.includes("amber")
                ? "var(--accent-amber-soft)"
                : "var(--accent-cyan-soft)"
            }
          />
        </div>
      )}
    </div>
  );
}

const STATUS_MAP: Record<string, string> = {
  Activo: "chip--green",
  Resuelto: "chip--green",
  OK: "chip--green",
  Disponible: "chip--green",
  "En curso": "chip--cyan",
  "En proceso": "chip--cyan",
  "En llamada": "chip--cyan",
  "En riesgo": "chip--red",
  Crítica: "chip--red",
  Alta: "chip--amber",
  Media: "chip--cyan",
  Baja: "chip--green",
  Pausada: "chip--amber",
  Pausado: "chip--amber",
  Break: "chip--amber",
  ACW: "chip--violet",
  Programada: "chip--violet",
  Renovación: "chip--violet",
  Lead: "chip--cyan",
  "Caso abierto": "chip--amber",
  Abierto: "chip--amber",
  "Esperando cliente": "chip--violet",
  "No conectado": "chip--red",
};

export function StatusPill({ status }: { status: string }) {
  const cls = STATUS_MAP[status] || "";
  return (
    <span className={`chip ${cls}`}>
      <span className="dot" />
      {status}
    </span>
  );
}

/* ============================================================
   Icon set (stroked SVGs at 24x24)
   ============================================================ */

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function makeIcon(content: ReactNode) {
  return function IconImpl({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        width={size}
        height={size}
        {...rest}
      >
        {content}
      </svg>
    );
  };
}

export const Home = makeIcon(
  <>
    <path d="M3 11L12 4l9 7" />
    <path d="M5 10v10h14V10" />
  </>
);
export const Phone = makeIcon(
  <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z" />
);
export const PhoneIn = makeIcon(
  <>
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z" />
    <path d="M16 8l5-5" />
    <path d="M16 3h5v5" />
  </>
);
export const Users = makeIcon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 19c.5-3 3-5 6.5-5s6 2 6.5 5" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16 14c2.5 0 4.5 1.5 5 4" />
  </>
);
export const User = makeIcon(
  <>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4 20c.8-4 4-6 8-6s7.2 2 8 6" />
  </>
);
export const ContactCard = makeIcon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2" />
    <path d="M5.5 17c.5-2 2-3 3.5-3s3 1 3.5 3" />
    <path d="M14 9h5M14 12h5M14 15h3" />
  </>
);
export const Queue = makeIcon(
  <>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <rect x="3" y="10" width="18" height="4" rx="1" />
    <rect x="3" y="16" width="18" height="4" rx="1" />
  </>
);
export const Eye = makeIcon(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const Ticket = makeIcon(
  <>
    <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 1 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 1 0 0-4z" />
    <path d="M13 6v12" strokeDasharray="2 2" />
  </>
);
export const Megaphone = makeIcon(
  <>
    <path d="M3 11v2l11 5V6L3 11z" />
    <path d="M14 8a3 3 0 0 1 0 8" />
    <path d="M5 14l2 5" />
  </>
);
export const Workflow = makeIcon(
  <>
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
    <rect x="9" y="15" width="6" height="6" rx="1" />
    <path d="M6 9v3h12V9" />
    <path d="M12 12v3" />
  </>
);
export const Chart = makeIcon(
  <>
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <rect x="7" y="13" width="3" height="6" />
    <rect x="12" y="9" width="3" height="10" />
    <rect x="17" y="6" width="3" height="13" />
  </>
);
export const Knowledge = makeIcon(
  <>
    <path d="M4 5a2 2 0 0 1 2-2h11v18H6a2 2 0 0 1-2-2z" />
    <path d="M8 7h7M8 10h5" />
  </>
);
export const Settings = makeIcon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2L10 21h4l.6-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c0-.4.1-.8.1-1.2z" />
  </>
);
export const Search = makeIcon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M16.5 16.5L21 21" />
  </>
);
export const Bell = makeIcon(
  <>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </>
);
export const Plus = makeIcon(<path d="M12 5v14M5 12h14" />);
export const Sparkles = makeIcon(
  <>
    <path d="M12 3l1.5 4L17 8.5 13.5 10 12 14l-1.5-4L7 8.5 10.5 7z" />
    <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7z" />
  </>
);
export const Mic = makeIcon(
  <>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </>
);
export const MicOff = makeIcon(
  <>
    <path d="M3 3l18 18" />
    <path d="M9 9v3a3 3 0 0 0 5.1 2.1" />
    <path d="M15 11V6a3 3 0 0 0-5.7-1.3" />
    <path d="M5 11a7 7 0 0 0 11 5.7" />
    <path d="M19 11a7 7 0 0 1-.5 2.6" />
    <path d="M12 18v3" />
  </>
);
export const Pause = makeIcon(
  <>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </>
);
export const Transfer = makeIcon(<path d="M4 8h13l-3-3M20 16H7l3 3" />);
export const Pad = makeIcon(
  <>
    <circle cx="6" cy="6" r="1.4" />
    <circle cx="12" cy="6" r="1.4" />
    <circle cx="18" cy="6" r="1.4" />
    <circle cx="6" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="18" cy="12" r="1.4" />
    <circle cx="6" cy="18" r="1.4" />
    <circle cx="12" cy="18" r="1.4" />
    <circle cx="18" cy="18" r="1.4" />
  </>
);
export const Record = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" fill="currentColor" />
  </>
);
export const Note = makeIcon(
  <>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </>
);
export const Calendar = makeIcon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>
);
export const Mail = makeIcon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 7 9-7" />
  </>
);
export const Chat = makeIcon(
  <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />
);
export const Sms = makeIcon(
  <>
    <path d="M21 12a8 8 0 0 1-13 6.5L3 20l1.5-5A8 8 0 1 1 21 12z" />
    <path d="M8 11h.01M12 11h.01M16 11h.01" />
  </>
);
export const WhatsApp = makeIcon(
  <>
    <path d="M21 12a9 9 0 0 1-13.7 7.7L3 21l1.4-4.3A9 9 0 1 1 21 12z" />
    <path d="M9 9c0 4 3 7 7 7l1.5-1.5-2-2-1 .5a4 4 0 0 1-2-2l.5-1-2-2z" />
  </>
);
export const Globe = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>
);
export const Building = makeIcon(
  <>
    <rect x="4" y="3" width="16" height="18" rx="1" />
    <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-4h4v4" />
  </>
);
export const Tag = makeIcon(
  <>
    <path d="M3 12l9 9 9-9-9-9H3v9z" />
    <circle cx="8" cy="8" r="1.5" />
  </>
);
export const Cloud = makeIcon(
  <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
);
export const Star = makeIcon(
  <path d="M12 3l2.7 5.6L21 9.5l-4.5 4.4L17.5 21 12 17.8 6.5 21 7.5 13.9 3 9.5l6.3-.9z" />
);
export const Check = makeIcon(<path d="M5 12l5 5L20 7" />);
export const ChevDown = makeIcon(<path d="M6 9l6 6 6-6" />);
export const ChevRight = makeIcon(<path d="M9 6l6 6-6 6" />);
export const ArrowUp = makeIcon(
  <>
    <path d="M12 19V5" />
    <path d="M6 11l6-6 6 6" />
  </>
);
export const ArrowDown = makeIcon(
  <>
    <path d="M12 5v14" />
    <path d="M6 13l6 6 6-6" />
  </>
);
export const More = makeIcon(
  <>
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </>
);
export const Filter = makeIcon(<path d="M3 5h18l-7 9v5l-4 2v-7z" />);
export const Refresh = makeIcon(
  <>
    <path d="M4 12a8 8 0 0 1 14-5.3L21 9" />
    <path d="M21 4v5h-5" />
    <path d="M20 12a8 8 0 0 1-14 5.3L3 15" />
    <path d="M3 20v-5h5" />
  </>
);
export const Sun = makeIcon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
  </>
);
export const Moon = makeIcon(<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z" />);
export const Lightning = makeIcon(
  <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
);
export const Headset = makeIcon(
  <>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2z" />
    <path d="M20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z" />
    <path d="M17 18a4 4 0 0 1-4 4h-2" />
  </>
);
export const Flag = makeIcon(
  <>
    <path d="M5 21V4" />
    <path d="M5 4h12l-2 4 2 4H5" />
  </>
);
export const Activity = makeIcon(<path d="M3 12h4l3-8 4 16 3-8h4" />);
export const Shield = makeIcon(
  <>
    <path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" />
  </>
);
export const Close = makeIcon(<path d="M6 6l12 12M18 6L6 18" />);
export const ArrowLeft = makeIcon(<path d="M19 12H5M12 19l-7-7 7-7" />);
export const Play = makeIcon(<path d="M6 4l14 8-14 8z" />);
export const Stop = makeIcon(<path d="M6 6h12v12H6z" />);
export const Pencil = makeIcon(
  <>
    <path d="M11 4h-7v16h16v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </>
);
export const Copy = makeIcon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>
);
export const Trash = makeIcon(
  <>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </>
);
export const Clock = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
);
export const Download = makeIcon(<path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />);
export const Send = makeIcon(
  <>
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4z" />
  </>
);
export const Disc = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const Logout = makeIcon(
  <>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 17l-5-5 5-5" />
    <path d="M15 12H5" />
  </>
);
export const Hangup = makeIcon(
  <g style={{ transform: "rotate(135deg)", transformOrigin: "center" }}>
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z" />
  </g>
);

/* ============================================================
   Layout primitives — Card, Section title
   ============================================================ */

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

export function CardHead({
  title,
  sub,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="card__head">
      <div className="card__title">{title}</div>
      {sub && <span className="card__sub">{sub}</span>}
      {right}
    </div>
  );
}

export function CardBody({
  children,
  flush,
  style,
}: {
  children: ReactNode;
  flush?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className={`card__body ${flush ? "card__body--flush" : ""}`} style={style}>
      {children}
    </div>
  );
}
