import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

type ProfileFields = Partial<{
  FirstName: string;
  MiddleName: string;
  LastName: string;
  BusinessName: string;
  PhoneNumber: string;
  EmailAddress: string;
  AccountNumber: string;
}>;

interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  initialValues: ProfileFields;
  agentUsername: string;
  onSaved?: () => void;
}

const inputBase: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-2)",
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  padding: "8px 10px",
  color: "var(--text-1)",
  outline: "none",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
};

/**
 * Edit-profile modal. Sends a single PUT-style payload to
 * `updateCustomerProfile` — only fields the agent changed get
 * included so we don't accidentally clear unrelated columns.
 *
 * Audited server-side under action="update-customer-profile".
 */
export function EditProfileModal({
  open,
  onClose,
  profileId,
  initialValues,
  agentUsername,
  onSaved,
}: EditProfileModalProps) {
  const [values, setValues] = useState<ProfileFields>({});
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the form whenever the modal opens for a different profile
  // OR when the initialValues actually change (so re-opening after a
  // refresh shows fresh data).
  useEffect(() => {
    if (!open) return;
    setValues({
      FirstName: initialValues.FirstName ?? "",
      MiddleName: initialValues.MiddleName ?? "",
      LastName: initialValues.LastName ?? "",
      BusinessName: initialValues.BusinessName ?? "",
      PhoneNumber: initialValues.PhoneNumber ?? "",
      EmailAddress: initialValues.EmailAddress ?? "",
      AccountNumber: initialValues.AccountNumber ?? "",
    });
  }, [
    open,
    initialValues.FirstName,
    initialValues.MiddleName,
    initialValues.LastName,
    initialValues.BusinessName,
    initialValues.PhoneNumber,
    initialValues.EmailAddress,
    initialValues.AccountNumber,
  ]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  const set = (key: keyof ProfileFields, v: string) =>
    setValues((curr) => ({ ...curr, [key]: v }));

  const save = async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.updateCustomerProfile) {
      toast.error("Endpoint no configurado");
      return;
    }
    // Only send fields the agent actually changed (initial vs current).
    const fields: Record<string, string | null> = {};
    (Object.keys(values) as Array<keyof ProfileFields>).forEach((k) => {
      const initial = (initialValues[k] ?? "") as string;
      const current = (values[k] ?? "") as string;
      if (initial !== current) {
        // Empty string → null clears the field; non-empty → set it.
        fields[k] = current === "" ? null : current;
      }
    });

    if (Object.keys(fields).length === 0) {
      toast.info("No hay cambios para guardar");
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch(endpoints.updateCustomerProfile, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          fields,
          actor: agentUsername || "unknown",
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
      onSaved?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No se pudo actualizar el perfil"
      );
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Editar perfil"
      onClick={() => !submitting && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 10, 16, 0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 250,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Icon.Pencil size={16} style={{ color: "var(--accent-cyan)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Editar perfil</div>
            <div className="muted mono" style={{ fontSize: 10.5 }}>
              {profileId.slice(0, 16)}…
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
          >
            <Icon.Close size={14} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <Row label="Nombre">
            <input
              value={values.FirstName ?? ""}
              onChange={(e) => set("FirstName", e.target.value)}
              style={inputBase}
            />
          </Row>
          <Row label="Segundo nombre">
            <input
              value={values.MiddleName ?? ""}
              onChange={(e) => set("MiddleName", e.target.value)}
              style={inputBase}
            />
          </Row>
          <Row label="Apellidos">
            <input
              value={values.LastName ?? ""}
              onChange={(e) => set("LastName", e.target.value)}
              style={inputBase}
            />
          </Row>
          <Row label="Empresa">
            <input
              value={values.BusinessName ?? ""}
              onChange={(e) => set("BusinessName", e.target.value)}
              style={inputBase}
            />
          </Row>
          <Row label="Teléfono">
            <input
              value={values.PhoneNumber ?? ""}
              onChange={(e) => set("PhoneNumber", e.target.value)}
              inputMode="tel"
              style={inputBase}
            />
          </Row>
          <Row label="Email">
            <input
              value={values.EmailAddress ?? ""}
              onChange={(e) => set("EmailAddress", e.target.value)}
              type="email"
              style={inputBase}
            />
          </Row>
          <Row label="Número de cuenta">
            <input
              value={values.AccountNumber ?? ""}
              onChange={(e) => set("AccountNumber", e.target.value)}
              style={inputBase}
            />
          </Row>
          <div
            className="muted"
            style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.5 }}
          >
            Solo se envían los campos modificados. Dejar un campo vacío
            limpia el valor existente en el perfil.
          </div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--success"
            onClick={save}
            disabled={submitting}
          >
            {submitting ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="muted" style={{ fontSize: 10.5 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
