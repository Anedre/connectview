/**
 * scoring — motor de LEAD SCORING (comportamiento) + GRADING (fit demográfico).
 * Fase 2 · F2.1+F2.2. Dos ejes INDEPENDIENTES, estilo Pardot:
 *   - `score` 0-100 = qué tan CALIENTE está el lead (actividad: golpes, recencia,
 *     conversión, canal). Se recomputa en cada golpe (hook en leadSync).
 *   - `grade` A-F = qué tan IDEAL es el lead (fit demográfico: email/empresa/valor/
 *     origen/UTM), independiente de su actividad.
 *
 * Configurable por tenant (patrón `_shared/suppression.ts`): tabla
 * `connectview-scoring-rules` (PK=tenantId) con pesos, + un DEFAULT sensato
 * out-of-the-box. El cliente ajusta pesos sin re-deploy. Fail-open: si la lectura
 * falla, usa el default.
 *
 * Puro sobre sus inputs (computeScore/computeGrade): testeable sin AWS.
 */
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const RULES_TABLE = process.env.SCORING_RULES_TABLE || "connectview-scoring-rules";
const DAY_MS = 86_400_000;

export type Grade = "A" | "B" | "C" | "D" | "F";

/** Señales de COMPORTAMIENTO para el score (todas salen del ledger del Pilar 2). */
export interface ScoreSignals {
  golpesTotal: number;
  converted: boolean;
  lastTouchAt?: string;
  source?: string;
  /** "now" en ms — inyectable para tests; default Date.now() en runtime. */
  nowMs?: number;
}

/** Señales de FIT demográfico para el grado (independientes de la actividad). */
export interface GradeSignals {
  source?: string;
  hasEmail: boolean;
  hasCompany: boolean;
  hasValue: boolean; // montoEstimado > 0
  attributes?: Record<string, string>;
}

export interface ScoringRules {
  tenantId?: string;
  behavior: {
    base: number;
    perGolpe: number;
    golpeCap: number;
    converted: number;
    recencyFreshDays: number;
    recencyFreshBonus: number;
    recencyDecayPerDay: number;
    recencyDecayCap: number;
    sourceBonus: Record<string, number>;
  };
  grading: {
    hasEmail: number;
    hasCompany: number;
    hasValue: number;
    hasUtm: number;
    sourceFit: Record<string, number>;
    thresholds: { A: number; B: number; C: number; D: number };
  };
  updatedAt?: string;
  updatedBy?: string;
}

/** Defaults sensatos — el tenant los sobreescribe en Configuración. */
export const DEFAULT_SCORING_RULES: ScoringRules = {
  behavior: {
    base: 40,
    perGolpe: 6,
    golpeCap: 30, // ~5 golpes maxean el aporte por actividad
    converted: 20,
    recencyFreshDays: 2,
    recencyFreshBonus: 10,
    recencyDecayPerDay: 1,
    recencyDecayCap: 15,
    sourceBonus: { WhatsApp: 5, "Meta Lead Ads": 5, referral: 3, whatsapp: 5 },
  },
  grading: {
    hasEmail: 25,
    hasCompany: 20,
    hasValue: 25,
    hasUtm: 10,
    sourceFit: {
      referral: 20,
      "Meta Lead Ads": 15,
      WhatsApp: 15,
      whatsapp: 15,
      web_form: 10,
      manual: 5,
    },
    thresholds: { A: 75, B: 55, C: 35, D: 15 },
  },
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Score de comportamiento 0-100. Devuelve el número + el desglose (audit) de qué
 * aportó cada señal, para transparencia en la UI. Puro.
 */
export function computeScore(
  sig: ScoreSignals,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
): { score: number; inputs: Record<string, number> } {
  const b = rules.behavior;
  const inputs: Record<string, number> = {};
  inputs.base = b.base;
  inputs.golpes = Math.min(b.golpeCap, (sig.golpesTotal || 0) * b.perGolpe);
  inputs.converted = sig.converted ? b.converted : 0;
  // Recencia: fresco suma, viejo resta (con tope).
  let recency = 0;
  if (sig.lastTouchAt) {
    const now = sig.nowMs ?? Date.now();
    const days = (now - new Date(sig.lastTouchAt).getTime()) / DAY_MS;
    if (days >= 0) {
      recency =
        days <= b.recencyFreshDays
          ? b.recencyFreshBonus
          : -Math.min(b.recencyDecayCap, Math.round(days * b.recencyDecayPerDay));
    }
  }
  inputs.recency = recency;
  inputs.source = sig.source ? b.sourceBonus[sig.source] || 0 : 0;
  const raw = Object.values(inputs).reduce((a, c) => a + c, 0);
  return { score: Math.round(clamp(raw, 0, 100)), inputs };
}

/** Grado A-F de fit demográfico. Puro. */
export function computeGrade(
  sig: GradeSignals,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
): Grade {
  const g = rules.grading;
  let fit = 0;
  if (sig.hasEmail) fit += g.hasEmail;
  if (sig.hasCompany) fit += g.hasCompany;
  if (sig.hasValue) fit += g.hasValue;
  if (sig.source) fit += g.sourceFit[sig.source] || 0;
  const attrs = sig.attributes || {};
  if (Object.keys(attrs).some((k) => /^utm_/i.test(k))) fit += g.hasUtm;
  const t = g.thresholds;
  if (fit >= t.A) return "A";
  if (fit >= t.B) return "B";
  if (fit >= t.C) return "C";
  if (fit >= t.D) return "D";
  return "F";
}

// ── Config por tenant (cacheada, fail-open) ──────────────────────────────────
const cache = new Map<string, { rules: ScoringRules; exp: number }>();
const TTL_MS = 60_000;

/** Lee las reglas del tenant (merge sobre el default), cacheado 60s. Fail-open. */
export async function getScoringRules(
  dynamo: DynamoDBClient,
  tenantId?: string,
): Promise<ScoringRules> {
  const key = tenantId || "_legacy";
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.rules;
  let rules: ScoringRules = { tenantId: key, ...DEFAULT_SCORING_RULES };
  try {
    const r = await dynamo.send(
      new GetItemCommand({ TableName: RULES_TABLE, Key: { tenantId: { S: key } } }),
    );
    if (r.Item) {
      const stored = unmarshall(r.Item) as Partial<ScoringRules>;
      rules = {
        tenantId: key,
        behavior: { ...DEFAULT_SCORING_RULES.behavior, ...(stored.behavior || {}) },
        grading: { ...DEFAULT_SCORING_RULES.grading, ...(stored.grading || {}) },
        updatedAt: stored.updatedAt,
        updatedBy: stored.updatedBy,
      };
    }
  } catch (err) {
    console.warn("getScoringRules failed (default):", err instanceof Error ? err.message : err);
  }
  cache.set(key, { rules, exp: Date.now() + TTL_MS });
  return rules;
}

/** Guarda las reglas del tenant (merge sobre el default). Invalida el cache. */
export async function saveScoringRules(
  dynamo: DynamoDBClient,
  tenantId: string,
  patch: Partial<ScoringRules>,
  actor?: string,
): Promise<ScoringRules> {
  const merged: ScoringRules = {
    tenantId,
    behavior: { ...DEFAULT_SCORING_RULES.behavior, ...(patch.behavior || {}) },
    grading: { ...DEFAULT_SCORING_RULES.grading, ...(patch.grading || {}) },
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: RULES_TABLE,
      Item: marshall(merged, { removeUndefinedValues: true }),
    }),
  );
  cache.delete(tenantId);
  return merged;
}
