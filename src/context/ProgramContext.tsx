import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePrograms, type Program } from "@/hooks/usePrograms";

/**
 * ProgramContext — el "programa activo" que scopea TODA la app (Pilar 1).
 * Single-select + "Todos" + "Sin programa" (decisión 2026-06-18). Persiste en
 * localStorage porque no hay URL params (React 19 / RR7, nuqs descartado).
 *
 * Las páginas leen useProgram().activeProgramId y lo pasan a su fetch
 * (LeadsPage, Campañas, Reportes, Dashboard) en fases siguientes.
 */

const STORAGE_KEY = "aria.activeProgramId";
export type ActiveProgram = string | "all" | "none";

interface ProgramContextValue {
  programs: Program[];
  loading: boolean;
  error: string | null;
  activeProgramId: ActiveProgram;
  activeProgram?: Program;
  setActiveProgram: (id: ActiveProgram) => void;
  refresh: () => void;
}

const Ctx = createContext<ProgramContextValue | null>(null);

export function ProgramProvider({ children }: { children: ReactNode }) {
  // Refresca cada 60s (salud/altas hechas desde el hub o por auto-tagging).
  const { programs, loading, error, refresh } = usePrograms({ refreshIntervalMs: 60_000 });

  const [activeProgramId, setActiveProgramId] = useState<ActiveProgram>(() => {
    if (typeof window === "undefined") return "all";
    return (localStorage.getItem(STORAGE_KEY) as ActiveProgram) || "all";
  });

  const setActiveProgram = (id: ActiveProgram) => {
    setActiveProgramId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const activeProgram = useMemo(
    () =>
      activeProgramId !== "all" && activeProgramId !== "none"
        ? programs.find((p) => p.programId === activeProgramId)
        : undefined,
    [programs, activeProgramId],
  );

  const value: ProgramContextValue = {
    programs,
    loading,
    error,
    activeProgramId,
    activeProgram,
    setActiveProgram,
    refresh: () => {
      void refresh();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProgram(): ProgramContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProgram must be used within ProgramProvider");
  return v;
}

/**
 * Variante que NO lanza si se usa fuera del ProgramProvider — devuelve null.
 * Para overlays globales (p.ej. CopilotPanel) que viven por encima del provider
 * y solo quieren leer el programa activo "si existe".
 */
export function useProgramOptional(): ProgramContextValue | null {
  return useContext(Ctx);
}
