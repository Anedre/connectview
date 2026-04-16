import { useEffect, useState } from "react";
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
  const [gPending, setGPending] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Allow these even when typing
      if ((e.key === "D" || e.key === "d") && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (isTyping) return;

      // Vim-style: g then letter
      if (e.key === "g" && !gPending) {
        setGPending(true);
        setTimeout(() => setGPending(false), 800);
        return;
      }

      if (gPending) {
        setGPending(false);
        const routes: Record<string, string> = {
          d: "/",
          a: "/agent",
          m: "/monitoring",
          r: "/reports",
          c: "/recordings",
          s: "/admin",
        };
        const path = routes[e.key.toLowerCase()];
        if (path) {
          e.preventDefault();
          navigate(path);
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
    return () => document.removeEventListener("keydown", handler);
  }, [navigate, toggleTheme, gPending]);

  return { showHelp, setShowHelp, gPending };
}
