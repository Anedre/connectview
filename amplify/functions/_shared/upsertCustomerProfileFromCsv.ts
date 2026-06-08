import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  CreateProfileCommand,
  UpdateProfileCommand,
  type Profile,
} from "@aws-sdk/client-customer-profiles";

// Legacy (Novasys) defaults. SOLO se usan cuando el caller NO pasa `ctx`
// (tenant fundador / paths legacy single-tenant). Un tenant real SIEMPRE pasa
// su `ctx` (CP resuelto o bloqueado, vía resolveCustomerProfiles) → así nunca
// escribimos los perfiles de otro tenant en el dominio de Novasys.
const LEGACY_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";

const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });

/** Customer Profiles tenant-scoped que el caller resuelve con
 *  `resolveCustomerProfiles` y pasa explícitamente. `domainName === ""` →
 *  fail-closed: el upsert se saltea (no se escribe nada). */
export interface ProfilesCtx {
  profiles: CustomerProfilesClient;
  domainName: string;
}

export interface CsvContact {
  phone: string;
  customerName?: string;
  attributes?: Record<string, string>;
}

interface MappedFields {
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  PhoneNumber?: string;
  MobilePhoneNumber?: string;
  AccountNumber?: string;
  BusinessName?: string;
  BirthDate?: string;
  Address?: { City?: string; Address1?: string };
  Attributes?: Record<string, string>;
}

// Keywords identifying how each CSV column maps to a Customer Profiles
// standard field. Case-insensitive substring match — first hit wins.
// Anything that doesn't match here is kept in the Attributes bag so the
// agent UI can still see it on the profile.
const FIELD_KEYWORDS: Array<{ field: keyof MappedFields; keys: string[] }> = [
  { field: "EmailAddress", keys: ["email", "correo", "mail"] },
  {
    field: "AccountNumber",
    keys: ["dni", "cedula", "cédula", "documento", "ruc", "id_cliente", "idcliente", "account"],
  },
  { field: "BusinessName", keys: ["empresa", "company", "business", "razon social", "razonsocial"] },
  { field: "BirthDate", keys: ["birthdate", "cumple", "nacimiento", "fecha_nac", "dob"] },
  { field: "MobilePhoneNumber", keys: ["celular", "movil", "móvil", "mobile", "whatsapp"] },
];

const ADDRESS_KEYS = ["direccion", "dirección", "address", "domicilio"];
const CITY_KEYS = ["ciudad", "city", "localidad"];

function splitName(full: string): { firstName?: string; lastName?: string } {
  const trimmed = (full || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return {};
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function matchKey(header: string, keys: string[]): boolean {
  const h = header.trim().toLowerCase();
  return keys.some((kw) => h === kw || h.includes(kw));
}

function mapCsvToProfileFields(c: CsvContact): MappedFields {
  const out: MappedFields = {};
  const remainingAttrs: Record<string, string> = {};

  // Name → FirstName / LastName
  const { firstName, lastName } = splitName(c.customerName || "");
  if (firstName) out.FirstName = firstName;
  if (lastName) out.LastName = lastName;

  // Phone is always the lookup phone (E.164). We set PhoneNumber so the
  // _phone key index picks it up. The CSV phone is the source of truth.
  out.PhoneNumber = c.phone;

  // Walk every attribute and decide whether it maps to a standard field
  // or stays in the Attributes bag.
  for (const [rawKey, rawVal] of Object.entries(c.attributes || {})) {
    const val = (rawVal ?? "").toString().trim();
    if (!val) continue;
    let matched = false;
    for (const { field, keys } of FIELD_KEYWORDS) {
      if (matchKey(rawKey, keys)) {
        if (!out[field]) {
          // Set as string. TS narrowing aside, all targets here are strings.
          (out as Record<string, string>)[field as string] = val;
        }
        matched = true;
        break;
      }
    }
    if (!matched && matchKey(rawKey, ADDRESS_KEYS)) {
      out.Address = { ...(out.Address || {}), Address1: val };
      matched = true;
    }
    if (!matched && matchKey(rawKey, CITY_KEYS)) {
      out.Address = { ...(out.Address || {}), City: val };
      matched = true;
    }
    if (!matched) {
      remainingAttrs[rawKey] = val;
    }
  }

  if (Object.keys(remainingAttrs).length > 0) out.Attributes = remainingAttrs;
  return out;
}

async function findProfileByPhone(
  phone: string,
  client: CustomerProfilesClient,
  domainName: string
): Promise<Profile | null> {
  const res = await client.send(
    new SearchProfilesCommand({
      DomainName: domainName,
      KeyName: "_phone",
      Values: [phone],
    })
  );
  return res.Items?.[0] || null;
}

interface UpsertResult {
  phone: string;
  action: "created" | "updated" | "skipped" | "error";
  profileId?: string;
  error?: string;
}

export async function upsertProfileFromCsvContact(
  c: CsvContact,
  ctx?: ProfilesCtx
): Promise<UpsertResult> {
  const phone = (c.phone || "").trim();
  if (!/^\+\d{8,15}$/.test(phone)) {
    return { phone, action: "skipped", error: "invalid phone" };
  }

  // Customer Profiles tenant-scoped (ctx) o legacy Novasys (sin ctx). Fail-closed:
  // tenant real sin dominio CP resuelto (domainName "") → skip; NUNCA escribimos
  // este perfil en el dominio de Novasys (= leak/contaminación cross-tenant).
  const profilesClient = ctx?.profiles ?? legacyProfiles;
  const domainName = ctx ? ctx.domainName : LEGACY_DOMAIN;
  if (!domainName) {
    return {
      phone,
      action: "skipped",
      error: "customer profiles not configured for tenant",
    };
  }

  // If the CSV brought NOTHING but a phone, there's nothing to write —
  // don't churn the profile store with empty updates.
  const hasName = !!(c.customerName || "").trim();
  const hasAttrs = !!c.attributes && Object.keys(c.attributes).length > 0;
  if (!hasName && !hasAttrs) {
    return { phone, action: "skipped", error: "no enrichment data" };
  }

  const mapped = mapCsvToProfileFields(c);

  try {
    const existing = await findProfileByPhone(phone, profilesClient, domainName);

    if (existing) {
      // Merge attributes — CSV wins for the keys it brings, existing
      // attrs are preserved otherwise. Passing Attributes to UpdateProfile
      // FULLY replaces the map, so we must merge here.
      const mergedAttrs = {
        ...(existing.Attributes || {}),
        ...(mapped.Attributes || {}),
      };
      await profilesClient.send(
        new UpdateProfileCommand({
          DomainName: domainName,
          ProfileId: existing.ProfileId!,
          // Standard fields — only sent when CSV had a value. Undefined
          // leaves the existing value untouched.
          FirstName: mapped.FirstName,
          LastName: mapped.LastName,
          EmailAddress: mapped.EmailAddress,
          PhoneNumber: mapped.PhoneNumber,
          MobilePhoneNumber: mapped.MobilePhoneNumber,
          AccountNumber: mapped.AccountNumber,
          BusinessName: mapped.BusinessName,
          BirthDate: mapped.BirthDate,
          Address: mapped.Address
            ? { ...(existing.Address || {}), ...mapped.Address }
            : undefined,
          Attributes:
            Object.keys(mergedAttrs).length > 0 ? mergedAttrs : undefined,
        })
      );
      return { phone, action: "updated", profileId: existing.ProfileId };
    }

    const created = await profilesClient.send(
      new CreateProfileCommand({
        DomainName: domainName,
        FirstName: mapped.FirstName,
        LastName: mapped.LastName,
        EmailAddress: mapped.EmailAddress,
        PhoneNumber: mapped.PhoneNumber,
        MobilePhoneNumber: mapped.MobilePhoneNumber,
        AccountNumber: mapped.AccountNumber,
        BusinessName: mapped.BusinessName,
        BirthDate: mapped.BirthDate,
        Address: mapped.Address,
        Attributes: mapped.Attributes,
      })
    );
    return { phone, action: "created", profileId: created.ProfileId };
  } catch (err) {
    return {
      phone,
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fan out upserts for a list of CSV contacts with bounded concurrency
 * and a soft deadline. Returns a summary; never throws. The deadline
 * exists because the calling Lambda has a finite timeout (30s for
 * create-campaign) — for very large CSVs we'd rather finish what we can
 * and let the campaign creation succeed than time out the whole call.
 */
export async function bulkUpsertProfilesFromCsv(
  contacts: CsvContact[],
  opts: { concurrency?: number; deadlineMs?: number } = {},
  ctx?: ProfilesCtx
): Promise<{
  attempted: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  dropped: number;
}> {
  const concurrency = Math.max(1, Math.min(50, opts.concurrency ?? 20));
  const deadline = Date.now() + Math.max(1000, opts.deadlineMs ?? 20_000);

  const summary = {
    attempted: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    dropped: 0,
  };

  let cursor = 0;
  const total = contacts.length;

  async function worker() {
    while (cursor < total) {
      if (Date.now() > deadline) {
        // Out of time — count the remaining as "dropped" and bail. The
        // contact is still in the campaign; only the profile enrichment
        // is incomplete.
        summary.dropped += total - cursor;
        cursor = total;
        return;
      }
      const idx = cursor++;
      const c = contacts[idx];
      summary.attempted++;
      const r = await upsertProfileFromCsvContact(c, ctx);
      if (r.action === "created") summary.created++;
      else if (r.action === "updated") summary.updated++;
      else if (r.action === "skipped") summary.skipped++;
      else summary.errors++;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker())
  );
  return summary;
}
