import type { Handler } from "aws-lambda";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  ConnectContactLensClient,
  ListRealtimeContactAnalysisSegmentsCommand,
} from "@aws-sdk/client-connect-contact-lens";
import { resolveBedrock } from "../_shared/tenantConnect";

// maxAttempts: 1 → no SDK retries on throttling. The frontend will retry.
// BYO Bedrock: los resúmenes/copiloto corren en la cuenta del CLIENTE (su quota
// de Bedrock). `bedrock` se reasigna por request vía resolveBedrock; el legacy
// (cuenta de Vox) es el fallback para Novasys o tenants sin Connect conectado.
const legacyBedrock = new BedrockRuntimeClient({ maxAttempts: 1 });
let bedrock: BedrockRuntimeClient = legacyBedrock;
const contactLens = new ConnectContactLensClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
// Use US cross-region inference profile prefix — Claude 3.5+ requires inference profiles,
// no longer supports on-demand invocation by foundation model ID directly.
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

interface TranscriptSegment {
  participant: string;
  content: string;
}

/** Compact disposition tree the frontend ships for mode="wrap-up-suggest".
 *  Mirrors src/lib/dispositions.ts DispositionStage but trimmed to what
 *  the model needs to choose. */
interface TaxonomyStage {
  id: string;
  label: string;
  valoracion: string;
  description?: string;
  subStages: { id: string; label: string }[];
}

/** Build the wrap-up-suggest prompt from the active taxonomy + transcript.
 *  Asks Claude to pick ONE stage + ONE subStage and justify it with a
 *  confidence score, so the UI can show "sugerido por IA · 87%". */
function buildWrapUpSuggestPrompt(
  tree: TaxonomyStage[],
  transcript: string
): string {
  const catalog = tree
    .map((s) => {
      const subs = s.subStages
        .map((ss) => `      - ${ss.id} → "${ss.label}"`)
        .join("\n");
      const desc = s.description ? ` (${s.description})` : "";
      return `- ${s.id} → "${s.label}" [${s.valoracion}]${desc}\n${subs}`;
    })
    .join("\n");

  return `Eres un experto en tipificación de contact center. Analiza la conversación y elige la tipificación MÁS adecuada del catálogo. Debes elegir exactamente UN stage y UN subStage que pertenezca a ese stage.

CATÁLOGO DE TIPIFICACIÓN (stage → subStages):
${catalog}

REGLAS:
- "stageId" debe ser uno de los ids de stage del catálogo.
- "subStageId" debe ser un id de subStage que pertenezca al stage elegido.
- "valoracion" es la del stage elegido (positiva/negativa/cierre).
- "confidence" es un entero 0-100 según qué tan claro está el desenlace en la conversación.
- "reason" es UNA frase corta (max 18 palabras) citando qué dijo el cliente para justificar la elección.
- Si la conversación es ambigua o muy corta, baja el confidence (ej. 40-55) y elige el stage más conservador.

FORMATO ESTRICTO — responde SOLO con este objeto JSON, sin markdown ni texto extra:
{"stageId":"...","subStageId":"...","valoracion":"...","confidence":85,"reason":"..."}

Transcripción:
${transcript}`;
}

// SINGLE page, no pagination. Pagination + throttling retries was killing the Lambda budget
// and causing 502s. For AI summaries, the most recent 100 segments are enough context.
async function getTranscript(contactId: string): Promise<TranscriptSegment[]> {
  const segments: TranscriptSegment[] = [];
  const result = await contactLens.send(
    new ListRealtimeContactAnalysisSegmentsCommand({
      InstanceId: INSTANCE_ID,
      ContactId: contactId,
      MaxResults: 100,
    })
  );
  for (const s of result.Segments || []) {
    if (s.Transcript?.Content) {
      segments.push({
        // ParticipantRole is the canonical AGENT/CUSTOMER label.
        participant: s.Transcript.ParticipantRole || s.Transcript.ParticipantId || "UNKNOWN",
        content: s.Transcript.Content,
      });
    }
  }
  return segments;
}

function isThrottlingError(error: unknown): boolean {
  const errName =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  const errMsg = error instanceof Error ? error.message : String(error);
  return (
    errName === "ThrottlingException" ||
    errName === "TooManyRequestsException" ||
    /throttl|too many requests|rate exceeded/i.test(errMsg)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const body = JSON.parse(event.body || "{}");
  const { contactId, mode = "summary" } = body;
  // BYO Bedrock: resolvemos el Bedrock del tenant (su cuenta paga los tokens).
  // El frontend va authed → tenant del JWT; body.tenantId es override opcional.
  ({ client: bedrock } = await resolveBedrock(event?.headers, legacyBedrock, body?.tenantId));
  // Allow callers (e.g. the Agent Desktop ContactDetailModal viewing
  // historical contacts) to pre-supply the transcript text. The real-time
  // ContactLens API only works for live calls; for historical chats/voice
  // the frontend already fetched the transcript via get-contact-detail
  // and just needs us to summarize it.
  const inlineTranscript: string | undefined = body.transcript;
  // For mode="wrap-up-suggest": the frontend ships the active disposition
  // taxonomy so Claude can pick a stage/subStage from the SAME tree the
  // agent sees. Until the taxonomy moves to DynamoDB (roadmap #2), it
  // lives in the frontend, so passing it inline keeps the two in sync.
  const taxonomy: TaxonomyStage[] | undefined = Array.isArray(body.taxonomy)
    ? body.taxonomy
    : undefined;

  // ── mode="assistant" — the global Vox Copilot. A general platform helper:
  // answers how-to questions, drafts messages, explains features. No transcript.
  if (mode === "assistant") {
    const question: string = typeof body.question === "string" ? body.question : "";
    const history: Array<{ role: string; text: string }> = Array.isArray(body.history)
      ? body.history
      : [];
    if (!question.trim()) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "assistant", result: "" }),
      };
    }
    const convo = history
      .slice(-6)
      .map((h) => `${h.role === "user" ? "USUARIO" : "COPILOT"}: ${h.text}`)
      .join("\n");
    const sys = `Eres Vox Copilot, el asistente de Vox CRM — una plataforma de contact center sobre Amazon Connect para una institución educativa (UDEP). Ayudas a agentes y supervisores: explicas cómo usar Vox (campañas, leads, bots, tipificación, reportes, Agente IA), redactas mensajes para clientes y das consejos de atención. Responde en español, claro y breve (2-5 oraciones o una lista corta). Si te piden algo fuera de Vox/atención al cliente, redirige con amabilidad.`;
    const user = `${convo ? `Conversación previa:\n${convo}\n\n` : ""}USUARIO: ${question}\n\nResponde como Vox Copilot.`;
    try {
      const resp = await bedrock.send(
        new InvokeModelCommand({
          modelId: MODEL_ID,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 700,
            system: sys,
            messages: [{ role: "user", content: user }],
          }),
        })
      );
      const parsed = JSON.parse(new TextDecoder().decode(resp.body));
      const out = (parsed.content?.[0]?.text || "").trim();
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "assistant", result: out }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("assistant failed:", msg);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "assistant", result: "", degraded: true, error: msg }),
      };
    }
  }

  // ── mode="rewrite" — reword/retone the agent's draft message. Needs no
  // transcript, so we branch BEFORE the transcript validation below.
  if (mode === "rewrite") {
    const text: string = typeof body.text === "string" ? body.text : "";
    const tone: string = typeof body.tone === "string" ? body.tone : "profesional";
    if (!text.trim()) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "text required for rewrite" }),
      };
    }
    const TONE_GUIDE: Record<string, string> = {
      profesional: "tono profesional y cordial",
      amigable: "tono cálido y cercano, como hablándole a un amigo, sin perder respeto",
      conciso: "lo más breve y directo posible, sin rodeos",
      suavizar: "tono más suave y empático (el mensaje original suena brusco o negativo)",
      formal: "tono formal y respetuoso",
    };
    const guide = TONE_GUIDE[tone] || TONE_GUIDE.profesional;
    const rewritePrompt = `Eres un asistente que reescribe mensajes de agentes de contact center para clientes. Reescribe el siguiente mensaje con ${guide}. Mantén el idioma del original (español), conserva el significado y cualquier dato concreto (nombres, fechas, montos, links). Corrige ortografía y gramática. NO inventes información nueva.

Mensaje original:
${text}

Responde SOLO con el mensaje reescrito, sin comillas ni preámbulos.`;
    try {
      const resp = await bedrock.send(
        new InvokeModelCommand({
          modelId: MODEL_ID,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 600,
            messages: [{ role: "user", content: rewritePrompt }],
          }),
        })
      );
      const parsed = JSON.parse(new TextDecoder().decode(resp.body));
      const out = (parsed.content?.[0]?.text || "").trim();
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "rewrite", tone, result: out }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("rewrite failed:", msg);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "rewrite", tone, result: "", degraded: true, error: msg }),
      };
    }
  }

  // ── mode="suggest-replies" — propose 2-3 short replies the agent could
  // send next, from the recent conversation. No transcript fetch needed.
  if (mode === "suggest-replies") {
    const context: string = typeof body.context === "string" ? body.context : "";
    const customerName: string =
      typeof body.customerName === "string" ? body.customerName : "el cliente";
    if (!context.trim()) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "suggest-replies", result: [] }),
      };
    }
    const prompt = `Eres un asistente de un agente de contact center que atiende a ${customerName} por chat/WhatsApp. Basándote en la conversación reciente, sugiere 2 o 3 respuestas BREVES y útiles que el agente podría enviar AHORA. Cada una en español, tono cordial, lista para enviar (1-2 oraciones). No inventes datos concretos (precios, fechas) que no estén en la conversación — si hacen falta, deja un placeholder como [dato].

Conversación reciente (CLIENTE = el cliente, AGENTE = el agente):
${context}

Responde SOLO con un array JSON de strings, sin markdown ni texto extra. Ejemplo: ["Claro, con gusto te ayudo con eso.","¿Me confirmas tu número de documento para revisarlo?"]`;
    try {
      const resp = await bedrock.send(
        new InvokeModelCommand({
          modelId: MODEL_ID,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 500,
            messages: [{ role: "user", content: prompt }],
          }),
        })
      );
      const parsed = JSON.parse(new TextDecoder().decode(resp.body));
      let text = (parsed.content?.[0]?.text || "").trim();
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const s = text.indexOf("[");
      const e = text.lastIndexOf("]");
      let replies: string[] = [];
      if (s !== -1 && e > s) {
        try {
          const arr = JSON.parse(text.slice(s, e + 1));
          if (Array.isArray(arr)) {
            replies = arr.filter((x) => typeof x === "string" && x.trim()).slice(0, 3);
          }
        } catch {
          /* leave empty */
        }
      }
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "suggest-replies", result: replies }),
      };
    } catch (err) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "suggest-replies",
          result: [],
          degraded: true,
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  if (!contactId && !inlineTranscript) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId or transcript required" }),
    };
  }

  try {
    let segments: TranscriptSegment[];
    if (inlineTranscript && inlineTranscript.trim()) {
      // Parse a pre-formatted transcript ("AGENT: ...\nCUSTOMER: ...") OR
      // accept it as one big blob. We accept both because the front-end
      // already does the role tagging when building the payload.
      segments = inlineTranscript
        .split("\n")
        .map((line) => {
          const m = line.match(/^(AGENT|CUSTOMER|SYSTEM|UNKNOWN):\s?(.*)$/i);
          if (m) return { participant: m[1].toUpperCase(), content: m[2] };
          return { participant: "UNKNOWN", content: line };
        })
        .filter((s) => s.content && s.content.trim());
    } else {
      segments = await getTranscript(contactId);
    }
    if (segments.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: "No transcript available for this contact yet.",
        }),
      };
    }

    const transcript = segments
      .map((s) => `${s.participant}: ${s.content}`)
      .join("\n");

    const prompts = {
      summary: `Eres un asistente que resume llamadas de contact center. Resume la siguiente conversacion en 2-3 oraciones en español. Incluye: motivo de la llamada, resolucion (si la hubo), y sentimiento del cliente.

Transcripcion:
${transcript}

Responde SOLO con el resumen, sin preambulos.`,

      "next-action": `Eres un coach de agentes de contact center. Tu trabajo es ayudar al agente DURANTE la llamada con bloques de UI accionables. NO eres un resumen — eres una guia interactiva.

Devuelve un objeto JSON: { "blocks": [...] } con 2 a 5 bloques. Elegi los tipos que mas valor agregan ahora mismo segun la conversacion.

TIPOS DE BLOQUE DISPONIBLES (usa la mezcla que te parezca util, NO uses todos siempre):

1. action — Una accion concreta que el agente puede ejecutar con un boton.
   { "type": "action", "title": "Texto corto imperativo", "reason": "Por que (max 15 palabras)", "cta": { "label": "Boton", "kind": "schedule_callback"|"send_template"|"transfer"|"note"|"none", "payload": { ... } } }
   - kind "schedule_callback": payload { "whenMinutes": 30, "channel": "voice"|"whatsapp"|"email", "reason": "..." }
   - kind "send_template": payload { "templateName": "udep_admision_emoji", "language": "es" }
   - kind "transfer": payload { "queue": "Supervisor"|"Soporte"|"Ventas" }
   - kind "note": payload { "text": "Lo que se anotara en las notas del contacto" }
   - kind "none": sin payload, el boton solo confirma visualmente

2. script — Texto verbatim para que el agente lea al cliente. Tiene boton "Copiar".
   { "type": "script", "title": "Cuando usar (opcional, max 6 palabras)", "text": "El texto exacto a leer, en primera persona, tono profesional" }

3. checklist — Lista de items a verificar con el cliente. Cada uno es un checkbox.
   { "type": "checklist", "title": "Verificar identidad", "items": ["Nombre completo", "DNI", "Email de contacto"] }

4. callout — Destacado informativo. Tono determina color.
   { "type": "callout", "tone": "info"|"warn"|"success"|"error", "text": "Texto corto, max 25 palabras" }

5. table — Tabla comparativa o de referencia.
   { "type": "table", "title": "Planes que califica", "columns": ["Plan", "Precio", "Beneficio"], "rows": [["Basico","$19","2GB"],["Pro","$39","10GB"]] }
   - Max 4 columnas, max 5 filas.

6. form — Captura datos estructurados durante la llamada. Al enviar, se guardan en las notas.
   { "type": "form", "title": "Nueva direccion del cliente", "fields": [{ "name": "calle", "label": "Calle y numero", "type": "text" }, { "name": "ciudad", "label": "Ciudad", "type": "text" }, { "name": "motivo", "label": "Motivo del cambio", "type": "textarea" }], "submitLabel": "Guardar en notas" }
   - field.type: "text" | "textarea" | "number" | "email" | "select"
   - Si type es "select", incluir "options": ["A", "B"]
   - Max 5 fields.

REGLAS ESTRICTAS DE OUTPUT:
- Responde SOLO con el objeto JSON { "blocks": [...] }
- NADA de markdown, NADA de \`\`\`json fences, NADA de texto antes o despues.
- Empieza el output con { y terminalo con }.
- 2 a 5 bloques. Mezcla tipos segun el momento de la llamada.

EJEMPLO de output valido:
{"blocks":[{"type":"callout","tone":"warn","text":"Cliente menciono cancelacion — manejar con prioridad de retencion."},{"type":"script","title":"Apertura de retencion","text":"Entiendo tu preocupacion. Antes de procesar, quiero ofrecerte una opcion que muchos clientes en tu situacion eligieron."},{"type":"action","title":"Programar callback con supervisor","reason":"Caso requiere autorizacion superior","cta":{"label":"Programar","kind":"schedule_callback","payload":{"whenMinutes":60,"channel":"voice","reason":"Escalamiento retencion"}}},{"type":"checklist","title":"Antes de cerrar","items":["Confirmar datos de contacto actualizados","Ofrecer descuento de retencion 20%","Resumir proximos pasos al cliente"]}]}

Transcripcion:
${transcript}`,

      "wrap-up": `Eres un asistente que categoriza llamadas. Sugiere UN codigo de disposition corto (1-3 palabras) que describa el resultado de esta conversacion. Ejemplos: "Queja resuelta", "Info provista", "Transferido a soporte", "Reembolso procesado".

Transcripcion:
${transcript}

Responde SOLO con el codigo, sin explicacion.`,
    };

    // wrap-up-suggest builds its prompt at runtime from the taxonomy the
    // frontend shipped. If no taxonomy was passed we can't suggest, so we
    // fall back to a soft no-op (frontend just shows nothing).
    let prompt: string;
    if (mode === "wrap-up-suggest") {
      if (!taxonomy || taxonomy.length === 0) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId,
            mode,
            result: "",
            note: "no taxonomy provided",
          }),
        };
      }
      prompt = buildWrapUpSuggestPrompt(taxonomy, transcript);
    } else {
      prompt = prompts[mode as keyof typeof prompts] || prompts.summary;
    }

    const response = await bedrock.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      })
    );

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.content?.[0]?.text || "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        mode,
        result: text.trim(),
        transcriptLength: segments.length,
      }),
    };
  } catch (error) {
    // Always return 200 with a soft-degraded body so the frontend doesn't
    // flood the browser console with 5xx noise. Real failure modes that
    // we degrade gracefully here:
    //  - ThrottlingException        → Bedrock or Contact Lens rate limit
    //  - AccessDeniedException      → Bedrock model not subscribed in the account
    //  - ResourceNotFoundException  → contactId is from a different region
    //                                 or doesn't have a Contact Lens record yet
    //                                 (very common for CHAT contacts without
    //                                 real-time analytics)
    //  - any other Bedrock error    → graceful fallback
    const errName =
      error && typeof error === "object" && "name" in error
        ? String((error as { name: unknown }).name)
        : "UnknownError";
    const errMsg = error instanceof Error ? error.message : String(error);

    console.warn("generate-call-summary degraded:", errName, errMsg);

    let fallback = "";
    if (isThrottlingError(error)) {
      fallback = ""; // AICoachPanel keeps previous suggestions
    } else if (errName === "AccessDeniedException") {
      fallback =
        "Resumen automático no disponible (modelo de IA aún no habilitado en la cuenta).";
    } else if (
      errName === "ResourceNotFoundException" ||
      /no.*transcript|not.*found/i.test(errMsg)
    ) {
      fallback = "Aún no hay transcripción disponible para este contacto.";
    } else {
      fallback =
        "Resumen automático no disponible en este momento. Puedes redactarlo manualmente.";
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        mode,
        degraded: true,
        errorClass: errName,
        result: mode === "next-action" ? "[]" : "",
        summary: fallback,
        transcriptLength: 0,
      }),
    };
  }
};
