import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";
import { toast } from "sonner";

/**
 * Global keyboard shortcuts:
 * - G then D/A/M/R: Navigate (Dashboard, Agent, Monitoring, Reports)
 * - ⌘⇧D / Ctrl+Shift+D: Toggle dark mode
 * - ?: Show shortcuts help
 * - Esc: Close modals (handled by radix/cmdk natively)
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const { toggleTheme } = useTheme();
  const [showHelp, setShowHelp] = useState(false);

  // `gPending` (prefijo vim "g") vive en un REF, no en estado: así el efecto
  // del keydown NO se re-suscribe con cada tecla "g" (antes estaba en deps y
  // recableaba el listener global + su timer en cada pulsación).
  const gPendingRef = useRef(false);
  // Id del timeout del prefijo "g" — se guarda para poder limpiarlo en el
  // cleanup (antes quedaba colgado y podía disparar tras el unmount).
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // navigate/toggleTheme vía ref para registrar el keydown UNA sola vez (deps
  // []) sin capturar valores viejos: el handler siempre llama al más reciente.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const toggleThemeRef = useRef(toggleTheme);
  toggleThemeRef.current = toggleTheme;

  useEffect(() => {
    const clearGTimer = () => {
      if (gTimerRef.current) {
        clearTimeout(gTimerRef.current);
        gTimerRef.current = null;
      }
    };

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Allow these even when typing
      if ((e.key === "D" || e.key === "d") && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleThemeRef.current();
        return;
      }

      if (isTyping) return;

      // Vim-style: g then letter
      if (e.key === "g" && !gPendingRef.current) {
        gPendingRef.current = true;
        clearGTimer();
        gTimerRef.current = setTimeout(() => {
          gPendingRef.current = false;
          gTimerRef.current = null;
        }, 800);
        return;
      }

      if (gPendingRef.current) {
        gPendingRef.current = false;
        clearGTimer();
        const routes: Record<string, string> = {
          d: "/",
          a: "/agent",
          q: "/queue",
          r: "/reports",
          c: "/recordings",
          s: "/admin",
        };
        const path = routes[e.key.toLowerCase()];
        if (path) {
          e.preventDefault();
          navigateRef.current(path);
          toast(`Navigated`, { description: path });
        }
        return;
      }

      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        setShowHelp((v) => !v);
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      clearGTimer();
    };
  }, []);

  return { showHelp, setShowHelp, gPending: gPendingRef.current };
}
