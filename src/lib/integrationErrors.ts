/**
 * integrationErrors — traduce errores/estados crudos de las integraciones
 * (Amazon Connect, S3, Customer Profiles, Salesforce) a mensajes accionables
 * en español para el usuario final, con la remediación concreta.
 *
 * Complementa al panel "Estado de la integración" (que es proactivo): esto se
 * usa en runtime, cuando algo falla EN USO a pesar de la config. Devuelve un
 * hint legible en vez de un 500 críptico o un panel vacío sin explicación.
 *
 * Uso típico:
 *   const hint = explainIntegrationError(error, "recording");
 *   if (hint) return <IntegrationErrorHint hint={hint} />;
 */

export interface IntegrationHint {
  /** Título corto del problema. */
  title: string;
  /** Explicación + cómo resolverlo. */
  body: string;
  /** Severidad para el estilo (warn = falta una feature; error = roto). */
  severity: "warn" | "error" | "info";
}

/** Contexto de dónde ocurre el error, para dar el hint más preciso. */
export type IntegrationContext =
  | "recording" // reproducir una grabación
  | "transcript" // ver la transcripción de una llamada
  | "customer360" // Cliente 360 / Customer Profiles
  | "dashboard" // métricas en tiempo real
  | "campaign" // campañas / outbound
  | "generic";

/** Normaliza un error a string buscable (mensaje + name + code). */
function errText(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return `${err.name} ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Dado un error (o un estado vacío con `null`) y el contexto, devuelve un hint
 * accionable, o `null` si no hay nada útil que decir (el caller muestra su
 * empty-state normal).
 */
export function explainIntegrationError(
  err: unknown,
  context: IntegrationContext
): IntegrationHint | null {
  const t = errText(err).toLowerCase();

  // ── Sin Connect configurado (los datos vienen vacíos / blocked) ─────────
  if (
    t.includes("blocked-no-tenant-connect") ||
    t.includes("not configured") ||
    t.includes("no configurado")
  ) {
    return {
      title: "Amazon Connect no está conectado",
      body: "Conectá tu instancia de Amazon Connect en Configuración → Integraciones para ver tus datos acá.",
      severity: "info",
    };
  }

  // ── Permisos / acceso (rol cross-account incompleto) ────────────────────
  if (t.includes("accessdenied") || t.includes("not authorized") || t.includes("forbidden")) {
    if (context === "recording") {
      return {
        title: "Sin acceso al audio de la grabación",
        body: "El rol de Vox no puede leer tu bucket de grabaciones. Revisá que el parámetro RecordingBucket de tu plantilla CloudFormation tenga el nombre EXACTO del bucket. Usá 'Estado de la integración' para ver el nombre detectado.",
        severity: "error",
      };
    }
    return {
      title: "Falta un permiso en el rol de acceso",
      body: "Tu rol cross-account no tiene un permiso necesario para esta acción. Reaplicá la última versión de la plantilla CloudFormation desde Configuración → Integraciones.",
      severity: "error",
    };
  }

  // ── Recurso no encontrado (Data Plane sin tablas, contacto viejo) ───────
  if (t.includes("resourcenotfound") || t.includes("not found") || t.includes("404")) {
    if (context === "campaign" || context === "customer360") {
      return {
        title: "Faltan las tablas del Data Plane",
        body: "Activaste BYO Data Plane pero no se encuentran las tablas en tu cuenta. Desplegá la plantilla del paso 4 (las 14 tablas) en tu cuenta AWS.",
        severity: "error",
      };
    }
  }

  // ── Contexto: transcript / Contact Lens ─────────────────────────────────
  if (context === "transcript") {
    return {
      title: "Sin transcripción para esta llamada",
      body: "Esta llamada no tiene transcripción porque Contact Lens estaba apagado cuando ocurrió. Activá Contact Lens en tu consola de Connect → Análisis y optimización; las llamadas nuevas sí la tendrán.",
      severity: "warn",
    };
  }

  // ── Contexto: Customer 360 vacío ────────────────────────────────────────
  if (context === "customer360") {
    return {
      title: "Cliente 360° sin datos",
      body: "No encontramos un dominio de Customer Profiles en tu instancia. Activalo en tu consola de Connect → Customer Profiles para enriquecer los perfiles de tus clientes.",
      severity: "warn",
    };
  }

  // ── Contexto: dashboard sin datos ───────────────────────────────────────
  if (context === "dashboard") {
    return {
      title: "Sin métricas todavía",
      body: "Cuando conectes tu Amazon Connect en Integraciones, vas a ver acá tus colas, agentes y métricas en tiempo real.",
      severity: "info",
    };
  }

  return null;
}
