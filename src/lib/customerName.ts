/**
 * Smart customer-name resolution.
 *
 * Profiles in this account get synced from Salesforce / inbound webhooks
 * which sometimes populate `BusinessName` with a numeric account number
 * (e.g. "70498978") rather than a real company name. When the agent then
 * edits FirstName/LastName, they (rightly) expect the display to reflect
 * those edits — not keep showing the meaningless ID.
 *
 * The functions here implement that "be smart about it" rule:
 *   - Person name (FirstName [MiddleName] LastName) wins when set
 *   - BusinessName wins only when it looks like a real name
 *   - ID-like BusinessName values (all-digits, UUIDs, SF 15/18-char ids)
 *     are filtered out — we fall back to email / phone instead
 *
 * Mirror these in any Lambda that surfaces a name (list-recent-customers,
 * search-customer-profiles) so the rule is consistent server-side too.
 */

/**
 * Heuristic: does the string look like an account/ID rather than a
 * human-readable name?
 *
 * Returns `true` for: pure digits, mostly-digits, UUIDs, Salesforce
 * 15/18-char alphanumeric IDs. Returns `false` for normal names —
 * including ones with accents, ampersands, and one or two numerals
 * (e.g. "ACME 2", "3M Corp").
 */
export function looksLikeId(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = raw.trim();
  if (!s) return false;
  // Pure digits → almost certainly an account number.
  if (/^\d+$/.test(s)) return true;
  // UUID v1-5 (with or without braces).
  if (/^[{(]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[)}]?$/i.test(s))
    return true;
  // Salesforce-style ID (15 or 18 alphanumeric, no spaces, no
  // lowercase letters at fixed positions — common pattern: 0058...).
  if (/^[A-Z0-9]{15}$|^[A-Z0-9]{18}$/.test(s)) return true;
  // Mostly-digits string with no spaces (e.g. "70498978-1", "ACC123456").
  // Threshold: ≥70% digits AND no whitespace.
  if (!/\s/.test(s)) {
    const digits = (s.match(/\d/g) || []).length;
    if (digits >= 5 && digits / s.length >= 0.7) return true;
  }
  return false;
}

/** Minimal profile shape this module reads — works for both the
 *  CustomerProfile type and the recents / search Lambda projections. */
export interface NamedProfile {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}

/** Concatenated person name (First [Middle] Last), trimmed. Empty
 *  string when no name parts are set. */
export function personName(p: NamedProfile): string {
  return [p.firstName, p.middleName, p.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Pick the best human-readable name for the customer.
 *
 * Priority:
 *   1. Person name (First [Middle] Last) if any part is set
 *   2. BusinessName if it doesn't look like an ID
 *   3. Email
 *   4. PhoneNumber
 *   5. The provided fallback (default: "Cliente")
 */
export function displayCustomerName(
  p: NamedProfile,
  fallback: string = "Cliente"
): string {
  const person = personName(p);
  if (person) return person;
  const business = p.businessName?.trim();
  if (business && !looksLikeId(business)) return business;
  if (p.email?.trim()) return p.email.trim();
  if (p.phoneNumber?.trim()) return p.phoneNumber.trim();
  return fallback;
}

/** Sub-line companion: only return BusinessName when it makes sense
 *  to show as a company / organization context (NOT when it's a
 *  Salesforce account-number ID that would just add noise).
 *  Returns null when nothing useful to show. */
export function displayBusinessLine(p: NamedProfile): string | null {
  const business = p.businessName?.trim();
  if (!business) return null;
  if (looksLikeId(business)) return null;
  return business;
}
