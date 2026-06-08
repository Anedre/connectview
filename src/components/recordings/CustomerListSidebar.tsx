import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { getApiEndpoints } from "@/lib/api";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useCustomerNamesByPhone } from "@/hooks/useCustomerNamesByPhone";
import { useLeadNamesByPhone } from "@/hooks/useLeadNamesByPhone";
import { Avatar, colorFromName } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

export interface CustomerSummary {
  profileId?: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  accountNumber?: string;
  matchedBy?: string;
  /** When set, this customer came from "recent" — used to show a small
   *  "Atendido hace X" hint under the name. */
  lastContactAt?: string;
  lastChannel?: string;
  contactCount?: number;
}

interface Props {
  selectedKey: string | null; // phoneNumber or email of selected customer
  onSelect: (c: CustomerSummary) => void;
}

interface SearchResult {
  profileId: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  accountNumber?: string;
  partyType?: string;
  matchedBy: "phone" | "email" | "account" | "name" | "recent";
}

interface RecentCustomerRaw {
  customerPhone: string;
  lastContactTime: string;
  lastChannel: string;
  lastQueueName?: string;
  lastDuration?: number;
  lastContactId: string;
  contactCount: number;
}

/**
 * Left-rail customer picker for the Recordings page. Two modes:
 *  - Empty query → recent customers (last 30, ordered by lastContactTime)
 *  - Typed query (≥ 2 chars) → predictive autocomplete via searchCustomerProfiles
 *
 * Debounces the search to 250 ms so we don't hammer Connect Customer
 * Profiles with one request per keystroke. Cleanly cancels in-flight
 * searches when the query changes again.
 */
export function CustomerListSidebar({ selectedKey, onSelect }: Props) {
  const { user } = useConnectAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recents, setRecents] = useState<RecentCustomerRaw[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Recents (idle list) ─────────────────────────────────────────
  useEffect(() => {
    const endpoints = getApiEndpoints();
    const username = user?.username;
    if (!endpoints?.listRecentCustomers || !username) return;
    let cancelled = false;
    fetch(
      `${endpoints.listRecentCustomers}?agentUsername=${encodeURIComponent(
        username
      )}&limit=30`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRecents(data.items || []);
      })
      .catch(() => {
        /* swallow — recents are optional */
      });
    return () => {
      cancelled = true;
    };
  }, [user?.username]);

  // ─── Autocomplete (debounced) ────────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const endpoints = getApiEndpoints();
      if (!endpoints?.searchCustomerProfiles) {
        setError("Búsqueda no configurada");
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(
          `${endpoints.searchCustomerProfiles}?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal }
        );
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        setResults(data.results || []);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error de búsqueda");
        setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const composeName = (r: { firstName?: string; lastName?: string; businessName?: string; phoneNumber?: string; email?: string }) => {
    const person = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
    const biz = r.businessName && r.businessName !== "Lead sin empresa" ? r.businessName : "";
    return person || biz || r.email || r.phoneNumber || "(sin nombre)";
  };

  // Resolver el NOMBRE de cada teléfono reciente para mostrar nombres (no números).
  // Fuente primaria: la tabla de Leads (nombre autoritativo). Fallback: Customer Profiles.
  const leadNames = useLeadNamesByPhone();
  const recentPhones = recents
    .map((r) => r.customerPhone)
    .filter((p) => p && !p.includes("@"));
  const recentNames = useCustomerNamesByPhone(recentPhones);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Search input */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-1)" }}>
        <div
          style={{
            display: "flex",
            gap: 6,
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: 6,
            padding: "6px 8px",
            alignItems: "center",
          }}
        >
          <Icon.Search size={14} style={{ color: "var(--text-3)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, teléfono, email o cuenta…"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: 0,
              outline: "none",
              fontSize: 12.5,
              color: "var(--text-1)",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="btn btn--ghost btn--sm btn--icon"
              title="Limpiar"
              aria-label="Limpiar búsqueda"
            >
              <Icon.Close size={11} />
            </button>
          )}
        </div>
        {query.length === 1 && (
          <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
            Escribe al menos 2 caracteres para buscar.
          </div>
        )}
      </div>

      {/* Search results or recents */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading && (
          <div
            className="muted"
            style={{ padding: 14, textAlign: "center", fontSize: 12 }}
          >
            Buscando…
          </div>
        )}

        {error && !loading && (
          <div
            style={{
              padding: 10,
              margin: "8px 12px",
              background: "var(--accent-red-soft)",
              color: "var(--accent-red)",
              borderRadius: 6,
              fontSize: 11.5,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}

        {/* AUTOCOMPLETE RESULTS */}
        {!loading && results.length > 0 && (
          <div style={{ padding: "6px 8px" }}>
            <div
              className="muted"
              style={{
                fontSize: 10.5,
                padding: "4px 6px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {results.length} resultado{results.length === 1 ? "" : "s"}
            </div>
            {results.map((r) => {
              const name = composeName(r);
              const key = r.phoneNumber || r.email || r.profileId;
              const isSelected = key === selectedKey;
              return (
                <CustomerRow
                  key={r.profileId}
                  name={name}
                  primary={r.phoneNumber || r.email || r.accountNumber || "—"}
                  secondary={
                    r.matchedBy === "phone"
                      ? "Match: teléfono"
                      : r.matchedBy === "email"
                      ? "Match: email"
                      : r.matchedBy === "account"
                      ? "Match: cuenta"
                      : "Match: nombre"
                  }
                  selected={isSelected}
                  onClick={() => onSelect({ ...r, matchedBy: r.matchedBy })}
                />
              );
            })}
          </div>
        )}

        {!loading && query.trim().length >= 2 && results.length === 0 && !error && (
          <div
            className="muted"
            style={{ padding: 18, textAlign: "center", fontSize: 11.5 }}
          >
            Sin coincidencias para “{query.trim()}”.
          </div>
        )}

        {/* RECENT LIST (no query) */}
        {!query.trim() && (
          <div style={{ padding: "6px 8px" }}>
            <div
              className="muted"
              style={{
                fontSize: 10.5,
                padding: "4px 6px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Atendidos recientemente
            </div>
            {recents.length === 0 ? (
              <div
                className="muted"
                style={{
                  padding: 14,
                  textAlign: "center",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                }}
              >
                Sin contactos recientes. Empieza a escribir un nombre o
                teléfono para buscar.
              </div>
            ) : (
              recents.map((r) => {
                const isEmail = r.customerPhone.includes("@");
                const key = r.customerPhone;
                const isSelected = key === selectedKey;
                const relTime = (() => {
                  try {
                    return formatDistanceToNow(new Date(r.lastContactTime), {
                      addSuffix: true,
                      locale: es,
                    });
                  } catch {
                    return "";
                  }
                })();
                const channelIcon =
                  r.lastChannel === "CHAT"
                    ? "💬"
                    : r.lastChannel === "EMAIL"
                    ? "📧"
                    : r.lastChannel === "TASK"
                    ? "📝"
                    : "📞";
                // Nombre resuelto: lead (autoritativo) → perfil → teléfono. El
                // teléfono pasa a la línea secundaria (conectado al nombre, no como título).
                const resolvedName = leadNames[r.customerPhone] || recentNames[r.customerPhone];
                const displayName = resolvedName || r.customerPhone;
                return (
                  <CustomerRow
                    key={r.customerPhone}
                    name={displayName}
                    primary={`${channelIcon} ${relTime}${r.contactCount > 1 ? ` · ${r.contactCount} contactos` : ""}`}
                    secondary={resolvedName && !isEmail ? r.customerPhone : r.lastQueueName || ""}
                    selected={isSelected}
                    onClick={() =>
                      onSelect({
                        profileId: r.customerPhone,
                        firstName: resolvedName || undefined,
                        phoneNumber: isEmail ? undefined : r.customerPhone,
                        email: isEmail ? r.customerPhone : undefined,
                        lastContactAt: r.lastContactTime,
                        lastChannel: r.lastChannel,
                        contactCount: r.contactCount,
                        matchedBy: "recent",
                      })
                    }
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerRow({
  name,
  primary,
  secondary,
  selected,
  onClick,
}: {
  name: string;
  primary: string;
  secondary?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        width: "100%",
        padding: "8px 10px",
        gap: 10,
        alignItems: "center",
        textAlign: "left",
        background: selected ? "var(--accent-cyan-soft)" : "transparent",
        border: 0,
        borderRadius: 8,
        cursor: "pointer",
        color: "var(--text-1)",
        marginBottom: 2,
      }}
      onMouseEnter={(e) => {
        if (!selected)
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--bg-2)";
      }}
      onMouseLeave={(e) => {
        if (!selected)
          (e.currentTarget as HTMLButtonElement).style.background =
            "transparent";
      }}
    >
      <Avatar name={name} size="sm" color={colorFromName(name)} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--text-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span
          className="muted"
          style={{
            display: "block",
            fontSize: 10.5,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {primary}
        </span>
        {secondary && (
          <span
            className="muted"
            style={{
              display: "block",
              fontSize: 10,
              marginTop: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {secondary}
          </span>
        )}
      </span>
    </button>
  );
}
