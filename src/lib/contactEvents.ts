/**
 * contactEvents — bus ligero de eventos de contacto.
 *
 * Des-siloíza el tiempo real: hoy los eventos de Amazon Connect Streams viven
 * DENTRO de CCPContext y solo mueven el softphone; la capa de datos (leads,
 * reportes, historial, dashboard) es pull-based y NO reacciona al fin de un
 * contacto. Este bus deja que los PRODUCTORES (CCPContext, wrap-up, inbox)
 * emitan y las VISTAS de datos se auto-refresquen.
 *
 * Cross-tab con BroadcastChannel: como el softphone vive en 1 sola pestaña
 * (Web Locks), una llamada que termina ahí refresca los reportes abiertos en
 * OTRA pestaña. Fail-safe si el navegador no soporta BroadcastChannel (SSR/old).
 */
import { useEffect, useRef } from "react";

export type ContactEvent =
  | { type: "contact:ended"; contactId?: string; channel?: string }
  | { type: "wrapup:saved"; contactId?: string; leadId?: string }
  | { type: "lead:updated"; leadId?: string }
  | { type: "conversation:changed"; conversationId?: string };

export type ContactEventType = ContactEvent["type"];

type Handler = (e: ContactEvent) => void;
const handlers = new Set<Handler>();

let channel: BroadcastChannel | null = null;
try {
  channel = new BroadcastChannel("aria.contact-events");
  channel.onmessage = (m: MessageEvent<ContactEvent>) => {
    // Eventos de OTRA pestaña: notifica solo a los suscriptores locales (no
    // re-emitir al canal, para no crear un eco infinito entre pestañas).
    handlers.forEach((h) => h(m.data));
  };
} catch {
  /* BroadcastChannel no disponible → solo bus en-memoria de esta pestaña */
}

/** Emite un evento: a los suscriptores de ESTA pestaña + al resto vía canal. */
export function emitContactEvent(e: ContactEvent): void {
  handlers.forEach((h) => h(e));
  try {
    channel?.postMessage(e);
  } catch {
    /* noop */
  }
}

/** Suscribe un handler. Devuelve la función para desuscribir. */
export function onContactEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/**
 * Hook: ejecuta `handler` cuando llega un evento del bus (opcionalmente filtrado
 * por tipo). La suscripción es estable (no se re-crea con cada render): usa un
 * ref para leer siempre el handler más reciente.
 */
export function useContactEvents(
  handler: (e: ContactEvent) => void,
  types?: ContactEventType[],
): void {
  const ref = useRef(handler);
  ref.current = handler;
  const typesKey = types?.join(",") ?? "";
  useEffect(() => {
    const allow = types && types.length ? new Set<ContactEventType>(types) : null;
    return onContactEvent((e) => {
      if (!allow || allow.has(e.type)) ref.current(e);
    });
    // typesKey estabiliza la lista de tipos sin recrear la suscripción por identidad de array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesKey]);
}
