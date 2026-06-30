import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import * as Icon from "@/components/vox/primitives";
import { Card, CardBody, CardHead } from "@/components/vox/primitives";

/**
 * WhatsAppTemplatesManager — biblioteca central de plantillas (HSM) de WhatsApp
 * para el admin: lista las plantillas de la WABA del tenant con su estado y un
 * editor para CREAR una nueva o EDITAR una existente y enviarla a aprobación de
 * Meta (queda PENDING hasta que la revise). Consume list-whatsapp-templates
 * (?includeAll=true), create-whatsapp-template y update-whatsapp-template.
 *
 * Editar (reglas de Meta): no se puede editar una plantilla en revisión
 * (PENDING); no se puede cambiar nombre ni idioma; editar una aprobada la manda
 * de nuevo a revisión; hay límite (~1 vez/24 h).
 */

interface WaTemplate {
  name: string;
  metaTemplateId?: string;
  language?: string;
  category?: string;
  status?: string;
  bodyText?: string;
  variableCount?: number;
  headerText?: string;
  headerFormat?: string; // TEXT · IMAGE · VIDEO · DOCUMENT
  footerText?: string;
  buttons?: { type: string; text: string; url?: string; phoneNumber?: string }[];
}

const STATUS_META: Record<string, { label: string; chip: string }> = {
  APPROVED: { label: "Aprobada", chip: "chip--green" },
  PENDING: { label: "Pendiente", chip: "chip--amber" },
  REJECTED: { label: "Rechazada", chip: "chip--red" },
  PAUSED: { label: "Pausada", chip: "chip--amber" },
  DISABLED: { label: "Deshabilitada", chip: "" },
};

const LANGS = [
  { v: "es", l: "Español" },
  { v: "es_MX", l: "Español (MX)" },
  { v: "es_AR", l: "Español (AR)" },
  { v: "en", l: "Inglés" },
  { v: "en_US", l: "Inglés (US)" },
  { v: "pt_BR", l: "Portugués (BR)" },
];

const CATEGORIES = [
  { v: "UTILITY", l: "Utilidad — confirmaciones, alertas, recordatorios" },
  { v: "MARKETING", l: "Marketing — promociones, novedades" },
  { v: "AUTHENTICATION", l: "Autenticación — códigos OTP" },
];

// Tipo de encabezado. TEXT = título de texto; el resto es multimedia (sube un
// archivo → metaHeaderHandle vía upload-whatsapp-template-media).
const HEADER_FORMATS = [
  { v: "TEXT", l: "Texto" },
  { v: "IMAGE", l: "Imagen" },
  { v: "VIDEO", l: "Video" },
  { v: "DOCUMENT", l: "Documento" },
];
const MEDIA_HEADER = ["IMAGE", "VIDEO", "DOCUMENT"];

// Botones de la plantilla. Meta limita: hasta 10 en total, como mucho 2 URL
// (enlace), 1 de teléfono y 1 de copiar-código. El resto, respuestas rápidas.
// El handler (waTemplateComponents) mapea estos tipos al formato de Meta.
type WaBtnType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "FLOW";
interface EditorButton {
  type: WaBtnType;
  text: string;
  url?: string;
  phoneNumber?: string;
  example?: string; // URL dinámica: URL de ejemplo · COPY_CODE: código de ejemplo
  // FLOW (formulario nativo de Meta):
  flowId?: string;
  navigateScreen?: string;
}
const BTN_LIMITS = { total: 10, URL: 2, PHONE_NUMBER: 1, COPY_CODE: 1, FLOW: 1 } as const;
const BTN_META: Record<WaBtnType, { label: string; hint: string }> = {
  QUICK_REPLY: { label: "Respuesta rápida", hint: "El cliente toca y te responde con ese texto" },
  URL: { label: "Enlace", hint: "Abre una página web (podés usar {{1}} para una URL dinámica)" },
  PHONE_NUMBER: { label: "Llamar", hint: "Marca un número de teléfono" },
  COPY_CODE: { label: "Copiar código", hint: "El cliente copia un código (cupón/promo)" },
  FLOW: { label: "Formulario", hint: "Abre un WhatsApp Flow (formulario nativo de Meta)" },
};

interface WaFlow {
  id: string;
  name?: string;
  status?: string;
}
// Detecta una variable {{n}} (para URL dinámica).
const HAS_VAR = /\{\{\s*\d+\s*\}\}/;

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-2)",
  border: "1px solid var(--border-1)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text-1)",
  outline: "none",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
};

export function WhatsAppTemplatesManager() {
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  // Form de la nueva plantilla.
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es");
  const [category, setCategory] = useState("UTILITY");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [varExamples, setVarExamples] = useState<string[]>([]);
  const [buttons, setButtons] = useState<EditorButton[]>([]);
  // metaTemplateId de la plantilla en edición; null = creando una nueva.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Categoría AUTHENTICATION (OTP): Meta genera el cuerpo; solo configuramos esto.
  const [authSecurityRec, setAuthSecurityRec] = useState(true);
  const [authCodeExp, setAuthCodeExp] = useState(10);
  const [authOtpText, setAuthOtpText] = useState("");
  // Borrado (acción destructiva → modal de confirmación).
  const [deleteTarget, setDeleteTarget] = useState<WaTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Encabezado multimedia: el archivo se sube y se guarda su metaHeaderHandle.
  const [headerFormat, setHeaderFormat] = useState("TEXT");
  const [headerHandle, setHeaderHandle] = useState("");
  const [headerMediaName, setHeaderMediaName] = useState("");
  const [headerMediaPreview, setHeaderMediaPreview] = useState(""); // object URL (imágenes)
  const [uploadingMedia, setUploadingMedia] = useState(false);
  // WhatsApp Flows del tenant (para el botón de formulario).
  const [flows, setFlows] = useState<WaFlow[]>([]);

  const isAuth = category === "AUTHENTICATION";
  const isMedia = MEDIA_HEADER.includes(headerFormat);

  const refresh = useCallback(async () => {
    const ep = getApiEndpoints();
    if (!ep?.listWhatsAppTemplates) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await authedFetch(`${ep.listWhatsAppTemplates}?includeAll=true`);
      const j = await r.json();
      setTemplates(Array.isArray(j.templates) ? j.templates : []);
    } catch {
      /* mantenemos lo último bueno */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Cargar los WhatsApp Flows del tenant una vez (para el botón de formulario).
  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.listWhatsAppFlows) return;
    (async () => {
      try {
        const r = await authedFetch(ep.listWhatsAppFlows);
        const j = await r.json();
        setFlows(Array.isArray(j.flows) ? j.flows : []);
      } catch {
        /* sin flows → el botón de formulario queda deshabilitado */
      }
    })();
  }, []);

  // Variables {{n}} detectadas en el body → tantos inputs de ejemplo.
  const varCount = useMemo(
    () =>
      Array.from(bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).reduce(
        (m, x) => Math.max(m, Number(x[1] || 0)),
        0
      ),
    [bodyText]
  );
  useEffect(() => {
    setVarExamples((prev) => Array.from({ length: varCount }, (_, i) => prev[i] || ""));
  }, [varCount]);

  // ── Botones ──────────────────────────────────────────────────────────
  const countByType = (t: WaBtnType) => buttons.filter((b) => b.type === t).length;
  const canAdd = (t: WaBtnType) => {
    if (buttons.length >= BTN_LIMITS.total) return false;
    if (t === "URL") return countByType("URL") < BTN_LIMITS.URL;
    if (t === "PHONE_NUMBER") return countByType("PHONE_NUMBER") < BTN_LIMITS.PHONE_NUMBER;
    if (t === "COPY_CODE") return countByType("COPY_CODE") < BTN_LIMITS.COPY_CODE;
    if (t === "FLOW") return countByType("FLOW") < BTN_LIMITS.FLOW && flows.length > 0;
    return true;
  };
  const addButton = (t: WaBtnType) => {
    if (!canAdd(t)) return;
    setButtons((prev) => [
      ...prev,
      {
        type: t,
        text: "",
        url: t === "URL" ? "" : undefined,
        phoneNumber: t === "PHONE_NUMBER" ? "" : undefined,
        example: t === "URL" || t === "COPY_CODE" ? "" : undefined,
        flowId: t === "FLOW" ? flows[0]?.id || "" : undefined,
        navigateScreen: t === "FLOW" ? "" : undefined,
      },
    ]);
  };
  const updateButton = (i: number, patch: Partial<EditorButton>) =>
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const removeButton = (i: number) => setButtons((prev) => prev.filter((_, idx) => idx !== i));

  const resetForm = () => {
    setName("");
    setLanguage("es");
    setCategory("UTILITY");
    setHeaderText("");
    setBodyText("");
    setFooterText("");
    setVarExamples([]);
    setButtons([]);
    setEditingId(null);
    setAuthSecurityRec(true);
    setAuthCodeExp(10);
    setAuthOtpText("");
    setHeaderFormat("TEXT");
    setHeaderHandle("");
    setHeaderMediaName("");
    setHeaderMediaPreview("");
  };

  // Sube un archivo de encabezado multimedia → metaHeaderHandle.
  const uploadMedia = async (file: File) => {
    const ep = getApiEndpoints();
    if (!ep?.uploadWhatsAppTemplateMedia) {
      toast.error("Falta desplegar el Lambda upload-whatsapp-template-media (endpoint no configurado).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("El archivo supera 5 MB.");
      return;
    }
    setUploadingMedia(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] || "";
      const r = await authedFetch(ep.uploadWhatsAppTemplateMedia, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, contentType: file.type, fileName: file.name }),
      });
      const j = await r.json();
      if (!r.ok || !j.metaHeaderHandle) throw new Error(j.error || `HTTP ${r.status}`);
      setHeaderHandle(j.metaHeaderHandle);
      setHeaderMediaName(file.name);
      setHeaderMediaPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : "");
      toast.success("Archivo cargado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir el archivo");
    } finally {
      setUploadingMedia(false);
    }
  };

  // Carga una plantilla existente en el editor (modo edición). Mapea solo los
  // tipos de botón soportados; si la plantilla trae otros (copiar código, flow…)
  // avisa que se quitarían al guardar.
  const startEdit = (t: WaTemplate) => {
    const supported: EditorButton[] = [];
    let dropped = false;
    for (const b of t.buttons || []) {
      const ty = (b.type || "").toUpperCase();
      if (ty === "URL") supported.push({ type: "URL", text: b.text || "", url: b.url || "", example: "" });
      else if (ty === "PHONE_NUMBER")
        supported.push({ type: "PHONE_NUMBER", text: b.text || "", phoneNumber: b.phoneNumber || "" });
      else if (ty === "QUICK_REPLY") supported.push({ type: "QUICK_REPLY", text: b.text || "" });
      else if (ty === "COPY_CODE") supported.push({ type: "COPY_CODE", text: "", example: "" });
      else dropped = true;
    }
    setName(t.name || "");
    setLanguage(t.language || "es");
    setCategory((t.category || "UTILITY").toUpperCase());
    setHeaderText(t.headerText || "");
    const hf = (t.headerFormat || "TEXT").toUpperCase();
    setHeaderFormat(hf);
    setHeaderHandle("");
    setHeaderMediaName("");
    setHeaderMediaPreview("");
    if (MEDIA_HEADER.includes(hf)) {
      toast("Esta plantilla tiene un encabezado multimedia: volvé a subir el archivo para conservarlo al guardar.");
    }
    setBodyText(t.bodyText || "");
    setFooterText(t.footerText || "");
    setVarExamples([]);
    setButtons(supported);
    setEditingId(t.metaTemplateId || null);
    // Auth: el list no devuelve los detalles (security rec / expiración) → defaults.
    setAuthSecurityRec(true);
    setAuthCodeExp(10);
    setAuthOtpText("");
    setShowEditor(true);
    if (dropped) {
      toast("Esta plantilla tiene botones que el editor no soporta (ej. Flow); si guardás, se quitarán.");
    }
    // Subir el editor a la vista una vez montado.
    setTimeout(() => {
      document.getElementById("wa-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  const submit = async () => {
    const ep = getApiEndpoints();
    const isEdit = !!editingId;
    const endpoint = isEdit ? ep?.updateWhatsAppTemplate : ep?.createWhatsAppTemplate;
    if (!endpoint) {
      toast.error(
        `Falta desplegar el Lambda ${isEdit ? "update" : "create"}-whatsapp-template (endpoint no configurado).`
      );
      return;
    }
    // El nombre solo aplica al crear (al editar no se puede cambiar).
    if (!isEdit && !/^[a-z0-9_]+$/.test(name)) {
      toast.error("El nombre debe ser minúsculas, números y guiones bajos (ej. confirmacion_cita).");
      return;
    }
    // Validaciones del contenido. Las de AUTHENTICATION son distintas (Meta
    // genera el cuerpo, no hay body ni botones libres).
    if (!isAuth) {
      if (isMedia && !headerHandle) {
        toast.error("Subí el archivo del encabezado multimedia (o cambiá el tipo a Texto).");
        return;
      }
      if (!bodyText.trim()) {
        toast.error("El cuerpo (body) es obligatorio.");
        return;
      }
      if (varCount > 0 && varExamples.filter((v) => v.trim()).length < varCount) {
        toast.error(`Completá los ${varCount} ejemplos de variables (Meta los exige para aprobar).`);
        return;
      }
      for (const b of buttons) {
        if (b.type === "COPY_CODE") {
          if (!(b.example || "").trim()) {
            toast.error("El botón de copiar código necesita un código de ejemplo.");
            return;
          }
          continue;
        }
        if (b.type === "FLOW") {
          if (!b.flowId) {
            toast.error("Elegí un formulario (Flow) para el botón.");
            return;
          }
          if (!b.text.trim()) {
            toast.error("El botón de formulario necesita un texto.");
            return;
          }
          continue;
        }
        if (!b.text.trim()) {
          toast.error("Cada botón necesita un texto.");
          return;
        }
        if (b.type === "URL" && !(b.url || "").trim()) {
          toast.error(`El botón de enlace "${b.text}" necesita una URL.`);
          return;
        }
        if (b.type === "URL" && HAS_VAR.test(b.url || "") && !(b.example || "").trim()) {
          toast.error(`La URL dinámica "${b.text}" necesita una URL de ejemplo.`);
          return;
        }
        if (b.type === "PHONE_NUMBER" && !(b.phoneNumber || "").trim()) {
          toast.error(`El botón de llamada "${b.text}" necesita un teléfono.`);
          return;
        }
      }
    }

    const mappedButtons =
      !isAuth && buttons.length
        ? buttons.map((b) => ({
            type: b.type,
            text: b.text.trim(),
            url: b.url?.trim() || undefined,
            phoneNumber: b.phoneNumber?.trim() || undefined,
            example: b.example?.trim() || undefined,
            flowId: b.flowId || undefined,
            navigateScreen: b.navigateScreen?.trim() || undefined,
          }))
        : undefined;

    const contentPayload = isAuth
      ? {
          category,
          addSecurityRecommendation: authSecurityRec,
          codeExpirationMinutes: authCodeExp || undefined,
          otpButtonText: authOtpText.trim() || undefined,
        }
      : {
          category,
          headerText: headerText.trim() || undefined,
          headerFormat,
          headerHandle: headerHandle || undefined,
          bodyText: bodyText.trim(),
          footerText: footerText.trim() || undefined,
          variableExamples: varExamples,
          buttons: mappedButtons,
        };

    setCreating(true);
    try {
      const payload = isEdit
        ? { metaTemplateId: editingId, ...contentPayload }
        : { name, language, ...contentPayload };
      const r = await authedFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast.success(
        isEdit
          ? "Cambios guardados · la plantilla vuelve a revisión de Meta (Pendiente)"
          : `Plantilla enviada a aprobación · estado ${j.status || "PENDING"}`
      );
      resetForm();
      setShowEditor(false);
      refresh();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : isEdit
          ? "No se pudo actualizar la plantilla"
          : "No se pudo crear la plantilla"
      );
    } finally {
      setCreating(false);
    }
  };

  // Borrar la plantilla seleccionada (tras confirmar en el modal).
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const ep = getApiEndpoints();
    if (!ep?.deleteWhatsAppTemplate) {
      toast.error("Falta desplegar el Lambda delete-whatsapp-template (endpoint no configurado).");
      return;
    }
    setDeleting(true);
    try {
      const r = await authedFetch(ep.deleteWhatsAppTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: deleteTarget.name,
          metaTemplateId: deleteTarget.metaTemplateId,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast.success(`Plantilla "${deleteTarget.name}" eliminada`);
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo borrar la plantilla");
    } finally {
      setDeleting(false);
    }
  };

  // Preview del body con {{n}} reemplazado por el ejemplo (o resaltado).
  const previewBody = useMemo(() => {
    if (!bodyText) return "";
    return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
      const ex = varExamples[Number(n) - 1];
      return ex && ex.trim() ? ex : `{{${n}}}`;
    });
  }, [bodyText, varExamples]);

  return (
    <div className="col wa-tmpl" style={{ gap: 16 }}>
      <Card>
        <CardHead
          title="Plantillas de WhatsApp"
          right={
            <button
              className="btn btn--primary btn--sm"
              onClick={() => {
                if (showEditor) {
                  setShowEditor(false);
                  resetForm();
                } else {
                  resetForm();
                  setShowEditor(true);
                }
              }}
            >
              <Icon.Plus size={13} /> {showEditor ? "Cerrar editor" : "Nueva plantilla"}
            </button>
          }
        />
        <CardBody>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
            Las plantillas se crean aquí y se envían a <b>aprobación de Meta</b> (quedan{" "}
            <span className="chip chip--amber" style={{ fontSize: 10.5 }}>Pendiente</span> hasta que
            las revise, normalmente minutos a 24 h). Una vez{" "}
            <span className="chip chip--green" style={{ fontSize: 10.5 }}>Aprobada</span>, ya se puede
            usar en Campañas, Bots y seguimientos. Salen de la WABA de tu organización.
          </div>

          {/* Editor */}
          {showEditor && (
            <div
              id="wa-editor"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 300px",
                gap: 16,
                padding: 14,
                border: "1px solid var(--border-1)",
                borderRadius: 12,
                background: "var(--bg-2)",
                marginBottom: 16,
              }}
            >
              {/* Form */}
              <div className="col" style={{ gap: 10 }}>
                {editingId && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11.5,
                      color: "var(--text-2)",
                      background: "var(--bg-1)",
                      border: "1px solid var(--border-1)",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <Icon.Pencil size={13} />
                    <span>
                      Editando <b>{name}</b> — el nombre y el idioma no se pueden cambiar; al guardar, la
                      plantilla vuelve a <span className="chip chip--amber" style={{ fontSize: 10 }}>revisión de Meta</span>.
                    </span>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label className="col" style={{ gap: 4 }}>
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      Nombre (snake_case){editingId ? " · fijo" : ""}
                    </span>
                    <input
                      style={{ ...inputStyle, ...(editingId ? { opacity: 0.6, cursor: "not-allowed" } : null) }}
                      value={name}
                      disabled={!!editingId}
                      onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                      placeholder="confirmacion_cita"
                    />
                  </label>
                  <label className="col" style={{ gap: 4 }}>
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      Idioma{editingId ? " · fijo" : ""}
                    </span>
                    <select
                      style={{ ...inputStyle, ...(editingId ? { opacity: 0.6, cursor: "not-allowed" } : null) }}
                      value={language}
                      disabled={!!editingId}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      {LANGS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
                    </select>
                  </label>
                </div>
                <label className="col" style={{ gap: 4 }}>
                  <span className="muted" style={{ fontSize: 10.5 }}>Categoría</span>
                  <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                  </select>
                </label>

                {/* AUTHENTICATION: Meta autogenera el cuerpo; solo configuramos el OTP */}
                {isAuth && (
                  <div className="col" style={{ gap: 10, padding: 12, border: "1px dashed var(--border-1)", borderRadius: 10 }}>
                    <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
                      En plantillas de <b>autenticación</b>, Meta genera el cuerpo automáticamente:{" "}
                      <i>«&lt;código&gt; es tu código de verificación.»</i> Solo configurás el resto.
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={authSecurityRec} onChange={(e) => setAuthSecurityRec(e.target.checked)} />
                      Agregar recomendación de seguridad («no compartas este código»)
                    </label>
                    <label className="col" style={{ gap: 4 }}>
                      <span className="muted" style={{ fontSize: 10.5 }}>El código expira en (minutos · 0 = sin pie)</span>
                      <input
                        type="number"
                        min={0}
                        max={90}
                        style={{ ...inputStyle, width: 140 }}
                        value={authCodeExp}
                        onChange={(e) => setAuthCodeExp(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
                      />
                    </label>
                    <label className="col" style={{ gap: 4 }}>
                      <span className="muted" style={{ fontSize: 10.5 }}>Texto del botón (opcional · por defecto «Copiar código»)</span>
                      <input style={inputStyle} value={authOtpText} maxLength={25} onChange={(e) => setAuthOtpText(e.target.value)} placeholder="Copiar código" />
                    </label>
                  </div>
                )}

                {!isAuth && (
                  <>
                <div className="col" style={{ gap: 4 }}>
                  <span className="muted" style={{ fontSize: 10.5 }}>Encabezado (opcional)</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      style={{ ...inputStyle, width: 120, flexShrink: 0 }}
                      value={headerFormat}
                      onChange={(e) => {
                        setHeaderFormat(e.target.value);
                        setHeaderHandle("");
                        setHeaderMediaName("");
                        setHeaderMediaPreview("");
                      }}
                    >
                      {HEADER_FORMATS.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}
                    </select>
                    {headerFormat === "TEXT" ? (
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        value={headerText}
                        onChange={(e) => setHeaderText(e.target.value)}
                        placeholder="Ej. Confirmación de tu cita"
                      />
                    ) : (
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                        <label
                          className="btn btn--ghost btn--sm"
                          style={{ cursor: uploadingMedia ? "wait" : "pointer", margin: 0, flexShrink: 0 }}
                        >
                          <Icon.Plus size={12} />{" "}
                          {uploadingMedia ? "Subiendo…" : headerHandle ? "Cambiar archivo" : "Subir archivo"}
                          <input
                            type="file"
                            accept={headerFormat === "IMAGE" ? "image/*" : headerFormat === "VIDEO" ? "video/*" : "application/pdf"}
                            style={{ display: "none" }}
                            disabled={uploadingMedia}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadMedia(f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {headerHandle ? (
                          <span style={{ fontSize: 11, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span style={{ color: "#16a34a" }}>✓</span> {headerMediaName}
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 10.5 }}>≤ 5 MB</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <label className="col" style={{ gap: 4 }}>
                  <span className="muted" style={{ fontSize: 10.5 }}>
                    Cuerpo — usá {"{{1}}"}, {"{{2}}"}… para variables
                  </span>
                  <textarea
                    style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    placeholder="Hola {{1}}, tu cita es el {{2}}. ¡Te esperamos!"
                  />
                </label>
                {varCount > 0 && (
                  <div className="col" style={{ gap: 6 }}>
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      Ejemplos de variables (Meta los exige para aprobar)
                    </span>
                    {Array.from({ length: varCount }, (_, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="mono muted" style={{ fontSize: 11, width: 32 }}>{`{{${i + 1}}}`}</span>
                        <input
                          style={inputStyle}
                          value={varExamples[i] || ""}
                          onChange={(e) =>
                            setVarExamples((prev) => {
                              const n = [...prev];
                              n[i] = e.target.value;
                              return n;
                            })
                          }
                          placeholder={`Ejemplo para {{${i + 1}}}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <label className="col" style={{ gap: 4 }}>
                  <span className="muted" style={{ fontSize: 10.5 }}>Pie (opcional)</span>
                  <input style={inputStyle} value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Ej. Equipo UDEP" />
                </label>

                {/* Botones: respuestas rápidas, enlaces (incl. dinámico), llamada, copiar código */}
                <div className="col" style={{ gap: 6 }}>
                  <span className="muted" style={{ fontSize: 10.5 }}>
                    Botones (opcional) — hasta {BTN_LIMITS.total}: respuestas rápidas, enlaces, llamada y copiar código
                  </span>
                  {buttons.map((b, i) => {
                    const isUrlDyn = b.type === "URL" && HAS_VAR.test(b.url || "");
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span
                          title={BTN_META[b.type].hint}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--text-2)", width: 104, flexShrink: 0 }}
                        >
                          {b.type === "URL" ? (
                            <Icon.Globe size={13} />
                          ) : b.type === "PHONE_NUMBER" ? (
                            <Icon.Phone size={13} />
                          ) : b.type === "COPY_CODE" ? (
                            <Icon.Copy size={13} />
                          ) : b.type === "FLOW" ? (
                            <Icon.Note size={13} />
                          ) : (
                            <Icon.Chat size={13} />
                          )}
                          {BTN_META[b.type].label}
                        </span>
                        {b.type === "FLOW" ? (
                          <select
                            style={{ ...inputStyle, flex: 1.2 }}
                            value={b.flowId || ""}
                            onChange={(e) => updateButton(i, { flowId: e.target.value })}
                          >
                            {flows.map((f) => (
                              <option key={f.id} value={f.id}>
                                {(f.name || f.id) + (f.status && f.status !== "PUBLISHED" ? ` (${f.status})` : "")}
                              </option>
                            ))}
                          </select>
                        ) : b.type === "COPY_CODE" ? (
                          <input
                            style={{ ...inputStyle, flex: 1 }}
                            value={b.example || ""}
                            maxLength={15}
                            onChange={(e) => updateButton(i, { example: e.target.value })}
                            placeholder="Código de ejemplo (ej. PROMO25)"
                          />
                        ) : (
                          <input
                            style={{ ...inputStyle, flex: 1 }}
                            value={b.text}
                            maxLength={25}
                            onChange={(e) => updateButton(i, { text: e.target.value })}
                            placeholder="Texto del botón"
                          />
                        )}
                        {b.type === "URL" && (
                          <input
                            style={{ ...inputStyle, flex: 1.4 }}
                            value={b.url || ""}
                            onChange={(e) => updateButton(i, { url: e.target.value })}
                            placeholder="https://ejemplo.com/{{1}}"
                          />
                        )}
                        {b.type === "PHONE_NUMBER" && (
                          <input
                            style={{ ...inputStyle, flex: 1.4 }}
                            value={b.phoneNumber || ""}
                            onChange={(e) => updateButton(i, { phoneNumber: e.target.value })}
                            placeholder="+51999888777"
                          />
                        )}
                        {b.type === "FLOW" && (
                          <input
                            style={{ ...inputStyle, flex: 1 }}
                            value={b.text}
                            maxLength={25}
                            onChange={(e) => updateButton(i, { text: e.target.value })}
                            placeholder="Texto del botón"
                          />
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => removeButton(i)}
                          title="Quitar botón"
                          style={{ flexShrink: 0, padding: "6px 8px" }}
                        >
                          <Icon.Close size={13} />
                        </button>
                        {isUrlDyn && (
                          <input
                            style={{ ...inputStyle, flexBasis: "100%" }}
                            value={b.example || ""}
                            onChange={(e) => updateButton(i, { example: e.target.value })}
                            placeholder="URL de ejemplo completa (ej. https://ejemplo.com/orden/12345)"
                          />
                        )}
                        {b.type === "FLOW" && (
                          <input
                            style={{ ...inputStyle, flexBasis: "100%" }}
                            value={b.navigateScreen || ""}
                            onChange={(e) => updateButton(i, { navigateScreen: e.target.value })}
                            placeholder="Pantalla inicial del formulario (opcional, ej. WELCOME_SCREEN)"
                          />
                        )}
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!canAdd("QUICK_REPLY")}
                      onClick={() => addButton("QUICK_REPLY")}
                    >
                      <Icon.Plus size={12} /> Respuesta rápida
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!canAdd("URL")}
                      onClick={() => addButton("URL")}
                      title={canAdd("URL") ? "" : `Máximo ${BTN_LIMITS.URL} enlaces`}
                    >
                      <Icon.Globe size={12} /> Enlace
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!canAdd("PHONE_NUMBER")}
                      onClick={() => addButton("PHONE_NUMBER")}
                      title={canAdd("PHONE_NUMBER") ? "" : `Máximo ${BTN_LIMITS.PHONE_NUMBER} botón de llamada`}
                    >
                      <Icon.Phone size={12} /> Llamar
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!canAdd("COPY_CODE")}
                      onClick={() => addButton("COPY_CODE")}
                      title={canAdd("COPY_CODE") ? "" : `Máximo ${BTN_LIMITS.COPY_CODE} botón de copiar código`}
                    >
                      <Icon.Copy size={12} /> Copiar código
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!canAdd("FLOW")}
                      onClick={() => addButton("FLOW")}
                      title={
                        flows.length === 0
                          ? "No hay formularios (Flows) en esta WABA"
                          : canAdd("FLOW")
                          ? ""
                          : `Máximo ${BTN_LIMITS.FLOW} formulario`
                      }
                    >
                      <Icon.Note size={12} /> Formulario
                    </button>
                  </div>
                </div>
                  </>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <button className="btn btn--ghost btn--sm" onClick={() => { resetForm(); setShowEditor(false); }} disabled={creating}>
                    Cancelar
                  </button>
                  <button className="btn btn--primary btn--sm" onClick={submit} disabled={creating}>
                    {creating
                      ? editingId
                        ? "Guardando…"
                        : "Enviando…"
                      : editingId
                      ? "Guardar cambios"
                      : "Enviar a aprobación"}
                  </button>
                </div>
              </div>

              {/* Preview tipo WhatsApp */}
              <div>
                <span className="muted" style={{ fontSize: 10.5 }}>Vista previa</span>
                <div
                  style={{
                    marginTop: 6,
                    background: "#e5ddd5",
                    borderRadius: 10,
                    padding: 14,
                    minHeight: 120,
                  }}
                >
                  {isAuth ? (
                    <>
                      <div style={{ background: "#fff", borderRadius: "8px 8px 8px 2px", padding: "8px 10px", boxShadow: "0 1px 1px rgba(0,0,0,0.15)", maxWidth: 240, fontSize: 12.5, color: "#111", lineHeight: 1.45 }}>
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          123456 es tu código de verificación.{authSecurityRec ? " Por tu seguridad, no compartas este código." : ""}
                        </div>
                        {authCodeExp > 0 && (
                          <div style={{ color: "#667781", fontSize: 11, marginTop: 6 }}>Este código expira en {authCodeExp} minutos.</div>
                        )}
                      </div>
                      <div style={{ marginTop: 6, maxWidth: 240 }}>
                        <div style={{ background: "#fff", borderRadius: 8, padding: "7px 10px", textAlign: "center", fontSize: 12.5, color: "#00a5f4", fontWeight: 500, boxShadow: "0 1px 1px rgba(0,0,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          <Icon.Copy size={14} /> {authOtpText.trim() || "Copiar código"}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          background: "#fff",
                          borderRadius: "8px 8px 8px 2px",
                          padding: "8px 10px",
                          boxShadow: "0 1px 1px rgba(0,0,0,0.15)",
                          maxWidth: 240,
                          fontSize: 12.5,
                          color: "#111",
                          lineHeight: 1.45,
                        }}
                      >
                        {isMedia &&
                          (headerMediaPreview ? (
                            <img
                              src={headerMediaPreview}
                              alt=""
                              style={{ width: "100%", borderRadius: 6, marginBottom: 6, maxHeight: 120, objectFit: "cover", display: "block" }}
                            />
                          ) : (
                            <div style={{ background: "#d9d2c9", borderRadius: 6, marginBottom: 6, height: 88, display: "flex", alignItems: "center", justifyContent: "center", color: "#5b6b73", fontSize: 12 }}>
                              {headerFormat === "VIDEO" ? "🎬 Video" : headerFormat === "DOCUMENT" ? "📄 Documento" : "🖼️ Imagen"}
                            </div>
                          ))}
                        {headerFormat === "TEXT" && headerText && (
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>{headerText}</div>
                        )}
                        <div style={{ whiteSpace: "pre-wrap" }}>{previewBody || "Tu mensaje aparecerá aquí…"}</div>
                        {footerText && <div style={{ color: "#667781", fontSize: 11, marginTop: 6 }}>{footerText}</div>}
                      </div>
                      {buttons.length > 0 && (
                        <div style={{ marginTop: 6, maxWidth: 240, display: "flex", flexDirection: "column", gap: 4 }}>
                          {buttons.map((b, i) => (
                            <div
                              key={i}
                              style={{
                                background: "#fff",
                                borderRadius: 8,
                                padding: "7px 10px",
                                textAlign: "center",
                                fontSize: 12.5,
                                color: "#00a5f4",
                                fontWeight: 500,
                                boxShadow: "0 1px 1px rgba(0,0,0,0.12)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 6,
                              }}
                            >
                              {b.type === "URL" ? (
                                <Icon.Globe size={14} />
                              ) : b.type === "PHONE_NUMBER" ? (
                                <Icon.Phone size={14} />
                              ) : b.type === "COPY_CODE" ? (
                                <Icon.Copy size={14} />
                              ) : b.type === "FLOW" ? (
                                <Icon.Note size={14} />
                              ) : (
                                <Icon.Chat size={14} />
                              )}
                              {b.type === "COPY_CODE" ? "Copiar código" : b.text || "Botón"}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Lista de plantillas existentes */}
          {loading ? (
            <div className="muted" style={{ fontSize: 12.5, padding: 16, textAlign: "center" }}>Cargando plantillas…</div>
          ) : templates.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, padding: 24, textAlign: "center" }}>
              No hay plantillas todavía. Crea la primera con “Nueva plantilla”. (Si WhatsApp no está
              configurado, cargá tu WABA en Configuración → Integraciones.)
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {templates.map((t) => {
                const st = STATUS_META[(t.status || "").toUpperCase()] || { label: t.status || "—", chip: "" };
                return (
                  <div
                    key={`${t.name}-${t.language}`}
                    className="wa-tmpl-card"
                    style={{
                      border: "1px solid var(--border-1)",
                      borderRadius: 10,
                      padding: 12,
                      background: "var(--bg-1)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.name}
                      </span>
                      <span className={`chip ${st.chip}`} style={{ fontSize: 10 }}>{st.label}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 10.5, marginBottom: 6 }}>
                      {(t.language || "—")} · {t.category || "—"}
                      {t.variableCount ? ` · ${t.variableCount} var` : ""}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.4, maxHeight: 54, overflow: "hidden" }}>
                      {t.bodyText || <span className="muted">(sin cuerpo)</span>}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, minHeight: 24, gap: 8 }}>
                      <span className="muted" style={{ fontSize: 10 }}>
                        {(t.status || "").toUpperCase() === "PENDING" ? "En revisión — no editable" : ""}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {t.metaTemplateId && (t.status || "").toUpperCase() !== "PENDING" && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => startEdit(t)}
                            style={{ padding: "4px 10px" }}
                            title="Editar esta plantilla"
                          >
                            <Icon.Pencil size={12} /> Editar
                          </button>
                        )}
                        {t.metaTemplateId && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => setDeleteTarget(t)}
                            style={{ padding: "4px 8px", color: "#e5484d" }}
                            title="Borrar esta plantilla"
                          >
                            <Icon.Trash size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Confirmación de borrado (acción destructiva) */}
      {deleteTarget && (
        <div
          onClick={() => !deleting && setDeleteTarget(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderRadius: 12,
              padding: 20,
              maxWidth: 380,
              width: "90%",
              boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "#e5484d" }}>
              <Icon.Trash size={16} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>Borrar plantilla</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 16 }}>
              ¿Seguro que querés borrar <b>{deleteTarget.name}</b>? Esta acción no se puede deshacer y la
              plantilla dejará de estar disponible en Campañas, Bots y seguimientos.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancelar
              </button>
              <button
                className="btn btn--danger btn--sm"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "Borrando…" : "Sí, borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
