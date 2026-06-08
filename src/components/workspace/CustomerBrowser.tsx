import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { getApiEndpoints } from "@/lib/api";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { CustomerProfilePanel } from "@/components/workspace/CustomerProfilePanel";
import { EditProfileModal } from "@/components/workspace/EditProfileModal";
import { Avatar, colorFromName } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { displayCustomerName } from "@/lib/customerName";
import { FeatureNotice } from "@/components/vox/FeatureNotice";

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

interface RecentCustomer {
  customerPhone: string;
  lastContactTime: string;
  lastChannel: string;
  lastQueueName?: string;
  lastDuration?: number;
  lastContactId: string;
  contactCount: number;
  // Enriched fields from the list-recent-customers Lambda (added by
  // SearchProfiles). Optional — old Lambda payloads still work without.
  firstName?: string;
  lastName?: string;
  businessName?: string;
  email?: string;
  partyType?: string;
}

/** Resolve the best display name for a recent customer entry.
 *  Delegates to the shared lib/customerName resolver — which also
 *  filters out ID-like BusinessName values (e.g. "70498978"). */
function recentDisplayName(r: RecentCustomer): string {
  const phoneIsEmail = r.customerPhone?.includes("@");
  return displayCustomerName(
    {
      firstName: r.firstName,
      lastName: r.lastName,
      businessName: r.businessName,
      email: r.email || (phoneIsEmail ? r.customerPhone : undefined),
      phoneNumber: phoneIsEmail ? undefined : r.customerPhone,
    },
    r.customerPhone
  );
}

/**
 * Idle "Cliente 360°" browser — shown in the right column of the agent
 * desktop whenever there is no active contact. Lets the agent:
 *   - Search profiles by phone, email, name (SearchProfiles wrapper)
 *   - Pick a result → full inline profile view (CustomerProfilePanel)
 *   - Edit the profile (EditProfileModal → UpdateProfile)
 *
 * Replaces the previous "Cliente 360° aparece al recibir una llamada"
 * empty state, which gave the column zero utility while idle.
 */
export function CustomerBrowser() {
  const { user } = useConnectAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Recently-contacted customers (idle list) ───────────────────
  const [recents, setRecents] = useState<RecentCustomer[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(false);
  const [recentsError, setRecentsError] = useState<string | null>(null);

  const fetchRecents = async () => {
    const endpoints = getApiEndpoints();
    const username = user?.username;
    if (!endpoints?.listRecentCustomers || !username) return;
    setRecentsLoading(true);
    setRecentsError(null);
    try {
      const r = await fetch(
        `${endpoints.listRecentCustomers}?agentUsername=${encodeURIComponent(
          username
        )}&limit=12`
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setRecents(data.items || []);
    } catch (e) {
      setRecentsError(
        e instanceof Error ? e.message : "Error cargando recientes"
      );
    } finally {
      setRecentsLoading(false);
    }
  };

  // Fetch once on mount + when the user changes
  useEffect(() => {
    fetchRecents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username]);

  // Auto-focus the search input on mount so the agent can start typing
  // immediately when they land on the idle desktop.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.searchCustomerProfiles) {
      setError("Endpoint searchCustomerProfiles no configurado");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Server-side search hits exact-match indexed keys (_phone, _email,
      // _fullName). For partial names we ALSO scan the locally-cached
      // `recents` list (which is name-enriched from list-recent-customers)
      // and substring-match on the agent's typed text. This is what makes
      // "Miguel" actually find "Miguel Vega Android" even though Connect
      // doesn't have a _firstName indexed key on this domain.
      const r = await fetch(
        `${endpoints.searchCustomerProfiles}?q=${encodeURIComponent(trimmed)}`
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const serverResults: SearchResult[] = data.results || [];

      // Local fuzzy search over recents — case-insensitive substring
      // match on the resolved display name, business, first/last name.
      const isText = !/@/.test(trimmed) && !/^[+\d\s()-]+$/.test(trimmed);
      const norm = trimmed.toLowerCase();
      const localResults: SearchResult[] = isText
        ? recents
            .filter((r) => {
              const hay = [
                r.firstName,
                r.lastName,
                r.businessName,
                r.email,
                recentDisplayName(r),
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return hay.includes(norm);
            })
            .map((r) => ({
              profileId: r.customerPhone, // placeholder — re-resolved on click
              firstName: r.firstName,
              lastName: r.lastName,
              businessName: r.businessName,
              phoneNumber: r.customerPhone.includes("@")
                ? undefined
                : r.customerPhone,
              email: r.customerPhone.includes("@")
                ? r.customerPhone
                : r.email,
              partyType: r.partyType,
              matchedBy: "name" as const,
            }))
        : [];

      // Merge unique by profileId / phone fallback. Server results first
      // so exact-match hits beat fuzzy ones.
      const seen = new Set<string>();
      const merged: SearchResult[] = [];
      for (const r of [...serverResults, ...localResults]) {
        const key = r.profileId || r.phoneNumber || r.email || "";
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        merged.push(r);
      }

      setResults(merged);
      if (merged.length === 0) {
        setError("Sin resultados");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error en la búsqueda");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Búsqueda EN VIVO (typeahead): dispara mientras el agente escribe, con debounce
  // de 300ms para no martillar SearchProfiles en cada tecla. Query vacío → limpia.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    const t = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // ─── Sub-view: selected profile ─────────────────────────────────
  if (selected) {
    return (
      <SelectedProfileView
        result={selected}
        refreshKey={refreshKey}
        onBack={() => setSelected(null)}
        onEdit={() => setEditOpen(true)}
        editOpen={editOpen}
        onEditClose={() => setEditOpen(false)}
        onSaved={() => {
          setRefreshKey((k) => k + 1);
          setEditOpen(false);
          toast.success("Perfil actualizado");
        }}
      />
    );
  }

  // ─── Default: search view ──────────────────────────────────────
  const composeName = (r: SearchResult) =>
    displayCustomerName(
      {
        firstName: r.firstName,
        lastName: r.lastName,
        businessName: r.businessName,
        email: r.email,
        phoneNumber: r.phoneNumber,
      },
      ""
    ) ||
    "(sin nombre)";

  const matchedByLabel = (m: SearchResult["matchedBy"]) =>
    m === "phone"
      ? "Teléfono"
      : m === "email"
      ? "Email"
      : m === "account"
      ? "Cuenta"
      : "Nombre";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FeatureNotice feature="customerProfiles" />
      <div>
        <div className="section-title">Buscar cliente</div>
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
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query);
            }}
            placeholder="Teléfono, email o nombre completo"
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
              className="btn btn--ghost btn--sm btn--icon"
              onClick={() => {
                setQuery("");
                setResults([]);
                setError(null);
              }}
              title="Limpiar"
            >
              <Icon.Close size={11} />
            </button>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => runSearch(query)}
            disabled={loading || !query.trim()}
            style={{ height: 24, padding: "0 8px", fontSize: 11 }}
          >
            {loading ? "…" : "Buscar"}
          </button>
        </div>
        <div
          className="muted"
          style={{
            fontSize: 10.5,
            marginTop: 5,
            lineHeight: 1.4,
          }}
        >
          Busca en Connect Customer Profiles. Se aceptan teléfonos con o sin
          + (ej. 953730189), emails o nombres completos.
        </div>
      </div>

      {loading && (
        <div
          className="muted"
          style={{
            padding: 14,
            textAlign: "center",
            fontSize: 12,
          }}
        >
          Buscando…
        </div>
      )}

      {error && !loading && (
        <div
          style={{
            padding: 10,
            background:
              error === "Sin resultados"
                ? "var(--bg-2)"
                : "var(--accent-red-soft)",
            color:
              error === "Sin resultados"
                ? "var(--text-3)"
                : "var(--accent-red)",
            borderRadius: 6,
            fontSize: 11.5,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            className="muted"
            style={{
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {results.length} resultado{results.length > 1 ? "s" : ""}
          </div>
          {results.map((r) => {
            const name = composeName(r);
            return (
              <button
                key={r.profileId}
                type="button"
                onClick={() => setSelected(r)}
                className="btn"
                style={{
                  display: "flex",
                  width: "100%",
                  padding: "8px 10px",
                  justifyContent: "flex-start",
                  alignItems: "center",
                  gap: 10,
                  height: "auto",
                  textAlign: "left",
                  borderRadius: 8,
                }}
              >
                <Avatar
                  name={name}
                  size="sm"
                  color={colorFromName(name)}
                />
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
                    className="muted mono"
                    style={{
                      display: "block",
                      fontSize: 10.5,
                      marginTop: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.phoneNumber || r.email || r.accountNumber || "—"}
                  </span>
                </span>
                <span
                  className="chip"
                  style={{
                    fontSize: 9.5,
                    padding: "2px 7px",
                    flexShrink: 0,
                  }}
                >
                  {matchedByLabel(r.matchedBy)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Recently-contacted customers — only show when the agent hasn't
          typed a query yet. Click → load the full profile inline. */}
      {!query && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <span
              className="muted"
              style={{
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Atendidos recientemente
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              onClick={() => fetchRecents()}
              disabled={recentsLoading}
              aria-label="Refrescar"
              title="Refrescar"
              style={{ width: 22, height: 22 }}
            >
              <Icon.Refresh size={11} />
            </button>
          </div>

          {recentsLoading && (
            <div
              className="muted"
              style={{ padding: 12, textAlign: "center", fontSize: 11.5 }}
            >
              Cargando…
            </div>
          )}

          {recentsError && !recentsLoading && (
            <div
              style={{
                padding: 8,
                background: "var(--accent-red-soft)",
                color: "var(--accent-red)",
                borderRadius: 6,
                fontSize: 11,
                textAlign: "center",
              }}
            >
              {recentsError}
            </div>
          )}

          {!recentsLoading && !recentsError && recents.length === 0 && (
            <div
              style={{
                padding: 18,
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 11.5,
                lineHeight: 1.6,
                background: "var(--bg-2)",
                borderRadius: 8,
                border: "1px dashed var(--border-1)",
              }}
            >
              <Icon.User size={22} style={{ opacity: 0.45 }} />
              <div style={{ marginTop: 6 }}>
                Aún no has atendido contactos. Cuando los atiendas
                aparecerán aquí para que los puedas reabrir o editar.
              </div>
            </div>
          )}

          {!recentsLoading && recents.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {recents.map((r) => {
                const isEmail = r.customerPhone.includes("@");
                const displayName = recentDisplayName(r);
                // True when we resolved an actual name (vs. fell back to
                // the phone). Drives whether we show the phone as a
                // secondary line under the name.
                const hasName = displayName !== r.customerPhone;
                const channelIcon =
                  r.lastChannel === "CHAT"
                    ? Icon.Chat
                    : r.lastChannel === "EMAIL"
                    ? Icon.Mail
                    : r.lastChannel === "TASK"
                    ? Icon.Note
                    : Icon.Phone;
                const ChannelIcn = channelIcon;
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
                return (
                  <button
                    key={r.customerPhone}
                    type="button"
                    onClick={() =>
                      setSelected({
                        profileId: r.customerPhone, // placeholder; SelectedProfileView
                        // re-resolves via the lookupCustomerProfile hook
                        // by phone/email anyway, so a placeholder id is OK.
                        firstName: r.firstName,
                        lastName: r.lastName,
                        businessName: r.businessName,
                        phoneNumber: isEmail ? undefined : r.customerPhone,
                        email: isEmail ? r.customerPhone : r.email,
                        partyType: r.partyType,
                        matchedBy: "recent",
                      })
                    }
                    className="btn"
                    style={{
                      display: "flex",
                      width: "100%",
                      padding: "8px 10px",
                      justifyContent: "flex-start",
                      alignItems: "center",
                      gap: 10,
                      height: "auto",
                      textAlign: "left",
                      borderRadius: 8,
                    }}
                  >
                    <Avatar
                      name={displayName}
                      size="sm"
                      color={colorFromName(displayName)}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {/* Line 1 — display name + channel icon */}
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--text-1)",
                          overflow: "hidden",
                        }}
                      >
                        <ChannelIcn
                          size={11}
                          style={{
                            color: "var(--text-3)",
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={displayName}
                        >
                          {displayName}
                        </span>
                      </span>
                      {/* Line 2 — phone (only when we have a real name) */}
                      {hasName && (
                        <span
                          className="mono"
                          style={{
                            display: "block",
                            fontSize: 10.5,
                            color: "var(--text-3)",
                            marginTop: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.customerPhone}
                        </span>
                      )}
                      {/* Line 3 — relative time + count */}
                      <span
                        className="muted"
                        style={{
                          display: "block",
                          fontSize: 10.5,
                          marginTop: 1,
                        }}
                      >
                        {relTime}
                        {r.contactCount > 1
                          ? ` · ${r.contactCount} contactos`
                          : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Picks the freshest data for a selected profile by hitting the
 * existing `useCustomerProfile` hook (keyed by phone/email). Lets the
 * agent see the full 360° view + recent contacts + edit.
 */
function SelectedProfileView({
  result,
  refreshKey,
  onBack,
  onEdit,
  editOpen,
  onEditClose,
  onSaved,
}: {
  result: SearchResult;
  refreshKey: number;
  onBack: () => void;
  onEdit: () => void;
  editOpen: boolean;
  onEditClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useConnectAuth();
  const { profile } = useCustomerProfile(
    result.phoneNumber || result.email || null,
    refreshKey
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="btn btn--ghost btn--sm btn--icon"
          aria-label="Volver a la búsqueda"
          title="Volver"
        >
          <Icon.ArrowLeft size={14} />
        </button>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>
          Perfil
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="btn btn--ghost btn--sm"
          style={{ height: 26, padding: "0 8px", fontSize: 11 }}
          disabled={!profile}
        >
          <Icon.Pencil size={11} /> Editar
        </button>
      </div>

      {/* Reuse the existing CustomerProfilePanel — it already renders
          hero + stats + contact info + history timeline. We pass
          `isActive=false` so it doesn't try to subscribe to live
          events that only exist for an in-progress contact. */}
      <CustomerProfilePanel
        phone={result.phoneNumber || result.email || null}
        isActive={false}
        refreshKey={refreshKey}
      />

      {/* Use the profileId from the FRESH profile fetch instead of the
          search-result projection. When the user clicks a "recent"
          customer we only have the phone — the actual profileId
          (32-hex-char UUID) comes from useCustomerProfile's response.
          Guard the modal so we don't open with a placeholder id. */}
      <EditProfileModal
        open={editOpen && !!profile?.profileId}
        onClose={onEditClose}
        profileId={profile?.profileId || result.profileId}
        initialValues={{
          FirstName: profile?.firstName,
          LastName: profile?.lastName,
          BusinessName: profile?.businessName,
          PhoneNumber: profile?.phoneNumber,
          EmailAddress: profile?.email,
          AccountNumber: profile?.accountNumber,
        }}
        agentUsername={user?.username || ""}
        onSaved={onSaved}
      />
    </div>
  );
}
