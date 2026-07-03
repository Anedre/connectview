/* ============================================================
   ARIA · Icon set  ·  API <Icon name="…"/>
   Los glyphs se renderizan con Phosphor DUOTONE (2 tonos, con
   profundidad) — un set con mejor arte y color que hereda el color
   del contexto (en chips de color se tiñe; en botones, mono). Los
   nombres sin equivalente Phosphor caen al path SVG original (abajo),
   así ningún `<Icon>` de la app se rompe.
   ============================================================ */
import type { CSSProperties, ComponentType } from "react";
import {
  Phone, MagnifyingGlass, Sparkle, X, Check, ChatsCircle, ChatCircle,
  ArrowRight, Path, Megaphone, Users, User, Tag, Plus, SquaresFour,
  Copy, Clock, CaretRight, CaretLeft, CaretDown, CaretUp, CalendarBlank,
  Lightning, TrendUp, Play, Pause, Paperclip, PhoneX, Envelope, Stack,
  Globe, House, Headset, Tray, GraduationCap, UserPlus, Robot, Microphone,
  GearSix, ArrowsClockwise, WhatsappLogo, ClockCounterClockwise,
  DownloadSimple, UploadSimple, ArrowSquareOut, Bell, Moon, Sun, Gauge,
  CheckCircle, Funnel, DotsThree, FileText, Image as ImageIcon, PaperPlaneRight,
  Buildings, ShareNetwork, Target, MapPin, Command, Question, BookOpen,
  Compass, Eye, Lock, ShieldCheck, SlidersHorizontal, DotsSixVertical,
  Star, Flame, PushPin, SignOut, MagicWand, Handshake, Backspace,
  Broadcast, ArrowDownLeft, ArrowUpRight, ChartBar, FlowArrow,
  type IconProps as PhIconProps,
} from "@phosphor-icons/react";

/** Peso Phosphor — duotone por defecto (premium, con profundidad). */
export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

/** ARIA name → componente Phosphor. Lo no mapeado usa el path SVG de abajo. */
const PH: Record<string, ComponentType<PhIconProps>> = {
  phone: Phone, search: MagnifyingGlass, sparkle: Sparkle, x: X, check: Check,
  chats: ChatsCircle, chat: ChatCircle, arrowRight: ArrowRight, route: Path,
  megaphone: Megaphone, users: Users, user: User, tag: Tag, plus: Plus,
  grid: SquaresFour, copy: Copy, clock: Clock, chevR: CaretRight, chevL: CaretLeft,
  chevD: CaretDown, chevU: CaretUp, calendar: CalendarBlank, zap: Lightning,
  trending: TrendUp, play: Play, pause: Pause, paperclip: Paperclip, missed: PhoneX,
  mail: Envelope, layers: Stack, globe: Globe, home: House, headset: Headset,
  inbox: Tray, cap: GraduationCap, userplus: UserPlus, bot: Robot, robot2: Robot,
  mic: Microphone, settings: GearSix, refresh: ArrowsClockwise, wa: WhatsappLogo,
  history: ClockCounterClockwise, download: DownloadSimple, upload: UploadSimple,
  external: ArrowSquareOut, bell: Bell, moon: Moon, sun: Sun, gauge: Gauge,
  checkCircle: CheckCircle, filter: Funnel, funnel: Funnel, more: DotsThree,
  fileText: FileText, image: ImageIcon, send: PaperPlaneRight, building: Buildings,
  share: ShareNetwork, target: Target, mapPin: MapPin, command: Command,
  help: Question, book: BookOpen, compass: Compass, eye: Eye, lock: Lock,
  shield: ShieldCheck, sliders: SlidersHorizontal, grip: DotsSixVertical,
  star: Star, flame: Flame, pin: PushPin, logout: SignOut, wand: MagicWand,
  bolt: Lightning, handshake: Handshake, backspace: Backspace, live: Broadcast,
  arrowIn: ArrowDownLeft, arrowOut: ArrowUpRight, chart: ChartBar, flow: FlowArrow,
};

export const ARIA_ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5",
  headset:
    "M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h1v-5H4Zm16 0a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1v-5h1Zm-1 5a4 4 0 0 1-4 4h-2",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6L5 5Z",
  chats: "M8 10h8M8 14h5M21 11.5a8 8 0 0 1-11.5 7.2L3 21l2.3-6.5A8 8 0 1 1 21 11.5Z",
  live: "M3 5h18M3 12h18M3 19h18",
  layers: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  cap: "M22 10 12 5 2 10l10 5 10-5ZM6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5M22 10v6",
  userplus:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6",
  megaphone: "m3 11 14-7v16l-7-3.5M3 11v3a1 1 0 0 0 1 1h2l1 5h3l-1-6M3 11h7",
  bot: "M12 8V4m0 0h-1m1 0h1M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm3 5h.01M16 13h.01",
  flow: "M4 3h5v5H4zM15 16h5v5h-5zM6.5 8v4a2 2 0 0 0 2 2h6.5M9 5.5h6a2 2 0 0 1 2 2v8",
  zap: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  sparkle: "m12 3 1.9 5.5L19.5 10l-5.6 1.5L12 17l-1.9-5.5L4.5 10l5.6-1.5L12 3Z",
  calendar: "M8 2v4M16 2v4M3 9h18M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  chart: "M3 3v18h18M8 17v-5M13 17V7M18 17v-8",
  mic: "M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.13-1.4l2-1.55-2-3.46-2.36.95A7.9 7.9 0 0 0 15 4.6L14.66 2H9.34L9 4.6a7.9 7.9 0 0 0-2.5 1.44L4.13 5.1l-2 3.46 2 1.55a8 8 0 0 0 0 2.8l-2 1.55 2 3.46 2.36-.95A7.9 7.9 0 0 0 9 19.4L9.34 22h5.32L15 19.4a7.9 7.9 0 0 0 2.5-1.44l2.36.95 2-3.46-2-1.55c.09-.46.13-.93.13-1.4Z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.3-4.3",
  refresh: "M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5",
  phone: "M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L16 11l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z",
  chat: "M21 11.5a8 8 0 0 1-11.5 7.2L3 21l2.3-6.5A8 8 0 1 1 21 11.5Z",
  wa: "M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm-3 6c.2 0 .5 0 .7.5l.8 2c.1.3 0 .5-.1.7l-.5.6c-.2.2-.3.4-.1.7a7 7 0 0 0 3.3 3c.3.1.5 0 .7-.1l.6-.7c.2-.2.4-.2.6-.1l1.9.9c.3.1.4.3.4.6 0 1-1 2-2 2A9 9 0 0 1 7 12c0-1 .9-2 2-2Z",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 2 8 6 8-6",
  paperclip: "M21 8.5 12.5 17a4 4 0 0 1-6-5.5l8-8a3 3 0 0 1 4 4l-8 8a1.5 1.5 0 0 1-2-2l7-7",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l4 2",
  chevR: "m9 6 6 6-6 6",
  chevL: "m15 6-6 6 6 6",
  chevD: "m6 9 6 6 6-6",
  chevU: "m18 15-6-6-6 6",
  backspace: "M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z|M18 9l-6 6|M12 9l6 6",
  play: "M6 4l14 8-14 8V4Z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  x: "M6 6l12 12M18 6 6 18",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 19h16",
  upload: "M12 21V9m0 0 4 4m-4-4-4 4M4 5h16",
  external: "M14 4h6v6M20 4l-9 9M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6",
  bell: "M18 9a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7M10.5 20a2 2 0 0 0 3 0",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  user: "M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11",
  arrowIn: "M17 7 7 17m0 0h8m-8 0V9",
  arrowOut: "M7 17 17 7m0 0H9m8 0v8",
  missed: "m23 1-6 6m0-6 6 6M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L16 11l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z",
  gauge: "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm1.5-1.5L19 7M5 19a9 9 0 1 1 14 0",
  check: "M5 12l5 5L20 7",
  checkCircle: "M22 11.5V12a10 10 0 1 1-5.9-9.1M22 4 12 14.1l-3-3",
  plus: "M12 5v14M5 12h14",
  filter: "M3 5h18l-7 8v6l-4-2v-4L3 5Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  fileText: "M14 3v5h5M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM9 13h6M9 17h6",
  image: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 12 5-5 4 4 3-3 5 5M9 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  tag: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Zm5-4h.01",
  trending: "M22 7 13.5 15.5l-4-4L2 19M16 7h6v6",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  building: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h.01M8 12h.01M8 16h.01M12 8h.01M12 12h.01",
  share: "M16 6l-4-4-4 4M12 2v13M20 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  funnel: "M3 4h18l-7 9v6l-4 2v-8L3 4Z",
  mapPin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  dot: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  arrowRight: "M5 12h14m0 0-6-6m6 6-6 6",
  command: "M18 6a3 3 0 1 0-3 3h-6a3 3 0 1 0 3-3v6a3 3 0 1 0 3-3H9a3 3 0 1 0-3 3",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2-11a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.6M12 17h.01",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm2 13h13",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM13 13h7v7h-7zM4 13h7v7H4z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  lock: "M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm2 0V7a5 5 0 0 1 10 0v4",
  shield: "M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z",
  route: "M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12-10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 13v-1a4 4 0 0 1 4-4h5",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  copy: "M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  star: "M12 3l2.5 5.5L20 9.2l-4 4 1 5.8-5-2.8-5 2.8 1-5.8-4-4 5.5-.7L12 3Z",
  flame: "M12 22a7 7 0 0 0 7-7c0-3-2-5-3-7-1.5 2-3 2.5-3 1 0-2 1-3 0-6-2 1-8 4-8 12a7 7 0 0 0 7 7Z",
  pin: "M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 15v5",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  robot2: "M12 8V5M5 8h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Zm4 5v2m6-2v2",
  wand: "m15 4 1 1M9 15 4 20M13 6l5 5L9 20l-5-5 9-9ZM18 3l.5 1.5L20 5l-1.5.5L18 7l-.5-1.5L16 5l1.5-.5L18 3Z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  bolt: "M11 2 4 13h6l-1 9 7-11h-6l1-9Z",
  handshake: "m11 17 2 2a1 1 0 0 0 3-3M4 10l4-4 4 3 4-3 4 4M4 10v4l4 4M20 10v4l-2 2",
};

export type IconName = keyof typeof ARIA_ICONS;

interface IconProps {
  name: IconName | string;
  size?: number;
  stroke?: number;
  fill?: string;
  style?: CSSProperties;
  className?: string;
  /** Peso Phosphor. Default "duotone" (premium). */
  weight?: IconWeight;
}

export function Icon({ name, size = 18, stroke = 2, fill = "none", style, className, weight = "duotone" }: IconProps) {
  // 1) Phosphor duotone (glyph premium) si hay equivalente.
  const P = PH[name];
  if (P) {
    return <P size={size} weight={weight} style={style} className={className} aria-hidden />;
  }
  // 2) Fallback: path SVG original del set ARIA (nada se rompe).
  const d = ARIA_ICONS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {d.split("|").map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}
