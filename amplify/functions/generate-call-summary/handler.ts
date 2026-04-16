import type { Handler } from "aws-lambda";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  ConnectContactLensClient,
  ListRealtimeContactAnalysisSegmentsCommand,
} from "@aws-sdk/client-connect-contact-lens";

const bedrock = new BedrockRuntimeClient({});
const contactLens = new ConnectContactLensClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  "anthropic.claude-3-5-haiku-20241022-v1:0";

interface TranscriptSegment {
  participant: string;
  content: string;
}

async function getTranscript(contactId: string): Promise<TranscriptSegment[]> {
  const segments: TranscriptSegment[] = [];
  let nextToken: string | undefined;
  do {
    const result = await contactLens.send(
      new ListRealtimeContactAnalysisSegmentsCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId,
        NextToken: nextToken,
        MaxResults: 100,
      })
    );
    for (const s of result.Segments || []) {
      if (s.Transcript?.Content) {
        segments.push({
          participant: s.Transcript.ParticipantId || "UNKNOWN",
          content: s.Transcript.Content,
        });
      }
    }
    nextToken = result.NextToken;
  } while (nextToken);
  return segments;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const body = JSON.parse(event.body || "{}");
  const { contactId, mode = "summary" } = body;

  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId required" }),
    };
  }

  try {
    const segments = await getTranscript(contactId);
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

      "next-action": `Eres un asistente de agentes de contact center. Analiza la conversacion y sugiere las 3 mejores siguientes acciones que deberia tomar el agente. Responde en formato JSON: [{"action": "...", "reason": "..."}]

Transcripcion:
${transcript}`,

      "wrap-up": `Eres un asistente que categoriza llamadas. Sugiere UN codigo de disposition corto (1-3 palabras) que describa el resultado de esta conversacion. Ejemplos: "Queja resuelta", "Info provista", "Transferido a soporte", "Reembolso procesado".

Transcripcion:
${transcript}

Responde SOLO con el codigo, sin explicacion.`,
    };

    const prompt = prompts[mode as keyof typeof prompts] || prompts.summary;

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
    console.error("Error generating summary:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to generate summary",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
