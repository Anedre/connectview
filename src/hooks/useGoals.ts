import { useCallback, useEffect, useState } from "react";

/**
 * useGoals — period sales goals (metas), persisted in localStorage.
 *
 * There is no backend goal/quota config in Vox yet (confirmed: no goal/meta/
 * quota field anywhere). Rather than invent fake targets, we let the user set
 * their own period goal locally; the dashboard then shows real progress
 * (real pipeline value from leads' montoEstimado) against THEIR target.
 *
 * Stored as a single monthly pipeline-value goal in soles. Period KPIs scale
 * it proportionally (week = month/4.3, etc.) so "% de meta" is meaningful for
 * any selected period.
 */

const LS_KEY = "vox_goals_v1";

export interface Goals {
  /** Monthly pipeline value target, in soles. 0 = not set. */
  monthlyPipeline: number;
}

const DEFAULT: Goals = { monthlyPipeline: 0 };

function load(): Goals {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<Goals>) };
  } catch {
    /* default */
  }
  return DEFAULT;
}

export function useGoals() {
  const [goals, setGoals] = useState<Goals>(load);

  // Keep in sync if another tab/instance edits the goal.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) setGoals(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMonthlyPipeline = useCallback((value: number) => {
    setGoals((cur) => {
      const next = { ...cur, monthlyPipeline: Math.max(0, value) };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  /** The goal scaled to a period of `days` length (month ≈ 30.4 days). */
  const goalForDays = useCallback(
    (days: number) => (goals.monthlyPipeline > 0 ? Math.round((goals.monthlyPipeline / 30.4) * days) : 0),
    [goals.monthlyPipeline]
  );

  return { goals, setMonthlyPipeline, goalForDays };
}
