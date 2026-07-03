/* ============================================================
   ARIA · Agent Cockpit — barrel
   Módulo del cockpit estilo handoff. Dos usos:
     • MODO DEMO (self-contained, data mock): AgentCockpitDemo.
     • REDISEÑO EN-LLAMADA REAL: CallBar / Transcript reutilizados
       con datos reales del softphone.
   ============================================================ */
import "./cockpit.css";

export { AgentCockpitDemo, DEMO_STATES } from "./AgentCockpitDemo";
export type { DemoState } from "./AgentCockpitDemo";
export { CallBar, CBtn } from "./CallBar";
export type { CallBarProps } from "./CallBar";
export { Transcript } from "./Transcript";
export { Wave, Senti, Net } from "./primitives";
export type { DemoTx } from "./mockData";
// Variantes REALES (datos de Amazon Connect) del entrante y saliente —
// reutilizan el markup del handoff pero se alimentan por props reales.
export { RingReal } from "./RingReal";
export { ConnectingReal } from "./ConnectingReal";
