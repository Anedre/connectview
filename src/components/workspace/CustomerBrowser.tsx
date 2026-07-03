import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { getApiEndpoints } from "@/lib/api";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useConnectAgentUsername } from "@/hooks/useConnectAgentUsername";
import { CustomerProfilePanel } from "@/components/workspace/CustomerProfilePanel";
import * as Icon from "@/components/vox/primitives";
import { Av } from "@/components/aria";
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
  // Username de Connect (CCP) — fuente de verdad para list-recent-customers, que
  // resuelve agentUsername → Connect user id. El de Cognito no matchea (404/vacío).
  const connectUsername = useConnectAgentUsername();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Recently-contacted customers (idle list) ───────────────────
  const [recents, setRecents] = useState<RecentCustomer[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(false);
  const [recentsError, setRecentsError] = useState<string | null>(null);

  const fetchRecents = async () => {
    const endpoints = getApiEndpoints();
    const username = connectUsername || user?.username;
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
  }, [user?.username, connectUsername]);

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

      // Local fuzzy search over recents — substring match sobre nombre/empresa/
      // email Y sobre los DÍGITOS del teléfono. Así "953" matchea +51953730189
      // (parcial), que Connect SearchProfiles NO permite (solo match exacto).
      // Limitado a los contactos recientes del agente (no hay índice de prefijo).
      const norm = trimmed.toLowerCase();
      const qDigits = trimmed.replace(/[^\d]/g, "");
      const localResults: SearchResult[] = recents
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
          const phoneDigits = (r.customerPhone || "").replace(/[^\d]/g, "");
          const nameHit = norm.length >= 2 && hay.includes(norm);
          // >=2 dígitos para que el código de país (ej. "+51" → "51") matchee y
          // muestre los recientes de ese país. Con 1 dígito sería demasiado ruido.
          const phoneHit = qDigits.length >= 2 && phoneDigits.includes(qDigits);
          return nameHit || phoneHit;
        })
        .map((r) => ({
          profileId: r.customerPhone, // placeholder — re-resolved on click
          firstName: r.firstName,
          lastName: r.lastName,
          businessName: r.businessName,
          phoneNumber: r.customerPhone.includes("@")
            ? undefined
            : r.customerPhone,
          email: r.customerPhone.includes("@") ? r.customerPhone : r.email,
          partyType: r.partyType,
          matchedBy: "name" as const,
        }));

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
        refreshKey={0}
        onBack={() => setSelected(null)}
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
    <div className="col gap12">
      <FeatureNotice feature="customerProfiles" />
      {/* Input de búsqueda — estilo demo (CustomerSearch): caja alta con
          ícono, botón limpiar y hint bajo la caja. */}
      <div>
        <div
          className="row gap8"
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--r-md)",
            padding: "0 10px",
            height: 44,
          }}
        >
          <Icon.Search size={15} style={{ color: "var(--text-3)" }} />
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
              fontSize: 13,
              color: "var(--text-1)",
            }}
          />
          {query ? (
            <button
              type="button"
              className="ctab__x"
              onClick={() => {
                setQuery("");
                setResults([]);
                setError(null);
              }}
              title="Limpiar"
            >
              <Icon.Close size={13} />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--soft btn--sm"
              onClick={() => runSearch(query)}
              disabled={loading || !query.trim()}
            >
              {loading ? "…" : "Buscar"}
            </button>
          )}
        </div>
        <div
          className="dim"
          style={{ fontSize: 10.5, marginTop: 5, lineHeight: 1.4 }}
        >
          Busca en Connect Customer Profiles. Se aceptan teléfonos con o sin
          + (ej. 953730189), emails o nombres completos.
        </div>
      </div>

      {loading && (
        <div
          className="dim"
          style={{ padding: 16, textAlign: "center", fontSize: 12.5 }}
        >
          Buscando…
        </div>
      )}

      {error && !loading && (
        <div
          className={error === "Sin resultados" ? "dim" : ""}
          style={{
            padding: error === "Sin resultados" ? 16 : 10,
            background:
              error === "Sin resultados" ? "transparent" : "var(--red-soft)",
            color:
              error === "Sin resultados" ? undefined : "var(--red-2)",
            borderRadius: "var(--r-sm)",
            fontSize: 12.5,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="col gap4">
          <div
            className="dim"
            style={{
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: ".06em",
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
                className="row gap10"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "var(--r-sm)",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <Av name={name} size={32} color="var(--cyan)" />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span
                    className="trunc"
                    style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}
                  >
                    {name}
                  </span>
                  <span
                    className="mono dim trunc"
                    style={{ display: "block", fontSize: 10.5, marginTop: 1 }}
                  >
                    {r.phoneNumber || r.email || r.accountNumber || "—"}
                  </span>
                </span>
                <span
                  className="pill pill--outline"
                  style={{ height: 22, fontSize: 10, flexShrink: 0 }}
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
        <div className="col gap4">
          <div className="row between">
            <span
              className="dim"
              style={{
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: ".06em",
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
              className="dim"
              style={{ padding: 12, textAlign: "center", fontSize: 12 }}
            >
              Cargando…
            </div>
          )}

          {recentsError && !recentsLoading && (
            <div
              style={{
                padding: 8,
                background: "var(--red-soft)",
                color: "var(--red-2)",
                borderRadius: "var(--r-sm)",
                fontSize: 11.5,
                textAlign: "center",
              }}
            >
              {recentsError}
            </div>
          )}

          {!recentsLoading && !recentsError && recents.length === 0 && (
            <div
              className="dim"
              style={{
                padding: 18,
                textAlign: "center",
                fontSize: 12,
                lineHeight: 1.6,
                background: "var(--bg-2)",
                borderRadius: "var(--r-md)",
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
            <div className="col gap4">
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
                    className="row gap10"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "var(--r-sm)",
                      background: "var(--bg-2)",
                      border: "1px solid var(--border-1)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <Av name={displayName} size={32} color="var(--accent)" />
                    <span className="grow" style={{ minWidth: 0 }}>
                      {/* Line 1 — display name + channel icon */}
                      <span
                        className="row gap6"
                        style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden" }}
                      >
                        <ChannelIcn
                          size={11}
                          style={{ color: "var(--text-3)", flexShrink: 0 }}
                        />
                        <span className="trunc" title={displayName}>
                          {displayName}
                        </span>
                      </span>
                      {/* Line 2 — phone (only when we have a real name) */}
                      {hasName && (
                        <span
                          className="mono dim trunc"
                          style={{ display: "block", fontSize: 10.5, marginTop: 1 }}
                        >
                          {r.customerPhone}
                        </span>
                      )}
                      {/* Line 3 — relative time + count */}
                      <span
                        className="dim"
                        style={{ display: "block", fontSize: 10.5, marginTop: 1 }}
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
}: {
  result: SearchResult;
  refreshKey: number;
  onBack: () => void;
}) {
  const { user } = useConnectAuth();

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
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>Perfil</span>
        {/* Sin botón "Editar": los atributos se editan haciendo click
            directamente sobre su valor (edición inline). */}
        <span className="dim" style={{ fontSize: 10.5 }}>
          Click en un dato para editar
        </span>
      </div>

      {/* CustomerProfilePanel renderiza hero + stats + contacto + timeline, y
          ahora hace editables inline los atributos del perfil (guarda vía
          update-customer-profile). `isActive=false` evita suscripciones de
          contacto en vivo; `agentUsername` audita la actualización. */}
      <CustomerProfilePanel
        phone={result.phoneNumber || result.email || null}
        isActive={false}
        refreshKey={refreshKey}
        agentUsername={user?.username || ""}
      />
    </div>
  );
}
