import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { useContactHistory } from "@/hooks/useContactHistory";
import { useActiveContact } from "@/hooks/useActiveContact";
import { Avatar, colorFromName } from "@/components/vox/primitives";
import type { ChannelType } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useDebugRender, traceChange } from "@/lib/debugTrace";
import { ContactDetailModal } from "@/components/workspace/ContactDetailModal";
import { ContactHistoryPanel } from "@/components/workspace/ContactHistoryPanel";
import { CasesPanel } from "@/components/workspace/CasesPanel";
import { AgentNotesPanel } from "@/components/workspace/AgentNotesPanel";
import { EditProfileModal } from "@/components/workspace/EditProfileModal";
import { useConnections } from "@/hooks/useConnections";
import { formatDurationSec } from "@/lib/utils";
import { displayCustomerName, displayBusinessLine } from "@/lib/customerName";

/** Sub-pestañas del Cliente 360° estilo handoff. Sólo se muestran cuando el
 *  panel recibe `contactId` (contexto de un contacto activo) — así puede
 *  hostear Casos/Notas/Historial con sus datos reales. Sin `contactId` el
 *  panel se comporta como antes (sólo Perfil). */
type C360Tab = "perfil" | "historial" | "notas" | "casos";

interface CustomerProfilePanelProps {
  phone: string | null;
  isActive: boolean;
  /** Bump to force the customer-profile hook to re-fetch even when
   *  the phone hasn't changed (used by the "Refrescar perfil" menu). */
  refreshKey?: number;
  /** Contacto activo — habilita las pestañas Historial/Notas/Casos. Si se
   *  omite, el panel renderiza sólo el Perfil (retro-compatible). */
  contactId?: string | null;
  /** Usuario del agente — requerido por AgentNotesPanel (pestaña Notas). */
  agentUsername?: string;
}

const CHANNEL_META: Record<
  string,
  { color: string; Icn: (typeof Icon)["Phone"]; label: string; type: ChannelType }
> = {
  VOICE: { color: "var(--accent-green)", Icn: Icon.Phone, label: "Llamada", type: "voice" },
  CHAT: { color: "var(--accent-cyan)", Icn: Icon.Chat, label: "Chat", type: "chat" },
  EMAIL: { color: "var(--accent-amber)", Icn: Icon.Mail, label: "Email", type: "email" },
  TASK: { color: "var(--accent-violet)", Icn: Icon.Note, label: "Tarea", type: "sms" },
};

// Bug #7/#11 — old MM:SS format produced absurd values like "1440:00"
// for chats over an hour. Delegate to the shared HH:MM:SS helper.
function fmtDuration(s: number): string {
  return formatDurationSec(s);
}

/* -------------------------------------------------------------------------- */
/* Edición inline de atributos del perfil                                     */
/* -------------------------------------------------------------------------- */

/** Campos que el endpoint `update-customer-profile` sabe escribir. */
type EditableField =
  | "FirstName"
  | "MiddleName"
  | "LastName"
  | "BusinessName"
  | "AccountNumber"
  | "EmailAddress"
  | "PhoneNumber";

const EDIT_VALIDATORS: Partial<Record<EditableField, (v: string) => boolean>> = {
  PhoneNumber: (v) => !v || /^\+?\d[\d\s\-()]{6,}$/.test(v),
  EmailAddress: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
};

/**
 * Valor de perfil editable EN EL LUGAR: se muestra como texto; al hacer click
 * se convierte en input; Enter/blur guarda (POST update-customer-profile),
 * Esc cancela. Reemplaza al botón "Editar" + modal. Sólo sirve cuando hay
 * `profileId` y el endpoint está configurado; si no, cae a texto plano.
 */
function InlineEditField({
  value,
  field,
  profileId,
  agentUsername,
  mono,
  inputType = "text",
  onSaved,
  propContext,
}: {
  value: string;
  field: EditableField;
  profileId: string | null;
  agentUsername: string;
  mono?: boolean;
  inputType?: string;
  onSaved: () => void;
  // Si se pasa (campos de nombre), el guardado incluye phone + nombre completo
  // para que el backend propague el cambio a connectview-leads + conversaciones.
  propContext?: { phone?: string; buildName: (next: string) => string };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Valor optimista: tras guardar mostramos el valor nuevo YA, sin esperar a
  // que Customer Profiles (consistencia eventual) lo devuelva en el re-fetch.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const shown = optimistic ?? value;
  const canEdit = !!profileId && !!getApiEndpoints()?.updateCustomerProfile;

  // Cuando el re-fetch ya trae el valor guardado, soltamos el optimista.
  useEffect(() => {
    if (optimistic !== null && value === optimistic) setOptimistic(null);
  }, [value, optimistic]);

  const start = () => {
    if (!canEdit || saving) return;
    setDraft(shown);
    setEditing(true);
  };
  const cancel = () => {
    setDraft(shown);
    setEditing(false);
  };
  const commit = async () => {
    const next = draft.trim();
    if (next === (shown ?? "").trim()) {
      setEditing(false);
      return;
    }
    const validator = EDIT_VALIDATORS[field];
    if (validator && !validator(next)) {
      toast.error("Formato inválido");
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.updateCustomerProfile || !profileId) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(endpoints.updateCustomerProfile, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          fields: { [field]: next === "" ? null : next },
          actor: agentUsername || "unknown",
          ...(propContext ? { phone: propContext.phone, name: propContext.buildName(next) } : {}),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
      toast.success("Perfil actualizado");
      setOptimistic(next); // muestra el valor nuevo ya, sin esperar el re-fetch
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className={"inline-edit__input" + (mono ? " mono" : "")}
        type={inputType}
        inputMode={inputType === "tel" ? "tel" : inputType === "email" ? "email" : undefined}
      />
    );
  }

  return (
    <button
      type="button"
      className={
        "inline-edit__val" + (mono ? " mono" : "") + (canEdit ? "" : " inline-edit__val--ro")
      }
      onClick={start}
      disabled={!canEdit}
      title={canEdit ? "Click para editar" : undefined}
    >
      <span className={shown ? "inline-edit__txt" : "inline-edit__txt dim"}>
        {shown || "Añadir…"}
      </span>
      {canEdit && <Icon.Pencil size={11} className="inline-edit__pencil" />}
    </button>
  );
}

/**
 * Cliente 360° tabbed — envoltorio de presentación estilo handoff ARIA.
 * Muestra 4 sub-pestañas (Perfil · Historial · Notas · Casos) cuando hay un
 * contacto activo, cada una cableada a su panel REAL existente. Sin
 * `contactId` sólo renderiza el Perfil (retro-compatible con los call sites
 * que sólo pasan `phone`).
 *
 * NO reescribe la lógica del perfil: el cuerpo del perfil vive intacto en
 * <CustomerProfileContent/> (antes era este mismo componente, sólo renombrado).
 */
export function CustomerProfilePanel({
  phone,
  isActive,
  refreshKey = 0,
  contactId,
  agentUsername = "",
}: CustomerProfilePanelProps) {
  const [tab, setTab] = useState<C360Tab>("perfil");
  const tabbed = !!contactId;

  // Sin contacto → comportamiento previo: sólo el Perfil (que a su vez muestra
  // su propio estado vacío honesto cuando no hay teléfono).
  if (!tabbed) {
    return (
      <CustomerProfileContent
        phone={phone}
        isActive={isActive}
        refreshKey={refreshKey}
        agentUsername={agentUsername}
      />
    );
  }

  const TABS: [C360Tab, string][] = [
    ["perfil", "Perfil"],
    ["historial", "Historial"],
    ["notas", "Notas"],
    ["casos", "Casos"],
  ];

  return (
    <div data-debug-component="Cliente360Tabbed">
      <div className="c360-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* Perfil — cuerpo real intacto. */}
      <div style={{ display: tab === "perfil" ? "block" : "none" }}>
        <CustomerProfileContent
          phone={phone}
          isActive={isActive}
          refreshKey={refreshKey}
          agentUsername={agentUsername}
        />
      </div>

      {/* Historial — contactos previos del cliente (panel real). */}
      <div style={{ display: tab === "historial" ? "block" : "none" }}>
        <ContactHistoryPanel phone={phone} />
      </div>

      {/* Notas — notas del agente para este contacto (panel real). */}
      <div style={{ display: tab === "notas" ? "block" : "none" }}>
        <AgentNotesPanel contactId={contactId ?? null} agentUsername={agentUsername} />
      </div>

      {/* Casos — Amazon Connect Cases (panel real). */}
      <div style={{ display: tab === "casos" ? "block" : "none" }}>
        <CasesPanel contactId={contactId ?? null} customerPhone={phone} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CustomerProfileContent — cuerpo del Perfil (lógica original sin cambios)    */
/* -------------------------------------------------------------------------- */

function CustomerProfileContent({
  phone,
  isActive,
  refreshKey = 0,
  agentUsername = "",
}: {
  phone: string | null;
  isActive: boolean;
  refreshKey?: number;
  agentUsername?: string;
}) {
  // Bump local: al guardar un atributo inline forzamos re-fetch del perfil
  // sin depender de que el padre suba el refreshKey.
  const [localRefresh, setLocalRefresh] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const { config: connConfig } = useConnections();
  const { profile, loading, error } = useCustomerProfile(phone, refreshKey + localRefresh);
  const { contacts: history } = useContactHistory(phone, 90);
  // Tracks which interaction the agent clicked on — opens the detail
  // modal with the contactId, which fetches recording + transcript +
  // attachments and renders the player + transcript view.
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  // ─── DEBUG INSTRUMENTATION ────────────────────────────────────
  // Hot-path component — flickers between empty placeholder and the
  // hero/stats card were a major user complaint. Render-trace it
  // tightly so we can correlate state flips with parent re-renders.
  useDebugRender("CustomerProfilePanel", {
    phone,
    isActive,
    hasProfile: !!profile,
    loading,
    error: error || undefined,
    historyCount: history?.length || 0,
  });
  traceChange("CustomerProfilePanel.view", {
    branch: !phone
      ? "empty"
      : loading && !profile
        ? "loading"
        : error || !profile
          ? "stub"
          : "full",
  });

  // Stats derived from real history
  const stats = useMemo(() => {
    if (!history?.length) {
      return { last: null as string | null, count: 0, voiceCount: 0 };
    }
    const sorted = [...history].sort(
      (a, b) => Date.parse(b.initiationTimestamp) - Date.parse(a.initiationTimestamp),
    );
    return {
      last: sorted[0]?.initiationTimestamp ?? null,
      count: history.length,
      voiceCount: history.filter((c) => c.channel === "VOICE").length,
    };
  }, [history]);

  // Only show the empty placeholder when there's *no* phone at all.
  // We intentionally do NOT gate on `isActive` here because the contact
  // state can transiently flip ("connected" → "connecting" → "connected"
  // on Streams snapshot poll boundaries), and gating would make the whole
  // hero/stats card vanish and re-appear — visible as parpadeo. The
  // parent already conditionals on an existing contact, so by the time
  // we get here we always have one; just keep rendering the profile.
  if (!phone) {
    return (
      <div
        data-debug-component="CustomerProfilePanel"
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 220,
          color: "var(--text-3)",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <Icon.User size={28} style={{ opacity: 0.45 }} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            La información del cliente aparecerá cuando haya un contacto activo.
          </div>
        </div>
      </div>
    );
  }

  if (loading && !profile) {
    return (
      <div
        data-debug-component="CustomerProfilePanel"
        style={{ padding: 24, fontSize: 13, color: "var(--text-3)" }}
      >
        Cargando perfil…
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="c360" data-debug-component="CustomerProfilePanel">
        <div className="c360__hero">
          <Avatar name={phone} color={colorFromName(phone)} size="lg" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="c360__name">Cliente nuevo</div>
            <div className="c360__sub mono">{phone}</div>
            <div className="row" style={{ gap: 4, marginTop: 6 }}>
              <span className="chip chip--amber">Sin perfil previo</span>
            </div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          Amazon Connect Customer Profiles creará el perfil automáticamente al terminar la llamada.
        </div>
      </div>
    );
  }

  // Derived display fields — see lib/customerName.ts for the rules.
  const fullName = displayCustomerName(
    {
      firstName: profile.firstName,
      middleName: profile.middleName,
      lastName: profile.lastName,
      businessName: profile.businessName,
      email: profile.email,
      phoneNumber: profile.phoneNumber,
    },
    "Cliente",
  );
  const avatarColor = colorFromName(fullName);
  // Best-effort "role · company" line. We don't always have a job title in
  // Customer Profiles, so fall back gracefully.
  const role =
    profile.attributes?.role || profile.attributes?.jobTitle || profile.partyType || null;
  // Company line — only show BusinessName when it's a real company name
  // (not a Salesforce-synced account number) AND it's not the same value
  // we're already using as the primary fullName.
  const smartBusiness = displayBusinessLine({ businessName: profile.businessName });
  const company =
    profile.attributes?.company ||
    (smartBusiness && smartBusiness !== fullName ? smartBusiness : null);
  const subLine =
    role && company ? `${role} · ${company}` : role || company || profile.phoneNumber || phone;

  // Optional attributes
  const segment = profile.attributes?.segment || profile.attributes?.tier;
  const nps = profile.attributes?.nps || profile.attributes?.NPS;
  const arr = profile.attributes?.arr || profile.attributes?.ARR;
  const csat = profile.attributes?.csat || profile.attributes?.CSAT;
  const openCases = profile.attributes?.openCases || profile.attributes?.casos_abiertos;
  // Products list — stored as a JSON-encoded array in attributes if present
  type Product = { name: string; price: string };
  let products: Product[] = [];
  if (profile.attributes?.products) {
    try {
      const parsed = JSON.parse(profile.attributes.products);
      if (Array.isArray(parsed)) products = parsed;
    } catch {
      /* noop */
    }
  }

  const lastInteractionRelative = stats.last
    ? formatDistanceToNow(new Date(stats.last), { addSuffix: false, locale: es })
    : null;

  // Build the list of all structured profile fields — every Customer Profiles
  // field we know about, in a stable order. Los campos EDITABLES (con `field`)
  // se muestran aunque estén vacíos si `always` (los esenciales), para poder
  // añadirlos inline; los no-editables sólo si tienen valor.
  const profileRows: Array<{
    label: string;
    value: string;
    mono?: boolean;
    field?: EditableField;
    inputType?: string;
  }> = [];
  const push = (
    label: string,
    value: string | undefined | null,
    opts: { mono?: boolean; field?: EditableField; inputType?: string; always?: boolean } = {},
  ) => {
    const has = value !== undefined && value !== null && String(value).trim() !== "";
    if (has || (opts.field && opts.always)) {
      profileRows.push({
        label,
        value: has ? String(value) : "",
        mono: opts.mono,
        field: opts.field,
        inputType: opts.inputType,
      });
    }
  };
  // Editables (Customer Profiles). Nombre/Apellido/Email/Teléfono siempre
  // visibles (esenciales); el resto sólo si tienen valor.
  push("Nombre", profile.firstName, { field: "FirstName", always: true });
  push("Segundo nombre", profile.middleName, { field: "MiddleName" });
  push("Apellido", profile.lastName, { field: "LastName", always: true });
  push("Razón social", profile.businessName, { field: "BusinessName" });
  push("Tipo de cuenta", profile.partyType); // solo lectura
  push("Cuenta", profile.accountNumber, { mono: true, field: "AccountNumber" });
  push("Email", profile.email, { field: "EmailAddress", inputType: "email", always: true });
  push("Teléfono", profile.phoneNumber, {
    mono: true,
    field: "PhoneNumber",
    inputType: "tel",
    always: true,
  });
  // Solo lectura (el endpoint no los escribe todavía).
  push("Fecha de nacimiento", profile.birthDate);
  push("Género", profile.gender);
  if (profile.address) {
    push("Dirección 1", profile.address.Address1);
    push("Dirección 2", profile.address.Address2);
    push("Ciudad", profile.address.City);
    push("Estado / Provincia", profile.address.State);
    push("País", profile.address.Country);
    push("Código postal", profile.address.PostalCode);
  }

  // Custom attributes — everything in `attributes` minus the keys we already
  // surfaced as stats/chips/products, so we don't duplicate.
  const CONSUMED_ATTRS = new Set([
    "segment",
    "tier",
    "nps",
    "NPS",
    "arr",
    "ARR",
    "csat",
    "CSAT",
    "openCases",
    "casos_abiertos",
    "role",
    "jobTitle",
    "company",
    "products",
  ]);
  const customAttrs = Object.entries(profile.attributes ?? {})
    .filter(([k, v]) => !CONSUMED_ATTRS.has(k) && v != null && String(v).trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="c360" data-debug-component="CustomerProfilePanel">
      {/* CONTEXTO DE LA CONVERSACION — surfaces attributes set by the
          contact flow (e.g. UDEP-Main-Inbound). Shown above the hero so
          the agent sees the intent immediately when WhatsApp routes the
          contact in. Only renders when the active contact has any
          relevant attributes. */}
      <ContactContextCard />

      {/* HERO */}
      <div className="c360__hero">
        <Avatar name={fullName} color={avatarColor} size="lg" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="c360__name truncate">{fullName}</div>
          <div className="c360__sub truncate">{subLine}</div>
          <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            {segment && <span className="chip chip--violet">{segment}</span>}
            {nps && <span className="chip chip--green">NPS {nps}</span>}
            {profile.accountNumber && (
              <span className="chip" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
                {profile.accountNumber}
              </span>
            )}
          </div>
        </div>
        {profile.profileId && getApiEndpoints()?.updateCustomerProfile && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setEditOpen(true)}
            title="Editar todos los datos del cliente"
            style={{ flexShrink: 0, alignSelf: "flex-start" }}
          >
            <Icon.Pencil size={12} /> Editar
          </button>
        )}
      </div>

      {editOpen && profile.profileId && (
        <EditProfileModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          profileId={profile.profileId}
          agentUsername={agentUsername}
          onSaved={() => {
            setEditOpen(false);
            setLocalRefresh((n) => n + 1);
          }}
          sfInstanceUrl={connConfig.salesforce?.instanceUrl}
          initialValues={{
            FirstName: profile.firstName,
            MiddleName: profile.middleName,
            LastName: profile.lastName,
            BusinessName: profile.businessName,
            PhoneNumber: profile.phoneNumber,
            EmailAddress: profile.email,
            AccountNumber: profile.accountNumber,
            GenderString: profile.gender,
            BirthDate: profile.birthDate,
          }}
          initialAddress={profile.address as Record<string, string> | undefined}
          initialAttributes={profile.attributes}
        />
      )}

      {/* STATS GRID 2×2 — Bug #6: only render the grid when at least ONE
          field has a real value. The all-em-dashes panel used to take 80px
          of vertical real estate while telling the agent nothing. */}
      {(arr || openCases != null || lastInteractionRelative || csat) && (
        <div className="c360__stats">
          {arr && (
            <div className="c360__stat">
              <div className="c360__stat-label">ARR</div>
              <div className="c360__stat-value">{arr.startsWith("$") ? arr : `$${arr}`}</div>
            </div>
          )}
          {openCases != null && (
            <div className="c360__stat">
              <div className="c360__stat-label">Casos abiertos</div>
              <div className="c360__stat-value">{openCases}</div>
            </div>
          )}
          {lastInteractionRelative && (
            <div className="c360__stat">
              <div className="c360__stat-label">Última interacción</div>
              <div className="c360__stat-value">{lastInteractionRelative}</div>
            </div>
          )}
          {csat && (
            <div className="c360__stat">
              <div className="c360__stat-label">CSAT promedio</div>
              <div className="c360__stat-value">{csat}%</div>
            </div>
          )}
        </div>
      )}

      {/* CONTACTO */}
      <div>
        <div className="section-title">Contacto</div>
        <div className="col" style={{ gap: 6 }}>
          {profile.phoneNumber && (
            <div
              className="row"
              style={{ padding: "8px 10px", background: "var(--bg-2)", borderRadius: 6 }}
            >
              <Icon.Phone size={13} style={{ color: "var(--text-3)" }} />
              <span className="mono" style={{ fontSize: 12 }}>
                {profile.phoneNumber}
              </span>
            </div>
          )}
          {profile.email && (
            <div
              className="row"
              style={{ padding: "8px 10px", background: "var(--bg-2)", borderRadius: 6 }}
            >
              <Icon.Mail size={13} style={{ color: "var(--text-3)" }} />
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>{profile.email}</span>
            </div>
          )}
          {profile.address?.City && (
            <div
              className="row"
              style={{ padding: "8px 10px", background: "var(--bg-2)", borderRadius: 6 }}
            >
              <Icon.Globe size={13} style={{ color: "var(--text-3)" }} />
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                {[profile.address.City, profile.address.State, profile.address.Country]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* PRODUCTOS CONTRATADOS — solo se muestra si el perfil tiene atributo `products` */}
      {products.length > 0 && (
        <div>
          <div className="section-title">Productos contratados</div>
          <div className="col" style={{ gap: 6 }}>
            {products.map((p, i) => (
              <div
                key={i}
                className="spread"
                style={{
                  padding: "8px 10px",
                  background: "var(--bg-2)",
                  borderRadius: 6,
                }}
              >
                <span style={{ fontSize: 12.5 }}>{p.name}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {p.price}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DATOS DEL PERFIL — todos los campos estructurados que Customer
          Profiles tenga registrados, en orden estable. */}
      {profileRows.length > 0 && (
        <div>
          <div className="section-title">Datos del perfil</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 2,
              background: "var(--bg-2)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {profileRows.map((r, i) => (
              <div
                key={r.label + i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(110px, 40%) 1fr",
                  gap: 10,
                  padding: "6px 10px",
                  borderBottom: i < profileRows.length - 1 ? "1px solid var(--border-1)" : "none",
                  fontSize: 11.5,
                  alignItems: "center",
                }}
              >
                <span className="muted">{r.label}</span>
                {r.field ? (
                  <InlineEditField
                    value={r.value}
                    field={r.field}
                    profileId={profile.profileId}
                    agentUsername={agentUsername}
                    mono={r.mono}
                    inputType={r.inputType}
                    onSaved={() => setLocalRefresh((n) => n + 1)}
                    propContext={
                      r.field === "FirstName"
                        ? {
                            phone: profile.phoneNumber,
                            buildName: (next) =>
                              [next, profile.lastName].filter(Boolean).join(" ").trim(),
                          }
                        : r.field === "LastName"
                          ? {
                              phone: profile.phoneNumber,
                              buildName: (next) =>
                                [profile.firstName, next].filter(Boolean).join(" ").trim(),
                            }
                          : undefined
                    }
                  />
                ) : (
                  <span
                    className={r.mono ? "mono" : ""}
                    style={{
                      color: "var(--text-1)",
                      overflowWrap: "anywhere",
                      fontSize: r.mono ? 11 : 12,
                    }}
                  >
                    {r.value}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ATRIBUTOS PERSONALIZADOS — todo lo que esté en `attributes` y no
          consumimos arriba (KPIs / productos). Permite ver datos enriquecidos
          desde el CRM o un Lambda de enrichment. */}
      {customAttrs.length > 0 && (
        <div>
          <div className="section-title">Atributos personalizados</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 2,
              background: "var(--bg-2)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {customAttrs.map(([k, v], i) => (
              <div
                key={k}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(110px, 40%) 1fr",
                  gap: 10,
                  padding: "8px 10px",
                  borderBottom: i < customAttrs.length - 1 ? "1px solid var(--border-1)" : "none",
                  fontSize: 11.5,
                }}
              >
                <span className="muted mono" style={{ fontSize: 10.5 }}>
                  {k}
                </span>
                <span
                  style={{
                    color: "var(--text-1)",
                    fontSize: 12,
                    overflowWrap: "anywhere",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* INTERACCIONES RECIENTES — timeline compacto */}
      <div>
        <div className="section-title">Interacciones recientes</div>
        {history.length === 0 ? (
          <div
            style={{
              padding: 12,
              background: "var(--bg-2)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--text-3)",
            }}
          >
            Sin interacciones previas con este cliente.
          </div>
        ) : (
          <div className="tl">
            {history.slice(0, 5).map((h) => {
              const meta = CHANNEL_META[h.channel] ?? CHANNEL_META.VOICE;
              const Icn = meta.Icn;
              const when = formatDistanceToNow(new Date(h.initiationTimestamp), {
                addSuffix: false,
                locale: es,
              });
              return (
                <div
                  key={h.contactId}
                  className="tl__item"
                  onClick={() => setOpenContactId(h.contactId)}
                  style={{ cursor: "pointer" }}
                  title="Click para ver el detalle (grabación, transcripción, adjuntos)"
                >
                  <div className="tl__dot" style={{ color: meta.color, borderColor: meta.color }}>
                    <Icn size={11} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tl__time">{when}</div>
                    <div className="tl__body">
                      <div className="tl__title" style={{ fontSize: 12.5 }}>
                        {meta.label}
                        {h.agentUsername ? ` con ${h.agentUsername}` : ""}
                        {h.hasRecording && (
                          <span
                            className="chip chip--violet"
                            style={{
                              marginLeft: 6,
                              height: 16,
                              fontSize: 9.5,
                              padding: "0 5px",
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                            title="Tiene grabación"
                          >
                            <Icon.Mic size={10} />
                          </span>
                        )}
                      </div>
                      <div className="muted truncate" style={{ fontSize: 11 }}>
                        {h.duration ? `${fmtDuration(h.duration)} · ` : ""}
                        {h.queueName || h.disconnectReason || ""}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ContactDetailModal
        open={!!openContactId}
        onClose={() => setOpenContactId(null)}
        contactId={openContactId}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ContactContextCard                                                          */
/* -------------------------------------------------------------------------- */

/** Maps the udep_* attribute keys to a human-friendly label + accent color. */
const UDEP_ATTR_META: Record<string, { label: string; chip: string }> = {
  udep_intent: { label: "Motivo", chip: "chip--violet" },
  udep_nivel: { label: "Nivel", chip: "chip--cyan" },
  udep_facultad: { label: "Facultad", chip: "chip--cyan" },
  udep_sede: { label: "Sede", chip: "chip--green" },
  udep_source: { label: "Canal", chip: "chip" },
  udep_lead_type: { label: "Tipo de lead", chip: "chip--amber" },
  udep_idioma: { label: "Idioma", chip: "chip" },
};

const UDEP_INTENT_LABELS: Record<string, string> = {
  consultar_programa: "Consulta de programa académico",
  solicitar_costos: "Solicitud de costos / pensiones",
  agendar_visita: "Agendar visita al campus",
  soporte_alumno: "Soporte para alumno matriculado",
  hablar_con_asesor: "Quiere hablar con un asesor",
};

function ContactContextCard() {
  const contact = useActiveContact();
  if (!contact) return null;

  // Pull only the UDEP-prefixed attrs in the canonical order we want to show.
  const order = [
    "udep_intent",
    "udep_nivel",
    "udep_facultad",
    "udep_sede",
    "udep_lead_type",
    "udep_source",
  ];
  const present = order
    .map((k) => [k, contact.attributes[k]] as const)
    .filter(([, v]) => v && v.trim() !== "");

  if (present.length === 0) return null;

  const intentRaw = contact.attributes.udep_intent || "";
  const intentLabel = UDEP_INTENT_LABELS[intentRaw] || intentRaw;

  return (
    <div
      style={{
        marginBottom: 12,
        padding: 12,
        background: "linear-gradient(135deg, rgba(245,165,36,0.08) 0%, rgba(99,102,241,0.06) 100%)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
      }}
    >
      <div
        className="muted mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Contexto de la conversación
      </div>
      {intentLabel && (
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--text-1)",
            marginBottom: 8,
          }}
        >
          {intentLabel}
        </div>
      )}
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        {present
          .filter(([k]) => k !== "udep_intent")
          .map(([k, v]) => {
            const meta = UDEP_ATTR_META[k] || { label: k, chip: "chip" };
            return (
              <span key={k} className={`chip ${meta.chip}`} title={k}>
                {meta.label}: {v}
              </span>
            );
          })}
      </div>
    </div>
  );
}
