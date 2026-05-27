import { useState } from "react";
import * as Icon from "@/components/vox/primitives";
import { CustomerListSidebar, type CustomerSummary } from "@/components/recordings/CustomerListSidebar";
import { CustomerContactsList, type ContactRow } from "@/components/recordings/CustomerContactsList";
import { ContactDetailView } from "@/components/recordings/ContactDetailView";
import { WhatsAppThreadView } from "@/components/recordings/WhatsAppThreadView";
import { CallLogView } from "@/components/recordings/CallLogView";
import { EmailThreadsView } from "@/components/recordings/EmailThreadsView";
import { AttachmentsGrid } from "@/components/recordings/AttachmentsGrid";

type RightPaneMode = "sessions" | "whatsapp" | "calls" | "emails" | "files";

interface TabDef {
  id: RightPaneMode;
  label: string;
}

const TABS: TabDef[] = [
  { id: "sessions", label: "📋 Sesiones" },
  { id: "whatsapp", label: "💬 WhatsApp" },
  { id: "calls", label: "📞 Llamadas" },
  { id: "emails", label: "📧 Emails" },
  { id: "files", label: "📎 Archivos" },
];

/**
 * Recordings page — channel-specific lenses on the customer's whole
 * interaction history. The page is a customer picker (left) + a
 * mode-dependent right pane (each mode reaches into the appropriate
 * backend Lambda — there is no shared right-pane model on purpose, each
 * lens decides what to fetch).
 *
 *   - "Sesiones": legacy per-contactId detail view (middle column lists
 *     contactIds; right column shows audio/transcript/wrap-up).
 *   - "WhatsApp": every CHAT contact merged into one continuous bubble
 *     thread, calendar popover for date jumping, session separators.
 *   - "Llamadas": bitácora telefónica — large cards per call with
 *     inline expansion to AudioPlayer + Contact Lens transcript.
 *   - "Emails": Gmail-style threads grouped by normalized Subject.
 *   - "Archivos": cross-channel attachment grid (every file ever
 *     exchanged with this customer, filterable by media kind).
 */
export function RecordingsPage() {
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactRow | null>(
    null
  );
  const [mode, setMode] = useState<RightPaneMode>("sessions");

  const customerKey = customer?.phoneNumber || customer?.email || null;
  const customerLabel =
    customer?.businessName ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim() ||
    customer?.phoneNumber ||
    customer?.email ||
    "";

  // Only "Sesiones" mode uses the middle column (per-contactId list).
  // All other lenses span the full width of the right pane.
  const showMiddleColumn = mode === "sessions";

  return (
    <div className="view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        className="view__head"
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="view__crumb">
            <span>Crecimiento</span>
          </div>
          <h1 className="view__title">Grabaciones</h1>
          <div className="view__sub">
            Historial completo por cliente: llamadas con audio + transcripción,
            chats de WhatsApp con mensajes y adjuntos, y emails.
          </div>
        </div>
        <div
          role="tablist"
          aria-label="Modo de vista"
          style={{
            display: "inline-flex",
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            padding: 2,
            flexWrap: "wrap",
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => setMode(t.id)}
              className="btn btn--sm"
              style={{
                background: mode === t.id ? "var(--bg-1)" : "transparent",
                border: "none",
                boxShadow:
                  mode === t.id ? "0 1px 2px rgba(0,0,0,.06)" : undefined,
                fontSize: 12,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3-column shell in "Sesiones" mode, 2-column for every other lens. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: showMiddleColumn ? "280px 320px 1fr" : "280px 1fr",
          gap: 12,
          flex: 1,
          minHeight: 0,
          marginTop: 4,
        }}
      >
        {/* Customer picker (always present) */}
        <div
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <CustomerListSidebar
            selectedKey={customerKey}
            onSelect={(c) => {
              setCustomer(c);
              setSelectedContact(null);
            }}
          />
        </div>

        {/* Middle column — only in "Sesiones" mode. */}
        {showMiddleColumn && (
          <div
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {customer && (
              <div
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border-1)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Icon.User size={14} style={{ color: "var(--text-3)" }} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={customerLabel}
                >
                  {customerLabel}
                </span>
                <button
                  onClick={() => {
                    setCustomer(null);
                    setSelectedContact(null);
                  }}
                  className="btn btn--ghost btn--sm btn--icon"
                  title="Volver al picker"
                  aria-label="Volver"
                >
                  <Icon.Close size={12} />
                </button>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0 }}>
              <CustomerContactsList
                customerKey={customerKey}
                selectedContactId={selectedContact?.contactId || null}
                onSelect={(c) => setSelectedContact(c)}
              />
            </div>
          </div>
        )}

        {/* Right pane — channel-specific lens. */}
        <div
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            borderRadius: 10,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {mode === "sessions" && (
            <ContactDetailView contactId={selectedContact?.contactId || null} />
          )}
          {mode === "whatsapp" && (
            <WhatsAppThreadView phone={customer?.phoneNumber || null} />
          )}
          {mode === "calls" && (
            <CallLogView phone={customer?.phoneNumber || null} />
          )}
          {mode === "emails" && (
            <EmailThreadsView customerKey={customerKey} />
          )}
          {mode === "files" && (
            <AttachmentsGrid phone={customer?.phoneNumber || null} />
          )}
        </div>
      </div>
    </div>
  );
}
