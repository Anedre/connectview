/**
 * Live debug tracing utilities for the flicker hunt.
 *
 * Activate by appending `?debug=1` to the URL. Everything is no-op when
 * the flag is off so production stays clean.
 *
 * Provides:
 *   - traceChange(label, value): logs every value change with a JSON diff
 *     against the previous value, and broadcasts to subscribers (HUD).
 *   - traceRender(componentName): logs each render of a component with
 *     a timestamp and rolling render count.
 *   - subscribe(): for the HUD to pull recent events.
 */
import { useEffect, useRef } from "react";

export const DEBUG_ON =
  typeof window !== "undefined" &&
  /[?&]debug=1/.test(window.location.search);

export type DebugEventKind = "change" | "render" | "info";

export interface DebugEvent {
  ts: number;
  kind: DebugEventKind;
  label: string;
  // Anything JSON-serialisable — typically the new value or diff.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail?: any;
}

const MAX_EVENTS = 500;
const events: DebugEvent[] = [];
const subs = new Set<(ev: DebugEvent) => void>();

function emit(ev: DebugEvent) {
  events.push(ev);
  if (events.length > MAX_EVENTS) events.shift();
  for (const fn of subs) {
    try {
      fn(ev);
    } catch {
      /* swallow subscriber errors */
    }
  }
}

export function getDebugEvents(): readonly DebugEvent[] {
  return events;
}

export function subscribeDebug(fn: (ev: DebugEvent) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Shallow-diff two objects/values. Returns null if identical. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shallowDiff(prev: any, next: any): Record<string, [unknown, unknown]> | null {
  if (Object.is(prev, next)) return null;
  if (prev == null || next == null || typeof prev !== "object" || typeof next !== "object") {
    return { value: [prev, next] };
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    if (!Object.is(a, b)) {
      // For nested objects, just record at depth 1 — keep logs compact.
      if (typeof a === "object" || typeof b === "object") {
        const aJson = a == null ? a : JSON.stringify(a);
        const bJson = b == null ? b : JSON.stringify(b);
        if (aJson !== bJson) out[k] = [aJson, bJson];
      } else {
        out[k] = [a, b];
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

const lastValueByLabel = new Map<string, unknown>();

/**
 * traceChange — pure function (no React). Call any time a value of
 * interest may have changed; we'll diff against the previous tick and
 * log if there's a real change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function traceChange(label: string, value: any) {
  if (!DEBUG_ON) return;
  const prev = lastValueByLabel.get(label);
  const diff = shallowDiff(prev, value);
  if (!diff) return;
  lastValueByLabel.set(label, value);
  const ev: DebugEvent = {
    ts: Date.now(),
    kind: "change",
    label,
    detail: diff,
  };
  emit(ev);
  // Use console.debug so users can filter the noise out easily.
   
  console.debug(`[vox-debug] Δ ${label}`, diff);
}

/** Free-form info breadcrumb (e.g. "API fallback fired"). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function traceInfo(label: string, detail?: any) {
  if (!DEBUG_ON) return;
  emit({ ts: Date.now(), kind: "info", label, detail });
   
  console.debug(`[vox-debug] · ${label}`, detail ?? "");
}

/**
 * useDebugRender — hooks into a React component's render. Logs every
 * render with a per-component counter, and (optionally) a diff against
 * the props you pass in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebugRender(componentName: string, props?: Record<string, any>) {
  const countRef = useRef(0);
  countRef.current += 1;
  if (DEBUG_ON) {
    const ev: DebugEvent = {
      ts: Date.now(),
      kind: "render",
      label: componentName,
      detail: { count: countRef.current, props },
    };
    emit(ev);
    // Diff props from last render
    if (props) traceChange(`${componentName}.props`, props);
  }
  // Also flash the component's outermost element (border pulse).
  useEffect(() => {
    if (!DEBUG_ON) return;
    // Find the element by data-debug-component attribute set by the
    // wrapper; if not present, no flash. (Don't poke the DOM otherwise.)
    const el = document.querySelector(
      `[data-debug-component="${componentName}"]`
    ) as HTMLElement | null;
    if (!el) return;
    el.style.transition = "outline 0.08s ease";
    el.style.outline = "2px solid var(--accent-red, #ff5555)";
    const t = setTimeout(() => {
      el.style.outline = "";
    }, 120);
    return () => clearTimeout(t);
  });
}
