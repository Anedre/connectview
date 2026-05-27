import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * True when the user is on macOS (where ⌘ is the primary modifier).
 * SSR-safe: returns false when navigator is undefined.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
}

/**
 * Returns the right glyph for the primary modifier on this OS:
 * "⌘" on macOS, "Ctrl" elsewhere. Bug #3 — the topbar used to hard-code
 * "⌘K" on Windows, which is the wrong shortcut and misleads users.
 */
export function modifierLabel(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

/**
 * Format a duration in seconds as a human-readable string.
 * - < 1h:  MM:SS  (e.g. "05:42")
 * - >= 1h: HH:MM:SS  (e.g. "1:23:45")
 * Bug #11 / #7 — the old MM:SS-only format produced absurd values like
 * "214:20" for chats > 1 hour. This switches to HH:MM:SS automatically.
 */
export function formatDurationSec(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "—";
  }
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Spanish pluralization helper for short labels.
 * pluralES(1, "agente activo", "agentes activos") -> "agente activo"
 */
export function pluralES(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/**
 * Bug #5 — defensive sanitiser for strings coming from data sources that
 * went through a broken UTF-8 round-trip (e.g. CSV imported as Latin-1
 * but stored as UTF-8). Two transforms:
 *
 *  1. Repair the most common "Latin-1 → UTF-8" mojibake sequences
 *     (Ã³ → ó, Ã± → ñ, etc.). Idempotent — leaves already-correct
 *     strings unchanged.
 *  2. Strip the Unicode replacement character (U+FFFD) — once we hit
 *     that we can't recover the original code point, so we silently
 *     drop it so the UI doesn't render the ugly "" diamond glyph.
 *
 * Keep this as a render-time bandaid; the real fix is to ensure the
 * Lambda/Dynamo write path emits properly UTF-8 encoded bytes.
 */
// Order matters: longer keys first so the multi-byte sequences match
// before any 1-character prefix collisions. We list each replacement
// as a [bad, good] tuple so we can keep duplicate-looking visual
// forms (TypeScript would reject a Record<> with literal duplicates).
const MOJIBAKE_PAIRS: Array<[string, string]> = [
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ã±", "ñ"],
  ["Ã‰", "É"],
  ["Ã“", "Ó"],
  ["Ãš", "Ú"],
  ["Ã‘", "Ñ"],
  ["Ã¼", "ü"],
  ["Ãœ", "Ü"],
  ["Â¿", "¿"],
  ["Â¡", "¡"],
  ["Â°", "°"],
];
export function sanitizeText(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);
  // Pass 1: Latin-1→UTF-8 mojibake repair.
  for (const [bad, good] of MOJIBAKE_PAIRS) {
    if (s.includes(bad)) s = s.split(bad).join(good);
  }
  // Pass 2: drop the replacement character — there's nothing to recover.
  return s.replace(/�/g, "");
}
