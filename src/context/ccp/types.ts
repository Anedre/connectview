/**
 * ccp/types — tipos públicos del contexto de softphone (Amazon Connect Streams).
 *
 * Fase 1 del split del "god-context" `CCPContext` (auditoría de flujos 2026-07-09):
 * los tipos que consumen OTROS archivos se extraen aquí (se borran en runtime →
 * cero riesgo de comportamiento). `CCPContext.tsx` los re-exporta para no romper
 * los imports existentes desde `@/context/CCPContext`. La máquina de estados (el
 * provider de ~1.2k líneas) y `CCPContextValue` se partirán en fases posteriores
 * CON banco de pruebas de llamada real — no a ciegas.
 */

export interface ConnectAgentState {
  name: string;
  type: string;
  agentStateARN?: string;
}

/** Lo que el supervisor está monitoreando ahora. `mode` refleja el estado de
 *  monitoreo vivo de Streams (SILENT_MONITOR escuchando, BARGE interviniendo). */
export interface MonitorSession {
  contactId: string;
  mode: "SILENT_MONITOR" | "BARGE";
  /** Capacidades otorgadas a esta sesión (a qué modo puede cambiar). */
  capabilities: string[];
}

/** Proyección mínima de un endpoint de Streams para la UI de Quick Connects.
 *  Guardamos el objeto crudo de streams en `_raw` para que la llamada de
 *  connect no tenga que reconstruirlo. */
export interface QuickConnectEntry {
  name: string;
  type: string;
  endpointARN?: string;
  phoneNumber?: string;
  queue?: string;
  _raw: unknown;
}
