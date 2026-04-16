"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// amplify/functions/generate-call-summary/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_bedrock_runtime = require("@aws-sdk/client-bedrock-runtime");
var import_client_connect_contact_lens = require("@aws-sdk/client-connect-contact-lens");
var bedrock = new import_client_bedrock_runtime.BedrockRuntimeClient({ maxAttempts: 1 });
var contactLens = new import_client_connect_contact_lens.ConnectContactLensClient({ maxAttempts: 1 });
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-3-5-haiku-20241022-v1:0";
async function getTranscript(contactId) {
  const segments = [];
  const result = await contactLens.send(
    new import_client_connect_contact_lens.ListRealtimeContactAnalysisSegmentsCommand({
      InstanceId: INSTANCE_ID,
      ContactId: contactId,
      MaxResults: 100
    })
  );
  for (const s of result.Segments || []) {
    if (s.Transcript?.Content) {
      segments.push({
        // ParticipantRole is the canonical AGENT/CUSTOMER label.
        participant: s.Transcript.ParticipantRole || s.Transcript.ParticipantId || "UNKNOWN",
        content: s.Transcript.Content
      });
    }
  }
  return segments;
}
function isThrottlingError(error) {
  const errName = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const errMsg = error instanceof Error ? error.message : String(error);
  return errName === "ThrottlingException" || errName === "TooManyRequestsException" || /throttl|too many requests|rate exceeded/i.test(errMsg);
}
var handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const { contactId, mode = "summary" } = body;
  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId required" })
    };
  }
  try {
    const segments = await getTranscript(contactId);
    if (segments.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: "No transcript available for this contact yet."
        })
      };
    }
    const transcript = segments.map((s) => `${s.participant}: ${s.content}`).join("\n");
    const prompts = {
      summary: `Eres un asistente que resume llamadas de contact center. Resume la siguiente conversacion en 2-3 oraciones en espa\xF1ol. Incluye: motivo de la llamada, resolucion (si la hubo), y sentimiento del cliente.

Transcripcion:
${transcript}

Responde SOLO con el resumen, sin preambulos.`,
      "next-action": `Eres un asistente de agentes de contact center. Analiza la conversacion y sugiere las 3 mejores siguientes acciones que deberia tomar el agente. Responde en formato JSON: [{"action": "...", "reason": "..."}]

Transcripcion:
${transcript}`,
      "wrap-up": `Eres un asistente que categoriza llamadas. Sugiere UN codigo de disposition corto (1-3 palabras) que describa el resultado de esta conversacion. Ejemplos: "Queja resuelta", "Info provista", "Transferido a soporte", "Reembolso procesado".

Transcripcion:
${transcript}

Responde SOLO con el codigo, sin explicacion.`
    };
    const prompt = prompts[mode] || prompts.summary;
    const response = await bedrock.send(
      new import_client_bedrock_runtime.InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
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
        transcriptLength: segments.length
      })
    };
  } catch (error) {
    if (isThrottlingError(error)) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          mode,
          throttled: true,
          result: mode === "next-action" ? "[]" : "",
          transcriptLength: 0
        })
      };
    }
    console.error("Error generating summary:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to generate summary",
        message: error instanceof Error ? error.message : "Unknown error"
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
