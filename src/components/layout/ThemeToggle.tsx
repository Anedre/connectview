import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { motion, AnimatePresence } from "framer-motion";

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={toggleTheme}
      className="group relative flex h-9 w-9 items-center justify-center rounded-lg border bg-background/50 text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground overflow-hidden"
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="moon"
            initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Moon className="h-4 w-4" />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ opacity: 0, rotate: 90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: -90, scale: 0.5 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Sun className="h-4 w-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}
