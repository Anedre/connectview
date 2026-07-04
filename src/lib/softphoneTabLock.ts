/**
 * softphoneTabLock — coordina QUÉ pestaña del navegador maneja el softphone
 * (el CCP embebido de Amazon Connect).
 *
 * Por qué: el CCP de Connect solo puede manejarse desde UNA pestaña a la vez.
 * Todas las pestañas de ARIA cargan el mismo iframe de Connect (mismo origen) y
 * Connect usa un `SharedWorker` por origen que mantiene UNA conexión y elige una
 * pestaña "master". Si varias pestañas inician el CCP a la vez, se pelean por ese
 * rol y las perdedoras se cuelgan en "Conectando…" (el `agent-snapshot timeout`).
 *
 * Solución: una sola pestaña toma la propiedad vía **Web Locks API** (el navegador
 * garantiza exclusión mutua y libera el lock automáticamente al cerrar la pestaña
 * → sin locks huérfanos ni heartbeats). Las demás quedan "secundarias" y NO inician
 * el CCP (así no hay contención); el banner les ofrece "Usar acá" para el traspaso.
 */

const LOCK_NAME = "aria:connect:softphone";
const CHANNEL_NAME = "aria:connect:softphone";
const CLAIM_KEY = "aria:connect:softphone:claim";
const CLAIM_TTL_MS = 8000;

/** Id estable por pestaña (sobrevive recargas, muere al cerrar la pestaña). */
function tabId(): string {
  const KEY = "aria:tabId";
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // sessionStorage bloqueado (modo estricto) → id efímero, igual funciona
    // dentro de la misma carga de página.
    return "eph-" + Math.random().toString(36).slice(2);
  }
}

let sharedChannel: BroadcastChannel | null = null;
function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!sharedChannel) sharedChannel = new BroadcastChannel(CHANNEL_NAME);
  return sharedChannel;
}

interface Claim {
  tabId: string;
  ts: number;
}
function readClaim(): Claim | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Claim;
    if (!c?.tabId || typeof c.ts !== "number") return null;
    // Un claim viejo (la pestaña reclamante murió) no debe bloquear a nadie.
    if (Date.now() - c.ts > CLAIM_TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}
function writeClaim(id: string) {
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify({ tabId: id, ts: Date.now() }));
  } catch {
    /* noop */
  }
}
function clearClaim() {
  try {
    localStorage.removeItem(CLAIM_KEY);
  } catch {
    /* noop */
  }
}

export type SoftphoneRole = "owner" | "secondary";

export interface ClaimHandlers {
  /** Éramos dueñas y nos robaron el lock (otra pestaña hizo "Usar acá").
   *  El consumidor termina el CCP y pasa a mostrar el banner de secundaria. */
  onLost: () => void;
  /** Éramos secundarias y la pestaña dueña se cerró → ahora podemos iniciar el
   *  CCP nosotras (relevo automático, sin que el usuario haga nada). */
  onPromoted: () => void;
}

/**
 * Intenta tomar la propiedad del softphone para ESTA pestaña.
 * Resuelve con `role: "owner"` si esta pestaña debe iniciar el CCP, o
 * `role: "secondary"` si ya hay otra pestaña dueña (esta NO debe iniciarlo).
 */
export async function claimSoftphone(handlers: ClaimHandlers): Promise<{ role: SoftphoneRole }> {
  // Navegador sin Web Locks (muy viejo) → degradamos al comportamiento anterior
  // (siempre dueña, sin guard). No rompemos nada; solo no protege multi-pestaña.
  if (!("locks" in navigator) || !navigator.locks?.request) {
    return { role: "owner" };
  }

  const me = tabId();
  const claim = readClaim();
  const iAmClaimant = !!claim && claim.tabId === me;
  const someoneElseClaiming = !!claim && claim.tabId !== me;

  // Si otra pestaña acaba de pulsar "Usar acá" (claim fresco de otra), me quedo
  // secundaria sin siquiera sondear el lock → evito robarle el relevo.
  if (someoneElseClaiming) {
    enqueueWaiter(handlers);
    return { role: "secondary" };
  }

  if (iAmClaimant) clearClaim(); // consumimos el claim propio

  return new Promise<{ role: SoftphoneRole }>((resolve) => {
    let settledOwner = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hold = (lock: any): Promise<void> | void => {
      if (!lock) {
        // Otra pestaña ya es dueña.
        resolve({ role: "secondary" });
        enqueueWaiter(handlers);
        return;
      }
      // Somos dueñas: mantenemos el lock con una promesa que nunca se resuelve
      // (se libera sola al cerrar la pestaña, o rechaza si nos lo roban).
      settledOwner = true;
      resolve({ role: "owner" });
      return new Promise<void>(() => {
        /* held until tab close / steal */
      });
    };

    const req = iAmClaimant
      ? // Reclamante designado (venimos de "Usar acá" + reload): robamos el lock
        // por si el dueño anterior todavía no lo soltó → traspaso determinista.
        navigator.locks.request(LOCK_NAME, { steal: true }, hold)
      : navigator.locks.request(LOCK_NAME, { ifAvailable: true }, hold);

    req.catch(() => {
      // El lock se rompió estando de dueñas → nos lo robaron (otra pestaña
      // hizo "Usar acá"). Avisamos y encolamos un waiter por si vuelve a quedar libre.
      if (settledOwner) {
        handlers.onLost();
        enqueueWaiter(handlers);
      }
    });
  });
}

/** Encola una petición bloqueante del lock: se concede cuando la pestaña dueña lo
 *  suelta (se cierra) → promovemos esta pestaña a dueña (relevo automático). */
let waiterQueued = false;
function enqueueWaiter(handlers: ClaimHandlers) {
  if (waiterQueued) return;
  if (!("locks" in navigator) || !navigator.locks?.request) return;
  waiterQueued = true;
  navigator.locks
    .request(LOCK_NAME, () => {
      handlers.onPromoted();
      return new Promise<void>(() => {
        /* ahora somos dueñas; mantenemos hasta cierre/robo */
      });
    })
    .catch(() => {
      // Nos lo robaron mientras esperábamos → seguimos secundarias.
      waiterQueued = false;
    });
}

/** "Usar acá": esta pestaña quiere tomar el softphone. Marca el claim, pide al
 *  dueño actual que suelte, y recarga para reinicializar el CCP limpio como dueña. */
export function takeOverSoftphone() {
  writeClaim(tabId());
  channel()?.postMessage({ t: "yield", by: tabId() });
  // Pequeño respiro para que el dueño reciba el aviso y empiece a soltar, luego
  // recargamos: al recargar somos el "reclamante" y robamos el lock.
  setTimeout(() => {
    try {
      location.reload();
    } catch {
      /* noop */
    }
  }, 120);
}

/** La pestaña dueña escucha el aviso "yield" (otra pidió tomar el control) y
 *  ejecuta el callback (recargar → soltar el lock → quedar secundaria). */
export function onYieldRequested(cb: () => void): () => void {
  const ch = channel();
  if (!ch) return () => {};
  const me = tabId();
  const handler = (e: MessageEvent) => {
    if (e.data?.t === "yield" && e.data?.by !== me) cb();
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
