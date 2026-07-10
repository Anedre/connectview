import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useClickOutside — cierra algo (menú/popover) cuando se hace click FUERA del
 * elemento referenciado o se presiona Escape. Reemplaza los backdrops a mano y
 * el "click en el trigger para cerrar". Usa `pointerdown` en captura para
 * dispararse antes que otros handlers.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onClose: () => void,
  enabled = true,
) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const onPointer = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) cb.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, enabled]);
}

type UseDropdownOpts = {
  /** Abrir al pasar el mouse por encima (y cerrar al salir). Default: false. */
  hover?: boolean;
  /** Retardo de cierre al salir con el mouse, para cruzar el hueco trigger→menú. */
  hoverCloseDelay?: number;
};

/**
 * useDropdown — estado + comportamiento de un desplegable "de mejor forma":
 * abre al click (o al hover si `hover`), cierra al hacer click afuera, con
 * Escape, o al salir con el mouse en modo hover. Devolvés `wrapProps` al
 * contenedor (con `position: relative`) y renderás el menú solo si `open`.
 *
 *   const dd = useDropdown({ hover: true });
 *   <div className="wrap" {...dd.wrapProps}>
 *     <button onClick={dd.toggle}>…</button>
 *     {dd.open && <div className="menu">…</div>}
 *   </div>
 */
export function useDropdown<T extends HTMLElement = HTMLDivElement>({
  hover = false,
  hoverCloseDelay = 140,
}: UseDropdownOpts = {}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  const timer = useRef<number | undefined>(undefined);

  useClickOutside(ref, () => setOpen(false), open);

  const clearTimer = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  };
  useEffect(() => clearTimer, []);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);

  const onMouseEnter = hover
    ? () => {
        clearTimer();
        setOpen(true);
      }
    : undefined;
  const onMouseLeave = hover
    ? () => {
        clearTimer();
        timer.current = window.setTimeout(() => setOpen(false), hoverCloseDelay);
      }
    : undefined;

  return {
    open,
    setOpen,
    toggle,
    close,
    ref,
    /** Va en el contenedor relativo que envuelve trigger + menú. */
    wrapProps: { ref, onMouseEnter, onMouseLeave },
  };
}
