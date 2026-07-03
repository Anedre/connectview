/* ARIA design-system building blocks — one import surface for all views. */
export { Icon, ARIA_ICONS } from "./Icon";
export type { IconName } from "./Icon";
export {
  Btn,
  TT,
  Hint,
  Pill,
  Av,
  Card,
  Stat,
  Donut,
  AreaChart,
  MiniBars,
  SegBar,
} from "./primitives";
export type { DonutSeg } from "./primitives";
export { useCountUp, Num, InteractiveArea, Funnel, HeroBand } from "./charts";
export type { FunnelStage } from "./charts";
export { SECTION_COLOR, SectionColorContext, sectionColorFor } from "./sectionColors";
