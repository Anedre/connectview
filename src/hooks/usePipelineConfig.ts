import { useEffect, useState, useCallback } from "react";

/**
 * Persisted admin-level personalization for the pipeline view. Everything
 * here is purely cosmetic or filter-level — the actual data comes from
 * useLiveQueue. Stored in localStorage so each admin keeps their own layout.
 */
export interface PipelineConfig {
  /** Show the FINISHED column? */
  showFinished: boolean;
  /** Show the IN_IVR column? Some instances skip IVR entirely. */
  showIvr: boolean;
  /** Show the agents rail under the pipeline. */
  showAgents: boolean;
  /** Show the 15-min timeline strip above the pipeline. */
  showTimeline: boolean;
  /** Compact bubbles = smaller + no customer name. */
  compact: boolean;
  /** How many seconds until a bubble turns amber. */
  warnSeconds: number;
  /** How many seconds until a bubble turns red (urgent). */
  urgentSeconds: number;
  /** Beep when any bubble passes urgentSeconds. */
  soundOnUrgent: boolean;
  /** Filter: queueId (or "ALL"). */
  queueId: string;
  /** Filter: channel (or "ALL"). */
  channel: string;
  /** Filter: campaignId (or ""). */
  campaignId: string;
  /** Search term applied to all stages. */
  query: string;
  /** Contact IDs the admin has pinned so they always stay visible at the top. */
  pinnedContactIds: string[];
}

const DEFAULT: PipelineConfig = {
  showFinished: true,
  showIvr: true,
  showAgents: true,
  showTimeline: true,
  compact: false,
  warnSeconds: 60,
  urgentSeconds: 120,
  soundOnUrgent: false,
  queueId: "ALL",
  channel: "ALL",
  campaignId: "",
  query: "",
  pinnedContactIds: [],
};

const KEY = "connectview.pipeline.config.v1";

function load(): PipelineConfig {
  if (typeof localStorage === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT, ...parsed };
  } catch {
    return DEFAULT;
  }
}

export function usePipelineConfig() {
  const [config, setConfig] = useState<PipelineConfig>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(config));
    } catch {
      /* private mode / quota — ignore */
    }
  }, [config]);

  const update = useCallback((patch: Partial<PipelineConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT);
  }, []);

  const togglePin = useCallback((contactId: string) => {
    setConfig((c) => {
      const has = c.pinnedContactIds.includes(contactId);
      return {
        ...c,
        pinnedContactIds: has
          ? c.pinnedContactIds.filter((id) => id !== contactId)
          : [...c.pinnedContactIds, contactId],
      };
    });
  }, []);

  const isPinned = useCallback(
    (contactId: string) => config.pinnedContactIds.includes(contactId),
    [config.pinnedContactIds]
  );

  return { config, update, reset, togglePin, isPinned };
}
