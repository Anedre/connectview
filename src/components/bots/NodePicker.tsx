import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { NODE_KINDS, PALETTE_GROUPS, type NodeKind } from "@/lib/botFlow";
import { FLOW_ICONS } from "@/components/bots/icons";

/**
 * NodePicker — floating command-palette-style popover that lists the node
 * catalog (reusing PALETTE_GROUPS + NODE_KINDS + FLOW_ICONS, exactly like the
 * left Palette). Powers "quick-connect" (drag an edge to empty space) and the
 * "+" insert-on-edge button. Search filters by label/blurb; ↑/↓ + Enter pick a
 * type, Esc closes, click-outside closes. Positioned fixed at (screenX,screenY)
 * and auto-nudged to stay inside the viewport.
 */

interface PickEntry {
  kind: NodeKind;
  label: string;
  blurb: string;
  accent: string;
  icon: string;
}

/** Flattened, group-ordered catalog (start is entry-only, never inserted). */
function buildEntries(query: string): { group: string; items: PickEntry[] }[] {
  const q = query.trim().toLowerCase();
  const groups: { group: string; items: PickEntry[] }[] = [];
  for (const group of PALETTE_GROUPS) {
    const items: PickEntry[] = [];
    for (const def of Object.values(NODE_KINDS)) {
      if (def.group !== group) continue;
      if (q && !def.label.toLowerCase().includes(q) && !def.blurb.toLowerCase().includes(q))
        continue;
      items.push({
        kind: def.kind,
        label: def.label,
        blurb: def.blurb,
        accent: def.accent,
        icon: def.icon,
      });
    }
    if (items.length > 0) groups.push({ group, items });
  }
  return groups;
}

const POPOVER_W = 320;
const POPOVER_MAXH = 420;

export function NodePicker({
  screenX,
  screenY,
  onPick,
  onClose,
}: {
  screenX: number;
  screenY: number;
  onPick: (kind: NodeKind) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const groups = buildEntries(q);
  // Flat list drives keyboard navigation across groups.
  const flat = groups.flatMap((g) => g.items);
  const clampedActive = flat.length === 0 ? 0 : Math.min(active, flat.length - 1);

  // Autofocus the search box on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the popover inside the viewport (nudge up/left if it would overflow).
  // Positioned imperatively on the DOM node — updating the DOM from a layout
  // effect is the intended use (no cascading setState / React Compiler warning).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const margin = 12;
    const w = el.offsetWidth || POPOVER_W;
    const h = el.offsetHeight || POPOVER_MAXH;
    let left = screenX;
    let top = screenY;
    if (left + w + margin > window.innerWidth) left = window.innerWidth - w - margin;
    if (top + h + margin > window.innerHeight) top = window.innerHeight - h - margin;
    el.style.left = `${Math.max(margin, left)}px`;
    el.style.top = `${Math.max(margin, top)}px`;
  }, [screenX, screenY, q]);

  // Click-outside closes.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as HTMLElement)) onClose();
    };
    // Defer so the opening click (mouseup from the edge drag) doesn't self-close.
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flat[clampedActive];
      if (pick) onPick(pick.kind);
    }
  };

  return (
    <div
      ref={rootRef}
      className="fb-picker"
      style={{ left: screenX, top: screenY }}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-label="Elegir paso"
    >
      <div className="fb-picker__search">
        <Search size={14} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          placeholder="Buscar paso…"
        />
      </div>

      <div className="fb-picker__list">
        {groups.length === 0 && <div className="fb-picker__empty">Sin resultados</div>}
        {groups.map((g) => (
          <div key={g.group} className="fb-picker__group">
            <div className="fb-picker__group-h">{g.group}</div>
            {g.items.map((it) => {
              const idx = flat.indexOf(it);
              const Icn = FLOW_ICONS[it.icon] || FLOW_ICONS.message;
              const isActive = idx === clampedActive;
              return (
                <button
                  key={it.kind}
                  type="button"
                  className={`fb-picker__item ${isActive ? "fb-picker__item--on" : ""}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => onPick(it.kind)}
                >
                  <span
                    className="fb-picker__icon"
                    style={{ background: `${it.accent}1a`, color: it.accent }}
                  >
                    <Icn size={15} strokeWidth={2.2} />
                  </span>
                  <span className="fb-picker__text">
                    <span className="fb-picker__label">{it.label}</span>
                    <span className="fb-picker__blurb">{it.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
