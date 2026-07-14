import Papa from "papaparse";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface ParsedContact {
  phone: string; // E.164
  customerName: string;
  attributes: Record<string, string>;
  originalRow: Record<string, string>;
}

export interface CsvParseResult {
  contacts: ParsedContact[];
  skipped: Array<{ row: Record<string, string>; reason: string }>;
  detected: {
    phoneColumn: string | null;
    nameColumn: string | null;
    firstNameColumn: string | null;
    lastNameColumn: string | null;
    attributeColumns: string[];
    rowCount: number;
  };
}

// Keywords that identify column purpose. Match case-insensitively, whole words or substrings.
const PHONE_KEYWORDS = [
  "phone",
  "telefono",
  "teléfono",
  "celular",
  "movil",
  "móvil",
  "mobile",
  "whatsapp",
  "cellphone",
  "tel",
  "number",
  "numero",
  "número",
];
const NAME_KEYWORDS = ["name", "nombre", "cliente", "customer", "contacto"];
const FIRST_NAME_KEYWORDS = ["firstname", "first_name", "nombre", "givenname"];
const LAST_NAME_KEYWORDS = ["lastname", "last_name", "apellido", "surname", "familyname"];

function headerMatches(header: string, keywords: string[]): boolean {
  const h = header.trim().toLowerCase();
  return keywords.some((kw) => h === kw || h.includes(kw));
}

// Auto-detect which column holds phone numbers if no header matches.
function detectPhoneColumnByValues(
  rows: Record<string, string>[],
  headers: string[],
  defaultCountry: CountryCode = "PE",
): string | null {
  const sampleSize = Math.min(5, rows.length);
  let bestHeader: string | null = null;
  let bestScore = 0;
  for (const h of headers) {
    let score = 0;
    for (let i = 0; i < sampleSize; i++) {
      const v = (rows[i][h] || "").toString().trim();
      if (!v) continue;
      // Fast regex sanity check first
      if (!/^[+\d][\d\s\-().]{6,}$/.test(v)) continue;
      // Then validate with libphonenumber
      const parsed = parsePhoneNumberFromString(v, defaultCountry);
      if (parsed && parsed.isValid()) score++;
    }
    // Score normalized to ratio; require > 60% of sample to look like phones
    if (score > bestScore && score / sampleSize >= 0.6) {
      bestScore = score;
      bestHeader = h;
    }
  }
  return bestHeader;
}

export function normalizePhone(raw: string, defaultCountry: CountryCode = "PE"): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const c of candidates) {
    const count = firstLine.split(c).length - 1;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

export async function parseCsvText(
  text: string,
  defaultCountry: CountryCode = "PE",
): Promise<CsvParseResult> {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const delimiter = detectDelimiter(firstLine);

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      delimiter,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        try {
          const rows = result.data as Record<string, string>[];
          const headers = result.meta.fields || [];

          // Detect columns by header keywords first.
          let phoneColumn: string | null =
            headers.find((h) => headerMatches(h, PHONE_KEYWORDS)) || null;
          // Fallback: detect by sampling values.
          if (!phoneColumn) {
            phoneColumn = detectPhoneColumnByValues(rows, headers, defaultCountry);
          }

          const firstNameColumn =
            headers.find((h) => headerMatches(h, FIRST_NAME_KEYWORDS)) || null;
          const lastNameColumn = headers.find((h) => headerMatches(h, LAST_NAME_KEYWORDS)) || null;
          let nameColumn: string | null = null;
          if (!firstNameColumn && !lastNameColumn) {
            nameColumn = headers.find((h) => headerMatches(h, NAME_KEYWORDS)) || null;
          }

          // Everything else is an attribute column (to be passed to the contact flow).
          const usedColumns = new Set(
            [phoneColumn, nameColumn, firstNameColumn, lastNameColumn].filter(
              (x): x is string => !!x,
            ),
          );
          const attributeColumns = headers.filter((h) => !usedColumns.has(h));

          const contacts: ParsedContact[] = [];
          const skipped: Array<{
            row: Record<string, string>;
            reason: string;
          }> = [];

          if (!phoneColumn) {
            resolve({
              contacts: [],
              skipped: rows.map((r) => ({
                row: r,
                reason: "No phone column detected",
              })),
              detected: {
                phoneColumn: null,
                nameColumn: null,
                firstNameColumn: null,
                lastNameColumn: null,
                attributeColumns: headers,
                rowCount: rows.length,
              },
            });
            return;
          }

          for (const row of rows) {
            const phoneRaw = row[phoneColumn];
            const phone = normalizePhone(phoneRaw, defaultCountry);
            if (!phone) {
              skipped.push({ row, reason: `Invalid phone: "${phoneRaw}"` });
              continue;
            }
            // Build customerName
            let customerName = "";
            if (firstNameColumn || lastNameColumn) {
              customerName = [
                firstNameColumn ? row[firstNameColumn] : "",
                lastNameColumn ? row[lastNameColumn] : "",
              ]
                .filter(Boolean)
                .join(" ")
                .trim();
            } else if (nameColumn) {
              customerName = (row[nameColumn] || "").trim();
            }

            const attributes: Record<string, string> = {};
            for (const col of attributeColumns) {
              const val = (row[col] || "").trim();
              if (val) attributes[col] = val;
            }

            contacts.push({
              phone,
              customerName,
              attributes,
              originalRow: row,
            });
          }

          resolve({
            contacts,
            skipped,
            detected: {
              phoneColumn,
              nameColumn,
              firstNameColumn,
              lastNameColumn,
              attributeColumns,
              rowCount: rows.length,
            },
          });
        } catch (err) {
          reject(err);
        }
      },
      error: (err: unknown) => reject(err),
    });
  });
}

// Parse a free-form list (newlines / commas) of phone numbers.
export function parsePhoneList(
  text: string,
  defaultCountry: CountryCode = "PE",
): { contacts: ParsedContact[]; skipped: string[] } {
  const tokens = text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const contacts: ParsedContact[] = [];
  const skipped: string[] = [];
  for (const t of tokens) {
    const phone = normalizePhone(t, defaultCountry);
    if (!phone) {
      skipped.push(t);
      continue;
    }
    contacts.push({
      phone,
      customerName: "",
      attributes: {},
      originalRow: { phone: t },
    });
  }
  return { contacts, skipped };
}
