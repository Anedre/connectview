import {
  Play,
  MessageSquare,
  List,
  HelpCircle,
  GitBranch,
  LayoutTemplate,
  Clock,
  Tag,
  UserRound,
  StickyNote,
  Webhook,
  CornerUpRight,
  CircleStop,
  Bot,
  Plus,
  CalendarDays,
  PhoneCall,
  Star,
  Gift,
  Image,
  CalendarClock,
  CalendarCheck,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for flow-builder icons, keyed by the string keys used
 * in the botFlow catalog (NodeKindDef.icon) and the template catalog
 * (BotTemplate.icon). Shared by StepNode, the palette, the inspector and the
 * bots list/picker so the iconography stays consistent everywhere.
 */
export const FLOW_ICONS: Record<string, LucideIcon> = {
  play: Play,
  message: MessageSquare,
  list: List,
  help: HelpCircle,
  branch: GitBranch,
  template: LayoutTemplate,
  clock: Clock,
  tag: Tag,
  agent: UserRound,
  note: StickyNote,
  webhook: Webhook,
  jump: CornerUpRight,
  stop: CircleStop,
  bot: Bot,
  plus: Plus,
  calendar: CalendarDays,
  phone: PhoneCall,
  star: Star,
  gift: Gift,
  image: Image,
  hours: CalendarClock,
  appointment: CalendarCheck,
};

export function flowIcon(key: string): LucideIcon {
  return FLOW_ICONS[key] || MessageSquare;
}
