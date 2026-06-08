import { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useAuth } from "@/hooks/useAuth";
import * as Icon from "@/components/vox/primitives";

interface AICoachPanelProps {
  contactId: string | null;
  customerPhone?: string | null;
  transcriptSegmentCount: number;
  isActive: boolean;
  sentiment?: string;
  /** Demo / smoke-test escape hatch: skip the Lambda fetch and render
   *  these blocks directly. Used by /coach-demo to visually QA the
   *  renderers without a live call. Production code never sets this. */
  initialBlocks?: unknown;
  /** Drop the outer q-card wrapper — for embedding inside another card
   *  (right-rail tab) so we don't get a card-in-card border doubling. */
  inline?: boolean;
  /** Notify parent of the block count, so a tab badge can show it. */
  onBlocksChange?: (count: number) => void;
}

// ─── Block schema ────────────────────────────────────────────────────────
// The shape Claude is asked to return. The renderer is a giant switch on
// `type`; unknown types are silently dropped so a forward-compatible
// schema change won't crash the panel.

type CtaKind =
  | "schedule_callback"
  | "send_template"
  | "transfer"
  | "note"
  | "none";

interface ActionCta {
  label: string;
  kind: CtaKind;
  payload?: Record<string, unknown>;
}

type CoachBlock =
  | { type: "action"; title: string; reason?: string; cta?: ActionCta }
  | { type: "script"; title?: string; text: string }
  | { type: "checklist"; title?: string; items: string[] }
  | {
      type: "callout";
      tone: "info" | "warn" | "success" | "error";
      text: string;
    }
  | {
      type: "table";
      title?: string;
      columns: string[];
      rows: string[][];
    }
  | {
      type: "form";
      title: string;
      fields: FormField[];
      submitLabel?: string;
    };

interface FormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "email" | "select";
  options?: string[];
}

// ─── Parser ──────────────────────────────────────────────────────────────

/** Extract a block array from whatever shape Claude returned. Tolerant of
 *  markdown fences, preambles, single-object responses, and the legacy
 *  [{action,reason}] shape. */
function extractCoachBlocks(raw: unknown): CoachBlock[] {
  if (!raw) return [];
  if (typeof raw !== "string") {
    return normaliseBlocks(raw);
  }
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  const direct = tryParseJson(text);
  if (direct) return normaliseBlocks(direct);

  // Try to slice the first balanced { ... } object out of the text.
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    const candidate = tryParseJson(text.slice(objStart, objEnd + 1));
    if (candidate) return normaliseBlocks(candidate);
  }
  // Legacy fallback: a bare [...] array of {action,reason}.
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    const candidate = tryParseJson(text.slice(arrStart, arrEnd + 1));
    if (candidate) return normaliseBlocks(candidate);
  }
  return [];
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Coerce arbitrary parsed JSON into a CoachBlock[]. Handles:
 *  - { blocks: [...] }   ← the canonical shape
 *  - [...]               ← bare array, legacy
 *  - single block object
 *  Drops anything that doesn't satisfy the per-type shape. */
function normaliseBlocks(parsed: unknown): CoachBlock[] {
  if (!parsed) return [];
  let items: unknown[] = [];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.blocks)) items = obj.blocks;
    else if (Array.isArray(obj.actions)) items = obj.actions; // legacy
    else items = [obj]; // bare single-object response
  }
  const out: CoachBlock[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const t = typeof b.type === "string" ? b.type : "";
    // Legacy {action,reason} items get promoted to action blocks.
    if (!t && typeof b.action === "string") {
      out.push({
        type: "action",
        title: String(b.action),
        reason: typeof b.reason === "string" ? b.reason : undefined,
      });
      continue;
    }
    if (t === "action" && typeof b.title === "string") {
      out.push({
        type: "action",
        title: String(b.title),
        reason: typeof b.reason === "string" ? b.reason : undefined,
        cta: parseCta(b.cta),
      });
    } else if (t === "script" && typeof b.text === "string") {
      out.push({
        type: "script",
        title: typeof b.title === "string" ? b.title : undefined,
        text: String(b.text),
      });
    } else if (t === "checklist" && Array.isArray(b.items)) {
      const items = b.items.filter((x): x is string => typeof x === "string");
      if (items.length === 0) continue;
      out.push({
        type: "checklist",
        title: typeof b.title === "string" ? b.title : undefined,
        items,
      });
    } else if (t === "callout" && typeof b.text === "string") {
      const tone = b.tone === "warn" || b.tone === "success" || b.tone === "error"
        ? b.tone
        : "info";
      out.push({ type: "callout", tone, text: String(b.text) });
    } else if (
      t === "table" &&
      Array.isArray(b.columns) &&
      Array.isArray(b.rows)
    ) {
      const columns = b.columns.filter(
        (x): x is string => typeof x === "string"
      );
      const rows = b.rows
        .filter((r): r is unknown[] => Array.isArray(r))
        .map((r) => r.map((c) => String(c ?? "")));
      if (columns.length === 0 || rows.length === 0) continue;
      out.push({
        type: "table",
        title: typeof b.title === "string" ? b.title : undefined,
        columns,
        rows,
      });
    } else if (
      t === "form" &&
      typeof b.title === "string" &&
      Array.isArray(b.fields)
    ) {
      const fields = b.fields
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => normaliseField(f))
        .filter((f): f is FormField => f !== null);
      if (fields.length === 0) continue;
      out.push({
        type: "form",
        title: String(b.title),
        fields,
        submitLabel:
          typeof b.submitLabel === "string" ? b.submitLabel : "Guardar",
      });
    }
  }
  return out.slice(0, 6);
}

function parseCta(raw: unknown): ActionCta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const label = typeof c.label === "string" ? c.label : "";
  const kind = typeof c.kind === "string" ? c.kind : "none";
  if (!label) return undefined;
  if (
    kind !== "schedule_callback" &&
    kind !== "send_template" &&
    kind !== "transfer" &&
    kind !== "note" &&
    kind !== "none"
  ) {
    return undefined;
  }
  return {
    label,
    kind,
    payload:
      c.payload && typeof c.payload === "object"
        ? (c.payload as Record<string, unknown>)
        : undefined,
  };
}

function normaliseField(f: Record<string, unknown>): FormField | null {
  const name = typeof f.name === "string" ? f.name : "";
  const label = typeof f.label === "string" ? f.label : name;
  if (!name) return null;
  const type =
    f.type === "textarea" ||
    f.type === "number" ||
    f.type === "email" ||
    f.type === "select"
      ? f.type
      : "text";
  const options =
    type === "select" && Array.isArray(f.options)
      ? f.options.filter((x): x is string => typeof x === "string")
      : undefined;
  return { name, label, type, options };
}

// ─── Component ───────────────────────────────────────────────────────────

export function AICoachPanel({
  contactId,
  customerPhone,
  transcriptSegmentCount,
  isActive,
  sentiment,
  initialBlocks,
  inline,
  onBlocksChange,
}: AICoachPanelProps) {
  const { user } = useAuth();
  const [blocks, setBlocks] = useState<CoachBlock[]>(() =>
    initialBlocks ? extractCoachBlocks(initialBlocks) : []
  );
  const [loading, setLoading] = useState(false);
  const lastSegmentCount = useRef(0);

  // Mirror block count up so the parent can show a tab badge / pulse.
  useEffect(() => {
    onBlocksChange?.(blocks.length);
  }, [blocks.length, onBlocksChange]);

  const fetchSuggestions = async () => {
    if (!contactId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) return;

    setLoading(true);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, mode: "next-action" }),
      });
      const data = await r.json();
      const parsed = extractCoachBlocks(data.result);
      if (parsed.length > 0) setBlocks(parsed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isActive || !contactId) return;
    if (transcriptSegmentCount - lastSegmentCount.current >= 5) {
      lastSegmentCount.current = transcriptSegmentCount;
      fetchSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptSegmentCount, isActive, contactId]);

  // Inactive state: a single empty-state card. When inline (hosted inside
  // another card like the right-rail tab), drop the outer chrome.
  if (!isActive) {
    if (inline) {
      return (
        <div
          className="muted"
          style={{ fontSize: 12.5, padding: 14, textAlign: "center" }}
        >
          <Icon.Sparkles size={16} style={{ opacity: 0.4, marginBottom: 6 }} />
          <div>Las sugerencias aparecerán durante una llamada activa.</div>
        </div>
      );
    }
    return (
      <div className="q-card">
        <div className="q-card__head">
          <Icon.Sparkles size={14} /> Coach · Claude
        </div>
        <div className="q-card__body muted">
          Las sugerencias aparecerán durante una llamada activa.
        </div>
      </div>
    );
  }

  // Active state. Inline mode skips the q-card chrome AND the header
  // (the host owns those) — we just render the body content.
  const body = (
    <AnimatePresence mode="popLayout">
      {blocks.length === 0 && !loading && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="muted"
          style={{ fontSize: 12, margin: 0 }}
        >
          El coach sugerirá próximas acciones conforme avance la conversación…
        </motion.p>
      )}
      {blocks.map((block, i) => (
        <motion.div
          key={blockKey(block, i)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ delay: i * 0.04, duration: 0.25 }}
        >
          <BlockRenderer
            block={block}
            contactId={contactId}
            customerPhone={customerPhone || null}
            actorUsername={user?.username || "agent"}
          />
        </motion.div>
      ))}
    </AnimatePresence>
  );

  if (inline) {
    // Inline mode: a refresh-button strip on top, then the blocks. The
    // host header carries the title + badge, so we keep this minimal.
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          className="row"
          style={{ justifyContent: "flex-end", gap: 6, marginBottom: 2 }}
        >
          {sentiment === "NEGATIVE" && (
            <span className="chip chip--red" style={{ height: 18, fontSize: 10 }}>
              <Icon.Shield size={10} /> Urgente
            </span>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={fetchSuggestions}
            disabled={loading}
          >
            <Icon.Refresh
              size={12}
              style={loading ? { animation: "spin 1s linear infinite" } : undefined}
            />
            {loading ? "Pensando…" : "Actualizar"}
          </button>
        </div>
        {body}
        <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div className="q-card">
      <div className="q-card__head" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon.Sparkles size={14} /> Coach · Claude
          {sentiment === "NEGATIVE" && (
            <span className="chip chip--red" style={{ height: 18, fontSize: 10 }}>
              <Icon.Shield size={10} /> Urgente
            </span>
          )}
        </div>
        <button
          className="btn btn--ghost btn--sm"
          onClick={fetchSuggestions}
          disabled={loading}
          style={{ marginLeft: "auto" }}
        >
          <Icon.Refresh
            size={12}
            style={loading ? { animation: "spin 1s linear infinite" } : undefined}
          />
          {loading ? "Pensando…" : "Actualizar"}
        </button>
      </div>
      <div
        className="q-card__body"
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        {body}
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function blockKey(b: CoachBlock, i: number): string {
  if (b.type === "action") return `act-${i}-${b.title.slice(0, 24)}`;
  if (b.type === "script") return `scr-${i}-${b.text.slice(0, 24)}`;
  if (b.type === "checklist") return `chk-${i}-${b.items[0].slice(0, 24)}`;
  if (b.type === "callout") return `cal-${i}-${b.text.slice(0, 24)}`;
  if (b.type === "table") return `tbl-${i}-${b.columns.join("|")}`;
  if (b.type === "form") return `frm-${i}-${b.title.slice(0, 24)}`;
  return `b-${i}`;
}

// ─── Renderers ───────────────────────────────────────────────────────────

interface RendererCtx {
  contactId: string | null;
  customerPhone: string | null;
  actorUsername: string;
}

function BlockRenderer({
  block,
  ...ctx
}: { block: CoachBlock } & RendererCtx) {
  switch (block.type) {
    case "action":
      return <ActionBlock block={block} {...ctx} />;
    case "script":
      return <ScriptBlock block={block} />;
    case "checklist":
      return <ChecklistBlock block={block} />;
    case "callout":
      return <CalloutBlock block={block} />;
    case "table":
      return <TableBlock block={block} />;
    case "form":
      return <FormBlock block={block} {...ctx} />;
  }
}

const CARD_BASE: React.CSSProperties = {
  background: "var(--bg-2)",
  border: "1px solid var(--border-1)",
  borderRadius: 8,
  padding: 10,
};

function ActionBlock({
  block,
  ...ctx
}: {
  block: Extract<CoachBlock, { type: "action" }>;
} & RendererCtx) {
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (!block.cta || block.cta.kind === "none") {
      toast.success(`Acción anotada: ${block.title}`);
      return;
    }
    setBusy(true);
    try {
      await dispatchCta(block.cta, block.title, ctx);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo ejecutar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...CARD_BASE, display: "flex", gap: 10 }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background:
            "linear-gradient(135deg, var(--accent-violet), var(--accent-pink))",
          color: "white",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        <Icon.Sparkles size={11} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
          {block.title}
        </div>
        {block.reason && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
            {block.reason}
          </div>
        )}
        {block.cta && (
          <button
            className="btn btn--primary btn--sm"
            onClick={onClick}
            disabled={busy}
            style={{ marginTop: 8 }}
          >
            {busy ? "…" : block.cta.label}
          </button>
        )}
      </div>
    </div>
  );
}

function ScriptBlock({
  block,
}: {
  block: Extract<CoachBlock, { type: "script" }>;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.text);
      setCopied(true);
      toast.success("Guion copiado");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  return (
    <div
      style={{
        ...CARD_BASE,
        borderLeft: "3px solid var(--accent-violet)",
      }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 4 }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-violet)" }}>
          GUION{block.title ? ` · ${block.title}` : ""}
        </span>
        <button className="btn btn--ghost btn--sm" onClick={copy}>
          <Icon.Send size={10} /> {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.5,
          color: "var(--text-1)",
          fontStyle: "italic",
        }}
      >
        "{block.text}"
      </div>
    </div>
  );
}

function ChecklistBlock({
  block,
}: {
  block: Extract<CoachBlock, { type: "checklist" }>;
}) {
  const [checked, setChecked] = useState<boolean[]>(
    () => new Array(block.items.length).fill(false)
  );
  const toggle = (i: number) =>
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  const doneCount = checked.filter(Boolean).length;
  return (
    <div style={CARD_BASE}>
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 6 }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)" }}>
          ☑ {block.title || "Checklist"}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {doneCount}/{block.items.length}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {block.items.map((item, i) => (
          <label
            key={i}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: 12.5,
              cursor: "pointer",
              padding: "3px 0",
            }}
          >
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={() => toggle(i)}
              style={{ marginTop: 2 }}
            />
            <span
              style={{
                color: checked[i] ? "var(--text-3)" : "var(--text-1)",
                textDecoration: checked[i] ? "line-through" : "none",
              }}
            >
              {item}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

const TONE_COLOR: Record<
  Extract<CoachBlock, { type: "callout" }>["tone"],
  { bg: string; fg: string; border: string; icon: string }
> = {
  info: {
    bg: "rgba(99,102,241,0.10)",
    fg: "var(--accent-violet)",
    border: "rgba(99,102,241,0.30)",
    icon: "ℹ",
  },
  warn: {
    bg: "rgba(245,158,11,0.12)",
    fg: "var(--accent-amber)",
    border: "rgba(245,158,11,0.35)",
    icon: "⚠",
  },
  success: {
    bg: "rgba(16,185,129,0.12)",
    fg: "var(--accent-green)",
    border: "rgba(16,185,129,0.35)",
    icon: "✓",
  },
  error: {
    bg: "rgba(239,68,68,0.12)",
    fg: "var(--accent-red)",
    border: "rgba(239,68,68,0.35)",
    icon: "✗",
  },
};

function CalloutBlock({
  block,
}: {
  block: Extract<CoachBlock, { type: "callout" }>;
}) {
  const c = TONE_COLOR[block.tone];
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: 10,
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span style={{ color: c.fg, fontWeight: 700, fontSize: 14 }}>{c.icon}</span>
      <span style={{ fontSize: 12.5, color: c.fg, fontWeight: 500 }}>
        {block.text}
      </span>
    </div>
  );
}

function TableBlock({
  block,
}: {
  block: Extract<CoachBlock, { type: "table" }>;
}) {
  return (
    <div style={CARD_BASE}>
      {block.title && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-1)",
            marginBottom: 6,
          }}
        >
          {block.title}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {block.columns.map((c, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: "left",
                    padding: "4px 6px",
                    borderBottom: "1px solid var(--border-1)",
                    color: "var(--text-2)",
                    fontWeight: 600,
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {block.columns.map((_, j) => (
                  <td
                    key={j}
                    style={{
                      padding: "4px 6px",
                      borderBottom: "1px solid var(--border-1)",
                      color: "var(--text-1)",
                    }}
                  >
                    {row[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormBlock({
  block,
  contactId,
  actorUsername,
}: {
  block: Extract<CoachBlock, { type: "form" }>;
} & RendererCtx) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of block.fields) v[f.name] = "";
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const set = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const onSubmit = async () => {
    if (!contactId) {
      toast.error("Sin contacto activo");
      return;
    }
    setBusy(true);
    try {
      const lines = block.fields
        .map((f) => `${f.label}: ${values[f.name]?.trim() || "—"}`)
        .join("\n");
      const noteText = `[Coach · ${block.title}]\n${lines}`;
      await appendAgentNotes(contactId, actorUsername, noteText);
      setSubmitted(true);
      toast.success("Datos guardados en notas del contacto");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div
        style={{
          ...CARD_BASE,
          borderLeft: "3px solid var(--accent-green)",
        }}
      >
        <div
          className="row"
          style={{ gap: 6, fontSize: 12.5, color: "var(--accent-green)", fontWeight: 500 }}
        >
          ✓ {block.title} guardado en notas
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...CARD_BASE, borderLeft: "3px solid var(--accent-pink)" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-1)",
          marginBottom: 6,
        }}
      >
        📝 {block.title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {block.fields.map((f) => (
          <div key={f.name}>
            <label
              style={{
                fontSize: 11,
                color: "var(--text-2)",
                display: "block",
                marginBottom: 2,
              }}
            >
              {f.label}
            </label>
            {f.type === "textarea" ? (
              <textarea
                value={values[f.name] || ""}
                onChange={(e) => set(f.name, e.target.value)}
                rows={2}
                style={{
                  width: "100%",
                  fontSize: 12,
                  padding: 6,
                  border: "1px solid var(--border-1)",
                  borderRadius: 6,
                  background: "var(--bg-1)",
                  color: "var(--text-1)",
                  resize: "vertical",
                }}
              />
            ) : f.type === "select" ? (
              <select
                value={values[f.name] || ""}
                onChange={(e) => set(f.name, e.target.value)}
                style={{
                  width: "100%",
                  fontSize: 12,
                  padding: 6,
                  border: "1px solid var(--border-1)",
                  borderRadius: 6,
                  background: "var(--bg-1)",
                  color: "var(--text-1)",
                }}
              >
                <option value="">—</option>
                {(f.options || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type}
                value={values[f.name] || ""}
                onChange={(e) => set(f.name, e.target.value)}
                style={{
                  width: "100%",
                  fontSize: 12,
                  padding: 6,
                  border: "1px solid var(--border-1)",
                  borderRadius: 6,
                  background: "var(--bg-1)",
                  color: "var(--text-1)",
                }}
              />
            )}
          </div>
        ))}
      </div>
      <button
        className="btn btn--primary btn--sm"
        onClick={onSubmit}
        disabled={busy}
        style={{ marginTop: 8 }}
      >
        {busy ? "Guardando…" : block.submitLabel || "Guardar"}
      </button>
    </div>
  );
}

// ─── CTA dispatcher ──────────────────────────────────────────────────────

async function dispatchCta(
  cta: ActionCta,
  fallbackTitle: string,
  ctx: RendererCtx
): Promise<void> {
  const endpoints = getApiEndpoints();
  const p = cta.payload || {};

  if (cta.kind === "note") {
    if (!ctx.contactId) throw new Error("Sin contacto activo");
    const text = String(p.text || fallbackTitle);
    await appendAgentNotes(ctx.contactId, ctx.actorUsername, `[Coach] ${text}`);
    toast.success("Anotación guardada");
    return;
  }

  if (cta.kind === "schedule_callback") {
    if (!endpoints?.scheduleCallback) {
      throw new Error("Endpoint de callback no configurado");
    }
    if (!ctx.customerPhone) {
      throw new Error("Sin teléfono del cliente para callback");
    }
    const minutes = Number(p.whenMinutes) || 30;
    const when = new Date(Date.now() + minutes * 60_000).toISOString();
    const channel = String(p.channel || "voice");
    const reason = String(p.reason || fallbackTitle);
    const r = await fetch(endpoints.scheduleCallback, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: ctx.customerPhone,
        scheduledAt: when,
        channel,
        reason,
        contactId: ctx.contactId,
        createdBy: ctx.actorUsername,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    toast.success(`Callback programado en ${minutes} min`);
    return;
  }

  if (cta.kind === "send_template") {
    if (!endpoints?.sendWhatsAppTemplate) {
      throw new Error("Endpoint de WhatsApp no configurado");
    }
    if (!ctx.customerPhone) {
      throw new Error("Sin teléfono del cliente");
    }
    const templateName = String(p.templateName || "");
    if (!templateName) throw new Error("Falta templateName en payload");
    const language = String(p.language || "es");
    const r = await authedFetch(endpoints.sendWhatsAppTemplate, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: ctx.customerPhone,
        templateName,
        language,
        actor: ctx.actorUsername,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    toast.success(`Template enviado: ${templateName}`);
    return;
  }

  if (cta.kind === "transfer") {
    if (!endpoints?.adminTransferContact) {
      throw new Error("Endpoint de transfer no configurado");
    }
    if (!ctx.contactId) throw new Error("Sin contacto activo");
    const queue = String(p.queue || "");
    const r = await fetch(endpoints.adminTransferContact, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: ctx.contactId,
        targetQueueName: queue,
        actor: ctx.actorUsername,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    toast.success(`Transfer iniciado a ${queue}`);
    return;
  }

  // Unknown kind — surface but don't crash.
  toast.message(`Acción: ${cta.label}`);
}

/**
 * GET existing agent notes, append a new block, POST the merged content.
 * The save-agent-notes Lambda overwrites the `agentNotes` field on PUT,
 * so we read-modify-write to avoid clobbering anything the agent has
 * typed manually. The new block is delimited so it's easy to identify
 * later as coach-generated.
 */
async function appendAgentNotes(
  contactId: string,
  actor: string,
  newBlock: string
): Promise<void> {
  const endpoints = getApiEndpoints();
  if (!endpoints?.saveAgentNotes) throw new Error("Endpoint de notas no configurado");

  let existing = "";
  try {
    const g = await fetch(
      `${endpoints.saveAgentNotes}?contactId=${encodeURIComponent(contactId)}`
    );
    if (g.ok) {
      const j = await g.json();
      existing = typeof j.notes === "string" ? j.notes : "";
    }
  } catch {
    /* treat as empty */
  }

  const ts = new Date().toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const merged = existing
    ? `${existing}\n\n--- ${ts} ---\n${newBlock}`
    : `--- ${ts} ---\n${newBlock}`;

  const r = await fetch(endpoints.saveAgentNotes, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contactId,
      notes: merged,
      agentUsername: actor,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}
