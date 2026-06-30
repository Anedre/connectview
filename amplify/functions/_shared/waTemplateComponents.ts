/**
 * waTemplateComponents — construye (y valida) el array `components` de una
 * plantilla de WhatsApp en el formato de Meta, compartido por create- y
 * update-whatsapp-template para que NUNCA diverjan.
 *
 * Soporta:
 *  - HEADER de texto, BODY (con variables {{n}} + ejemplos), FOOTER
 *  - Botones: QUICK_REPLY, URL (incl. URL dinámica con {{1}} + ejemplo),
 *    PHONE_NUMBER, COPY_CODE (cupón)
 *  - Categoría AUTHENTICATION: body autogenerado por Meta
 *    (add_security_recommendation), FOOTER con code_expiration_minutes y
 *    botón OTP (otp_type COPY_CODE).
 *
 * NO soporta (todavía): encabezado multimedia (necesita header_handle de la
 * subida a Meta) ni botones FLOW (necesitan flow_id).
 */

export interface ButtonIn {
  type: string; // QUICK_REPLY · URL · PHONE_NUMBER · COPY_CODE · FLOW
  text?: string;
  url?: string;
  phoneNumber?: string;
  example?: string; // URL dinámica: URL de ejemplo · COPY_CODE: código de ejemplo
  // FLOW:
  flowId?: string;
  flowAction?: string; // navigate (default) · data_exchange
  navigateScreen?: string; // pantalla inicial (requerida si flowAction=navigate)
}

export interface BuildInput {
  category: string;
  bodyText?: string;
  headerText?: string;
  /** TEXT (default) · IMAGE · VIDEO · DOCUMENT. Para multimedia se usa headerHandle. */
  headerFormat?: string;
  /** metaHeaderHandle devuelto por upload-whatsapp-template-media (header multimedia). */
  headerHandle?: string;
  footerText?: string;
  buttons?: ButtonIn[];
  variableExamples?: string[];
  // Solo categoría AUTHENTICATION:
  addSecurityRecommendation?: boolean;
  codeExpirationMinutes?: number;
  otpButtonText?: string;
}

const MEDIA_FORMATS = ["IMAGE", "VIDEO", "DOCUMENT"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BuildResult = { ok: true; components: any[] } | { ok: false; error: string };

const HAS_VAR = /\{\{\s*\d+\s*\}\}/;

export function buildTemplateComponents(i: BuildInput): BuildResult {
  const category = (i.category || "").toUpperCase();
  if (!["UTILITY", "MARKETING", "AUTHENTICATION"].includes(category)) {
    return { ok: false, error: "Categoría inválida (UTILITY, MARKETING o AUTHENTICATION)." };
  }

  // ── AUTHENTICATION: estructura especial; Meta genera el cuerpo ──────────
  if (category === "AUTHENTICATION") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const components: any[] = [
      { type: "BODY", add_security_recommendation: !!i.addSecurityRecommendation },
    ];
    const exp = Number(i.codeExpirationMinutes || 0);
    if (exp > 0) {
      components.push({ type: "FOOTER", code_expiration_minutes: Math.min(90, Math.max(1, Math.round(exp))) });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const otp: any = { type: "OTP", otp_type: "COPY_CODE" };
    const otpText = (i.otpButtonText || "").trim();
    if (otpText) otp.text = otpText;
    components.push({ type: "BUTTONS", buttons: [otp] });
    return { ok: true, components };
  }

  // ── UTILITY / MARKETING ────────────────────────────────────────────────
  const bodyText = (i.bodyText || "").trim();
  if (!bodyText) {
    return { ok: false, error: "El cuerpo (body) de la plantilla es obligatorio." };
  }
  const varCount = Array.from(bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).reduce(
    (m, x) => Math.max(m, Number(x[1] || 0)),
    0
  );
  const examples = (i.variableExamples || []).map((v) => String(v));
  if (varCount > 0 && examples.filter((v) => v.trim()).length < varCount) {
    return {
      ok: false,
      error: `Faltan ejemplos para las ${varCount} variables del cuerpo — Meta los exige para aprobar.`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = [];
  const headerFormat = (i.headerFormat || "TEXT").toUpperCase();
  if (MEDIA_FORMATS.includes(headerFormat)) {
    // Encabezado multimedia: el sample va como header_handle (lo da upload-whatsapp-template-media).
    if (i.headerHandle) {
      components.push({ type: "HEADER", format: headerFormat, example: { header_handle: [i.headerHandle] } });
    }
  } else {
    const headerText = (i.headerText || "").trim();
    if (headerText) components.push({ type: "HEADER", format: "TEXT", text: headerText });
  }

  const bodyComp: Record<string, unknown> = { type: "BODY", text: bodyText };
  if (varCount > 0) bodyComp.example = { body_text: [examples.slice(0, varCount)] };
  components.push(bodyComp);

  const footerText = (i.footerText || "").trim();
  if (footerText) components.push({ type: "FOOTER", text: footerText });

  const buttons = i.buttons || [];
  if (buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map((b) => {
        const t = (b.type || "").toUpperCase();
        if (t === "URL") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const btn: any = { type: "URL", text: b.text, url: b.url };
          // URL dinámica: si la URL trae {{1}}, Meta exige un ejemplo completo.
          if (HAS_VAR.test(b.url || "") && b.example) btn.example = [b.example];
          return btn;
        }
        if (t === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
        if (t === "COPY_CODE") return { type: "COPY_CODE", example: b.example || "" };
        if (t === "FLOW") {
          // Meta: flow_action "navigate" EXIGE navigate_screen; si no hay pantalla,
          // usamos "data_exchange" (el flow decide el ruteo) para que sea válido.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fb: any = { type: "FLOW", text: b.text, flow_id: b.flowId };
          if (b.navigateScreen) {
            fb.flow_action = "navigate";
            fb.navigate_screen = b.navigateScreen;
          } else {
            fb.flow_action = "data_exchange";
          }
          return fb;
        }
        return { type: "QUICK_REPLY", text: b.text };
      }),
    });
  }

  return { ok: true, components };
}
