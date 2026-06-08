import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";
import { Avatar, colorFromName } from "@/components/vox/primitives";
import { displayCustomerName } from "@/lib/customerName";

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

/**
 * Modernized edit-profile modal. Grouped sections, live avatar preview,
 * change indicators, smart field validation. Only sends fields that
 * differ from `initialValues` so the agent never accidentally clears
 * unrelated columns. Audited server-side under
 * `action="update-customer-profile"`.
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

  // Field-by-field diff against the initial values — drives the
  // changed-indicator (cyan dot) AND the save button's disabled state.
  const changedKeys = useMemo(() => {
    const out = new Set<keyof ProfileFields>();
    (Object.keys(values) as Array<keyof ProfileFields>).forEach((k) => {
      const initial = (initialValues[k] ?? "") as string;
      const current = (values[k] ?? "") as string;
      if (initial !== current) out.add(k);
    });
    return out;
  }, [values, initialValues]);

  // Computed display name for the preview avatar — falls back through
  // businessName → first+last → email → phone → "Cliente".
  const displayName = useMemo(() => {
    return displayCustomerName(
      {
        firstName: values.FirstName,
        lastName: values.LastName,
        businessName: values.BusinessName,
        email: values.EmailAddress,
        phoneNumber: values.PhoneNumber,
      },
      "Cliente"
    );
  }, [values]);

  // Validation — phone must look like E.164 if set; email must have @.
  const phoneValid =
    !values.PhoneNumber || /^\+?\d[\d\s\-()]{6,}$/.test(values.PhoneNumber);
  const emailValid =
    !values.EmailAddress || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.EmailAddress);
  const formValid = phoneValid && emailValid;

  const save = async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.updateCustomerProfile) {
      toast.error("Endpoint no configurado");
      return;
    }
    const fields: Record<string, string | null> = {};
    changedKeys.forEach((k) => {
      const current = (values[k] ?? "") as string;
      fields[k] = current === "" ? null : current;
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
          width: 480,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "var(--accent-cyan-soft)",
              color: "var(--accent-cyan)",
            }}
          >
            <Icon.Pencil size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Editar perfil</div>
            <div className="muted mono" style={{ fontSize: 10.5 }}>
              {profileId.slice(0, 16)}…
            </div>
          </div>
          {changedKeys.size > 0 && (
            <span
              className="chip chip--cyan"
              style={{ fontSize: 10, padding: "1px 8px", height: 20 }}
              title={`${changedKeys.size} campo(s) modificado(s)`}
            >
              ● {changedKeys.size} cambio{changedKeys.size > 1 ? "s" : ""}
            </span>
          )}
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

        {/* Live preview strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            background:
              "linear-gradient(135deg, var(--accent-cyan-soft) 0%, transparent 70%)",
            borderBottom: "1px solid var(--border-1)",
            flexShrink: 0,
          }}
        >
          <Avatar
            name={displayName}
            size="lg"
            color={colorFromName(displayName)}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text-1)",
                letterSpacing: "-0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {values.PhoneNumber || values.EmailAddress || "Sin contacto"}
            </div>
          </div>
        </div>

        {/* Body — grouped sections */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "14px 16px 0",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {/* SECTION — Identidad */}
          <Section
            icon={<Icon.User size={12} />}
            title="Identidad"
            color="var(--accent-violet)"
            colorSoft="var(--accent-violet-soft)"
          >
            <Row label="Nombre" changed={changedKeys.has("FirstName")}>
              <Input
                value={values.FirstName ?? ""}
                onChange={(v) => set("FirstName", v)}
                placeholder="Ej. María"
              />
            </Row>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Row label="Segundo nombre" changed={changedKeys.has("MiddleName")}>
                <Input
                  value={values.MiddleName ?? ""}
                  onChange={(v) => set("MiddleName", v)}
                  placeholder="Opcional"
                />
              </Row>
              <Row label="Apellidos" changed={changedKeys.has("LastName")}>
                <Input
                  value={values.LastName ?? ""}
                  onChange={(v) => set("LastName", v)}
                  placeholder="Ej. González"
                />
              </Row>
            </div>
            <Row label="Empresa" changed={changedKeys.has("BusinessName")}>
              <Input
                value={values.BusinessName ?? ""}
                onChange={(v) => set("BusinessName", v)}
                placeholder="Para clientes corporativos"
              />
            </Row>
          </Section>

          {/* SECTION — Contacto */}
          <Section
            icon={<Icon.Phone size={12} />}
            title="Contacto"
            color="var(--accent-green)"
            colorSoft="var(--accent-green-soft)"
          >
            <Row
              label="Teléfono"
              changed={changedKeys.has("PhoneNumber")}
              hint="Formato E.164 con + y código de país (ej. +51953730189)"
              invalid={!phoneValid}
            >
              <Input
                value={values.PhoneNumber ?? ""}
                onChange={(v) => set("PhoneNumber", v)}
                inputMode="tel"
                placeholder="+51..."
                invalid={!phoneValid}
                icon={<Icon.Phone size={12} style={{ color: "var(--text-3)" }} />}
              />
            </Row>
            <Row
              label="Email"
              changed={changedKeys.has("EmailAddress")}
              invalid={!emailValid}
            >
              <Input
                value={values.EmailAddress ?? ""}
                onChange={(v) => set("EmailAddress", v)}
                type="email"
                placeholder="cliente@empresa.com"
                invalid={!emailValid}
                icon={<Icon.Mail size={12} style={{ color: "var(--text-3)" }} />}
              />
            </Row>
          </Section>

          {/* SECTION — Cuenta */}
          <Section
            icon={<Icon.Tag size={12} />}
            title="Cuenta"
            color="var(--accent-amber)"
            colorSoft="var(--accent-amber-soft)"
          >
            <Row
              label="Número de cuenta"
              changed={changedKeys.has("AccountNumber")}
              hint="ID interno del cliente en tu sistema (CRM, ERP, etc.)"
            >
              <Input
                value={values.AccountNumber ?? ""}
                onChange={(v) => set("AccountNumber", v)}
                placeholder="Opcional"
                mono
              />
            </Row>
          </Section>

          <div
            style={{
              padding: "8px 10px",
              background: "var(--bg-2)",
              borderRadius: 8,
              fontSize: 10.5,
              color: "var(--text-3)",
              lineHeight: 1.5,
              marginBottom: 14,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <Icon.Shield
              size={12}
              style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }}
            />
            <span>
              Solo se envían los campos modificados. Dejar un campo vacío
              limpia el valor existente en el perfil. La actualización queda
              auditada con tu usuario.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "center",
            flexShrink: 0,
            background: "var(--bg-2)",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {changedKeys.size === 0
              ? "Sin cambios"
              : `${changedKeys.size} campo${
                  changedKeys.size > 1 ? "s" : ""
                } modificado${changedKeys.size > 1 ? "s" : ""}`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
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
              disabled={submitting || changedKeys.size === 0 || !formValid}
              title={
                !formValid
                  ? "Hay campos con formato inválido"
                  : changedKeys.size === 0
                  ? "No hay cambios"
                  : "Guardar cambios"
              }
            >
              <Icon.Check size={12} />
              {submitting ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  color,
  colorSoft,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  color: string;
  colorSoft: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 2,
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 20,
            height: 20,
            borderRadius: 6,
            background: colorSoft,
            color,
          }}
        >
          {icon}
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color,
          }}
        >
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  changed,
  invalid,
  children,
}: {
  label: string;
  hint?: string;
  changed?: boolean;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10.5,
          color: "var(--text-3)",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        {label}
        {changed && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: invalid ? "var(--accent-red)" : "var(--accent-cyan)",
            }}
            aria-label="Campo modificado"
          />
        )}
      </span>
      {children}
      {hint && !invalid && (
        <span style={{ fontSize: 10, color: "var(--text-4)" }}>{hint}</span>
      )}
      {invalid && (
        <span style={{ fontSize: 10, color: "var(--accent-red)" }}>
          Formato inválido
        </span>
      )}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  mono,
  invalid,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "tel" | "email" | "text" | "numeric";
  mono?: boolean;
  invalid?: boolean;
  icon?: React.ReactNode;
}) {
  const hasIcon = !!icon;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "var(--bg-2)",
        border: `1px solid ${invalid ? "var(--accent-red)" : "var(--border-1)"}`,
        borderRadius: 8,
        padding: hasIcon ? "0 10px 0 10px" : "0 10px",
        height: 36,
        transition: "border-color .15s ease",
      }}
    >
      {icon}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: 0,
          outline: "none",
          color: "var(--text-1)",
          fontSize: 13,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
          letterSpacing: mono ? "0.02em" : "normal",
        }}
      />
    </div>
  );
}
