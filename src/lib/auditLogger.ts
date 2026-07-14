/**
 * auditLogger — colector global best-effort para la prueba en vivo con agentes.
 *
 * Objetivo: capturar TODO lo que puede fallarle a un agente en su navegador
 * (errores JS, promesas colgadas, console.error/warn, respuestas HTTP >=400,
 * y eventos manuales del softphone) y mandarlo por batch a una Function URL de
 * auditoría para verlo en vivo desde /audit.
 *
 * REGLA DE ORO: este módulo JAMÁS debe romper la app. Cada punto de captura y
 * cada envío va envuelto en try/catch; si el endpoint no está cableado, todo se
 * descarta en silencio (no-op). No cambia el comportamiento de fetch/console:
 * siempre delega en el original y devuelve/relanza lo mismo.
 *
 * El endpoint vive en `getApiEndpoints()?.auditLog` (opcional). Se lee en cada
 * flush → si el backend aún no lo agregó, simplemente no enviamos.
 */
import { getApiEndpoints } from "@/lib/api";

export type AuditLevel = "error" | "warn" | "info";

export interface AuditEvent {
  ts: string;
  level: AuditLevel;
  kind: string;
  message: string;
  detail?: unknown;
}

// ── Config del buffer/flush ──────────────────────────────────────────────
const MAX_BUFFER = 500; // tope duro: nunca crecemos sin límite (best-effort)
const FLUSH_AT = 25; // enviamos apenas acumulamos esta cantidad
const FLUSH_INTERVAL_MS = 4000; // …o cada 4s, lo que ocurra primero
const MAX_MESSAGE = 2000; // recorte defensivo de mensajes largos
const MAX_STACK = 1200; // recorte de stacks

// ── Estado del módulo ────────────────────────────────────────────────────
let buffer: AuditEvent[] = [];
let initialized = false;
let flushing = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let source = "frontend";
let cachedSessionId: string | null = null;
// Guardamos el fetch original para enviar los batches SIN pasar por nuestro
// propio wrapper (evita cualquier riesgo de recursión con el logging de red).
let originalFetch: typeof window.fetch | null = null;

const SESSION_KEY = "aria.audit.sid";

/** Lee la Function URL de auditoría. Se accede con un cast tolerante para no
 *  depender de que `auditLog` ya esté declarado en la interfaz ApiEndpoints
 *  (el backend lo agrega en paralelo). Devuelve undefined si aún no existe. */
function auditEndpoint(): string | undefined {
  try {
    const ep = getApiEndpoints();
    if (!ep) return undefined;
    return (ep as { auditLog?: string }).auditLog;
  } catch {
    return undefined;
  }
}

/** sessionId estable por pestaña (persistido en sessionStorage). */
export function getAuditSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      cachedSessionId = existing;
      return existing;
    }
  } catch {
    /* sessionStorage no disponible → id efímero en memoria */
  }
  const id = "aud-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  cachedSessionId = id;
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* noop */
  }
  return id;
}

/** Fija el `source` de los eventos (ej. username/rol del agente). */
export function setAuditSource(src: string): void {
  try {
    if (src && typeof src === "string") source = src;
  } catch {
    /* noop */
  }
}

/** Detalle seguro para JSON: si no serializa, lo degradamos a string. Evita que
 *  un solo detail con referencias circulares rompa el batch entero al enviarse. */
function safeDetail(detail: unknown): unknown {
  if (detail === undefined) return undefined;
  try {
    JSON.stringify(detail);
    return detail;
  } catch {
    try {
      return String(detail);
    } catch {
      return "[detalle no serializable]";
    }
  }
}

/** Registro manual/programático (usado por el CCP y la captura automática). */
export function logAudit(level: AuditLevel, kind: string, message: string, detail?: unknown): void {
  try {
    const evt: AuditEvent = {
      ts: new Date().toISOString(),
      level,
      kind,
      message: String(message ?? "").slice(0, MAX_MESSAGE),
      detail: safeDetail(detail),
    };
    buffer.push(evt);
    // Tope duro: si crecimos por encima del máximo (p. ej. un bucle de errores
    // entre flushes), conservamos solo los más recientes.
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
    if (buffer.length >= FLUSH_AT) void flush();
  } catch {
    /* el logging jamás debe lanzar */
  }
}

/** Envía el batch acumulado. `viaBeacon` se usa en el cierre de la pestaña. */
async function flush(viaBeacon = false): Promise<void> {
  if (flushing && !viaBeacon) return;
  try {
    const endpoint = auditEndpoint();
    if (!endpoint) {
      // Sin endpoint cableado → descartamos en silencio (no acumulamos infinito).
      buffer = [];
      return;
    }
    if (buffer.length === 0) return;

    const batch = buffer;
    buffer = [];
    const body = JSON.stringify({
      sessionId: getAuditSessionId(),
      source,
      events: batch,
    });

    // Cierre de pestaña: preferimos sendBeacon (sobrevive al unload); si no
    // existe o falla, caemos a fetch con keepalive.
    if (viaBeacon) {
      try {
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          const ok = navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
          if (ok) return;
        }
      } catch {
        /* cae a fetch keepalive */
      }
      try {
        const f = originalFetch || window.fetch.bind(window);
        void f(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        });
      } catch {
        /* best-effort: se pierde el batch */
      }
      return;
    }

    flushing = true;
    const f = originalFetch || window.fetch.bind(window);
    await f(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch {
    /* best-effort: si el POST falla, el batch ya salió del buffer y se pierde */
  } finally {
    flushing = false;
  }
}

/** Convierte los args de console.* a un mensaje de texto seguro. */
function argsToText(args: unknown[]): string {
  try {
    return args
      .map((a) => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ")
      .slice(0, MAX_MESSAGE);
  } catch {
    return "console";
  }
}

function readUrl(input: RequestInfo | URL): string {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  } catch {
    return "";
  }
}

function readMethod(input: RequestInfo | URL, init?: RequestInit): string {
  try {
    if (init?.method) return init.method.toUpperCase();
    if (typeof input !== "string" && !(input instanceof URL)) {
      return (input.method || "GET").toUpperCase();
    }
  } catch {
    /* noop */
  }
  return "GET";
}

/**
 * initAuditLogger — instala toda la captura automática. Idempotente: llamarlo
 * más de una vez es no-op. Best-effort de punta a punta.
 */
export function initAuditLogger(): void {
  if (initialized) return;
  initialized = true;

  if (typeof window === "undefined") return;

  // 1) Errores JS no capturados.
  try {
    window.addEventListener("error", (e: ErrorEvent) => {
      try {
        const stack = e.error instanceof Error && e.error.stack ? String(e.error.stack) : undefined;
        logAudit("error", "js", e.message || "Error no capturado", {
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          stack: stack ? stack.slice(0, MAX_STACK) : undefined,
        });
      } catch {
        /* noop */
      }
    });
  } catch {
    /* noop */
  }

  // 2) Promesas rechazadas sin catch.
  try {
    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
      try {
        const r: unknown = e.reason;
        const message =
          r instanceof Error ? r.message : typeof r === "string" ? r : "Promesa rechazada";
        const stack =
          r instanceof Error && r.stack ? String(r.stack).slice(0, MAX_STACK) : undefined;
        logAudit("error", "promise", message, { stack });
      } catch {
        /* noop */
      }
    });
  } catch {
    /* noop */
  }

  // 3) Parche de console.error / console.warn (preservando el original).
  try {
    const originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      try {
        logAudit("error", "console", argsToText(args));
      } catch {
        /* noop */
      }
      originalConsoleError(...args);
    };
    const originalConsoleWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      try {
        logAudit("warn", "console", argsToText(args));
      } catch {
        /* noop */
      }
      originalConsoleWarn(...args);
    };
  } catch {
    /* noop */
  }

  // 4) Wrapper de fetch: registra respuestas >=400 y fetch que lanzan. NUNCA
  //    registramos las llamadas al propio endpoint de auditoría (evita bucle).
  try {
    originalFetch = window.fetch.bind(window);
    const wrapped = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const base = originalFetch as typeof window.fetch;
      let isAudit = false;
      let url = "";
      let method = "GET";
      try {
        url = readUrl(input);
        method = readMethod(input, init);
        const auditUrl = auditEndpoint();
        isAudit = !!auditUrl && !!url && url.startsWith(auditUrl);
      } catch {
        /* si no pudimos inspeccionar, seguimos como fetch normal */
      }
      return base(input, init).then(
        (res) => {
          try {
            if (!isAudit && res.status >= 400) {
              logAudit(
                res.status >= 500 ? "error" : "warn",
                "network",
                `${method} ${res.status} ${url}`,
                {
                  url,
                  method,
                  status: res.status,
                },
              );
            }
          } catch {
            /* noop */
          }
          return res;
        },
        (err: unknown) => {
          try {
            if (!isAudit) {
              logAudit("error", "network", `${method} falló ${url}`, {
                url,
                method,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } catch {
            /* noop */
          }
          throw err;
        },
      );
    };
    window.fetch = wrapped as typeof window.fetch;
  } catch {
    /* noop → la app sigue con el fetch nativo */
  }

  // 5) Flush por intervalo.
  try {
    flushTimer = setInterval(() => {
      void flush();
    }, FLUSH_INTERVAL_MS);
  } catch {
    /* noop */
  }

  // 6) Flush al ocultar/cerrar la pestaña (sendBeacon / keepalive).
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flush(true);
    });
    window.addEventListener("beforeunload", () => {
      void flush(true);
    });
  } catch {
    /* noop */
  }
}

/** Detiene el flush por intervalo (para tests/HMR). No revierte los parches. */
export function stopAuditLogger(): void {
  try {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  } catch {
    /* noop */
  }
}
