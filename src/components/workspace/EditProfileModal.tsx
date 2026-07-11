import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { leadSavedToast } from "@/lib/salesforce";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
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
  GenderString: string;
  BirthDate: string;
}>;

/** Sub-campos de dirección de Customer Profiles que exponemos. */
const ADDRESS_FIELDS: { key: string; label: string }[] = [
  { key: "Address1", label: "Calle / Dirección" },
  { key: "Address2", label: "Dirección 2" },
  { key: "City", label: "Ciudad" },
  { key: "State", label: "Estado / Provincia" },
  { key: "Country", label: "País" },
  { key: "PostalCode", label: "Código postal" },
];

interface AttrPair {
  key: string;
  value: string;
}

interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  initialValues: ProfileFields;
  agentUsername: string;
  onSaved?: () => void;
  /** Editor completo (chunk 2): datos extra del perfil para editar TODO. */
  initialAddress?: Record<string, string>;
  initialAttributes?: Record<string, string>;
  /** instanceUrl de Salesforce del tenant (para el botón "Ver en Salesforce"). */
  sfInstanceUrl?: string;
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
  initialAddress,
  initialAttributes,
  sfInstanceUrl,
}: EditProfileModalProps) {
  const [values, setValues] = useState<ProfileFields>({});
  const [submitting, setSubmitting] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  // Editor completo (chunk 2): dirección, atributos personalizados y campos del Lead.
  const [address, setAddress] = useState<Record<string, string>>({});
  const [attrs, setAttrs] = useState<AttrPair[]>([]);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [leadStage, setLeadStage] = useState("");
  const [leadMonto, setLeadMonto] = useState("");
  const [leadSource, setLeadSource] = useState("");
  // Snapshots iniciales para detectar cambios en las secciones nuevas.
  const [snap, setSnap] = useState({ addr: "{}", attrs: "[]", stage: "", monto: "", source: "" });

  // Inicializa las secciones nuevas al abrir + carga los campos del Lead por teléfono.
  useEffect(() => {
    if (!open) return;
    const addr0 = { ...(initialAddress || {}) };
    const attrs0: AttrPair[] = Object.entries(initialAttributes || {}).map(([key, value]) => ({
      key,
      value: String(value ?? ""),
    }));
    setAddress(addr0);
    setAttrs(attrs0);
    setSnap((s) => ({ ...s, addr: JSON.stringify(addr0), attrs: JSON.stringify(attrs0) }));
    // Lead por teléfono (para editar etapa / monto / origen y empujar a Salesforce).
    const ep = getApiEndpoints();
    const phone = initialValues.PhoneNumber;
    if (phone && ep?.manageLeads) {
      authedFetch(`${ep.manageLeads}?phone=${encodeURIComponent(phone)}`)
        .then((r) => r.json())
        .then((j) => {
          const lead = (j.leads || [])[0];
          const stage = lead?.stageId || "";
          const monto = lead?.montoEstimado != null ? String(lead.montoEstimado) : "";
          const source = lead?.source || "";
          setLeadId(lead?.leadId || null);
          setLeadStage(stage);
          setLeadMonto(monto);
          setLeadSource(source);
          setSnap((s) => ({ ...s, stage, monto, source }));
        })
        .catch(() => {});
    }
  }, [open, initialAddress, initialAttributes, initialValues.PhoneNumber]);

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
      GenderString: initialValues.GenderString ?? "",
      BirthDate: initialValues.BirthDate ?? "",
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
    initialValues.GenderString,
    initialValues.BirthDate,
  ]);

  const set = (key: keyof ProfileFields, v: string) => setValues((curr) => ({ ...curr, [key]: v }));
  const setAddr = (key: string, v: string) => setAddress((a) => ({ ...a, [key]: v }));
  const updateAttr = (i: number, patch: Partial<AttrPair>) =>
    setAttrs((arr) => arr.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removeAttr = (i: number) => setAttrs((arr) => arr.filter((_, j) => j !== i));
  const addAttr = () => setAttrs((arr) => [...arr, { key: "", value: "" }]);

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
      "Cliente",
    );
  }, [values]);

  // Validation — phone must look like E.164 if set; email must have @.
  const phoneValid = !values.PhoneNumber || /^\+?\d[\d\s\-()]{6,}$/.test(values.PhoneNumber);
  const emailValid = !values.EmailAddress || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.EmailAddress);
  const formValid = phoneValid && emailValid;

  // Cambios en las secciones nuevas (además de changedKeys de los campos base).
  const addrChanged = JSON.stringify(address) !== snap.addr;
  const attrsChanged = JSON.stringify(attrs) !== snap.attrs;
  const leadChanged =
    leadStage !== snap.stage || leadMonto !== snap.monto || leadSource !== snap.source;
  const anyChanged = changedKeys.size > 0 || addrChanged || attrsChanged || leadChanged;

  const save = async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.updateCustomerProfile) {
      toast.error("Endpoint no configurado");
      return;
    }
    if (!anyChanged) {
      toast.info("No hay cambios para guardar");
      return;
    }

    // Campos base de Customer Profiles que cambiaron.
    const fields: Record<string, string | null> = {};
    changedKeys.forEach((k) => {
      const current = (values[k] ?? "") as string;
      fields[k] = current === "" ? null : current;
    });

    // Nombre completo + teléfono para propagar a connectview-leads + conversaciones.
    const fullName = [values.FirstName, values.LastName].filter(Boolean).join(" ").trim();
    const phone = (values.PhoneNumber || "").trim();
    const email = (values.EmailAddress || "").trim();

    // Dirección (si cambió, se manda el objeto completo — CP la reemplaza).
    const addressBody = addrChanged ? address : undefined;
    // Atributos personalizados (si cambiaron, el set completo; el backend reemplaza).
    let attributesBody: Record<string, string> | undefined;
    if (attrsChanged) {
      attributesBody = {};
      for (const { key, value } of attrs) {
        const k = key.trim();
        if (k) attributesBody[k] = value;
      }
    }

    // Advertencia explícita: el cambio NO se queda solo en el perfil — se propaga
    // al lead y a las conversaciones de ARIA, y a Salesforce si está conectado.
    const okConfirm = await confirm({
      title: "Actualizar cliente",
      description:
        "Se actualizará este cliente en ARIA (perfil, lead y conversaciones)" +
        (endpoints.manageLeads ? " y en Salesforce si está conectado" : "") +
        ". ¿Continuar?",
      confirmLabel: "Sí, actualizar",
    });
    if (!okConfirm) return;

    setSubmitting(true);
    try {
      // 1) Customer Profile (identidad + dirección + género/fecha + atributos).
      //    También propaga nombre→lead+conversaciones (backend).
      const r = await fetch(endpoints.updateCustomerProfile, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          fields,
          actor: agentUsername || "unknown",
          ...(fullName ? { name: fullName } : {}),
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
          ...(addressBody ? { address: addressBody } : {}),
          ...(attributesBody ? { attributes: attributesBody } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);

      // 2) Lead + Salesforce: si hay un lead con este teléfono, lo actualizamos vía
      //    manage-leads (nombre + etapa/monto/origen), que empuja a Salesforce y
      //    refresca CP + conversaciones. update-if-exists: no crea leads aquí.
      let sfBlock: { leadId?: string; action?: string } | null = null;
      if (leadId && phone && endpoints.manageLeads) {
        try {
          const leadBody: Record<string, unknown> = { leadId, phone };
          if (fullName) leadBody.name = fullName;
          if (email) leadBody.email = email;
          if (leadStage) leadBody.stageId = leadStage;
          if (leadSource) leadBody.source = leadSource;
          const montoNum = Number(leadMonto);
          if (leadMonto.trim() !== "" && Number.isFinite(montoNum))
            leadBody.montoEstimado = montoNum;
          const lr = await authedFetch(endpoints.manageLeads, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(leadBody),
          });
          const lj = await lr.json().catch(() => ({}));
          sfBlock = lj?.salesforce ?? null;
        } catch (err) {
          // best-effort: el perfil ya se guardó; la sync a Salesforce no bloquea.
          console.warn("sync lead/Salesforce falló:", err);
        }
      }
      // Toast de éxito con botón "Ver en Salesforce" (o simple si no sincronizó).
      leadSavedToast({
        message: "Cliente actualizado",
        salesforce: sfBlock,
        instanceUrl: sfInstanceUrl,
      });
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar el perfil");
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o && !submitting) onClose();
        }}
        className="max-w-lg"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon.Pencil size={14} style={{ color: "var(--accent-cyan)" }} />
            Editar perfil
          </span>
        }
        description={
          <span className="mono" style={{ fontSize: 10.5 }}>
            {profileId.slice(0, 16)}…
          </span>
        }
        footer={
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
              width: "100%",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              {anyChanged ? "Cambios sin guardar" : "Sin cambios"}
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
                disabled={submitting || !anyChanged || !formValid}
                title={
                  !formValid
                    ? "Hay campos con formato inválido"
                    : !anyChanged
                      ? "No hay cambios"
                      : "Guardar cambios"
                }
              >
                <Icon.Check size={12} />
                {submitting ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        }
      >
        {/* Live preview strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            marginTop: 12,
            background: "linear-gradient(135deg, var(--accent-cyan-soft) 0%, transparent 70%)",
            border: "1px solid var(--border-1)",
            borderRadius: 12,
            flexShrink: 0,
          }}
        >
          <Avatar name={displayName} size="lg" color={colorFromName(displayName)} />
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
          {anyChanged && (
            <span
              className="chip chip--cyan"
              style={{ fontSize: 10, padding: "1px 8px", height: 20, flexShrink: 0 }}
              title="Hay cambios sin guardar"
            >
              ● Sin guardar
            </span>
          )}
        </div>

        {/* Body — grouped sections */}
        <div
          style={{
            maxHeight: "56vh",
            overflowY: "auto",
            marginTop: 14,
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
            <Row label="Email" changed={changedKeys.has("EmailAddress")} invalid={!emailValid}>
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

          {/* SECTION — Dirección */}
          <Section
            icon={<Icon.Tag size={12} />}
            title="Dirección"
            color="var(--accent-cyan)"
            colorSoft="var(--accent-cyan-soft)"
          >
            {ADDRESS_FIELDS.map((f) => (
              <Row key={f.key} label={f.label}>
                <Input
                  value={address[f.key] ?? ""}
                  onChange={(v) => setAddr(f.key, v)}
                  placeholder="Opcional"
                />
              </Row>
            ))}
          </Section>

          {/* SECTION — Más datos */}
          <Section
            icon={<Icon.User size={12} />}
            title="Más datos"
            color="var(--accent-violet)"
            colorSoft="var(--accent-violet-soft)"
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Row label="Género" changed={changedKeys.has("GenderString")}>
                <Input
                  value={values.GenderString ?? ""}
                  onChange={(v) => set("GenderString", v)}
                  placeholder="Opcional"
                />
              </Row>
              <Row label="Fecha de nacimiento" changed={changedKeys.has("BirthDate")}>
                <Input
                  value={values.BirthDate ?? ""}
                  onChange={(v) => set("BirthDate", v)}
                  placeholder="AAAA-MM-DD"
                />
              </Row>
            </div>
          </Section>

          {/* SECTION — Atributos personalizados */}
          <Section
            icon={<Icon.Tag size={12} />}
            title="Atributos personalizados"
            color="var(--accent-amber)"
            colorSoft="var(--accent-amber-soft)"
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {attrs.length === 0 && (
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  Sin atributos. Agrega campos propios (ej. DNI, programa, código).
                </span>
              )}
              {attrs.map((pair, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <Input
                    value={pair.key}
                    onChange={(v) => updateAttr(i, { key: v })}
                    placeholder="Clave"
                  />
                  <Input
                    value={pair.value}
                    onChange={(v) => updateAttr(i, { value: v })}
                    placeholder="Valor"
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--icon"
                    onClick={() => removeAttr(i)}
                    aria-label="Quitar atributo"
                  >
                    <Icon.Close size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn--sm"
                onClick={addAttr}
                style={{ alignSelf: "flex-start" }}
              >
                + Agregar atributo
              </button>
            </div>
          </Section>

          {/* SECTION — Lead (sincroniza a Salesforce) */}
          {leadId && (
            <Section
              icon={<Icon.Check size={12} />}
              title="Lead"
              color="var(--accent-green)"
              colorSoft="var(--accent-green-soft)"
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Row label="Monto estimado">
                  <Input
                    value={leadMonto}
                    onChange={setLeadMonto}
                    inputMode="numeric"
                    placeholder="0"
                  />
                </Row>
                <Row label="Origen">
                  <Input
                    value={leadSource}
                    onChange={setLeadSource}
                    placeholder="Ej. Web, Referido"
                  />
                </Row>
              </div>
              <span
                style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4, display: "block" }}
              >
                Estos campos actualizan el lead y se sincronizan con Salesforce.
              </span>
            </Section>
          )}

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
              Solo se envían los campos modificados. Dejar un campo vacío limpia el valor existente
              en el perfil. La actualización queda auditada con tu usuario.
            </span>
          </div>
        </div>
      </Modal>
      {confirmDialog}
    </>
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
      {hint && !invalid && <span style={{ fontSize: 10, color: "var(--text-4)" }}>{hint}</span>}
      {invalid && (
        <span style={{ fontSize: 10, color: "var(--accent-red)" }}>Formato inválido</span>
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
