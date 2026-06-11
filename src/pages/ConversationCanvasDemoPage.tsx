import { ConversationCanvas, type CanvasContact } from "@/components/recordings/ConversationCanvas";
import { Card, CardBody } from "@/components/vox/primitives";
import type { ContactDetail } from "@/hooks/useContactDetail";

/**
 * /canvas-demo — auth-free preview of the ConversationCanvas (unified
 * omnichannel thread). DEV only (gated in App.tsx). Uses ConversationCanvas's
 * `demo` escape hatch with mock voice / WhatsApp / email contacts so it renders
 * without a Connect backend.
 */

// — Helpers to keep the mock ContactDetail objects compact —
type Seg = ContactDetail["transcript"] extends infer T
  ? T extends { segments: infer S }
    ? S extends Array<infer U>
      ? U
      : never
    : never
  : never;

function voiceSeg(participant: "AGENT" | "CUSTOMER", content: string, begin: number, end: number, sentiment: string): Seg {
  return { type: "transcript", participant, content, beginOffsetMs: begin, endOffsetMs: end, sentiment } as Seg;
}
function chatMsg(participant: "AGENT" | "CUSTOMER", content: string, timestamp: string): Seg {
  return { type: "message", participant, content, timestamp, beginOffsetMs: 0, endOffsetMs: 0 } as Seg;
}

function detail(partial: Partial<ContactDetail> & Pick<ContactDetail, "contactId" | "channel">): ContactDetail {
  return {
    initiationTimestamp: "",
    disconnectTimestamp: "",
    duration: 0,
    agentUsername: "andrea.soporte",
    queueName: "Soporte",
    attributes: {},
    recording: null,
    transcript: null,
    attachments: [],
    wrapUp: null,
    ...partial,
  } as ContactDetail;
}

const VOICE1 = "demo-voice-1";
const CHAT1 = "demo-chat-1";
const EMAIL1 = "demo-email-1";
const VOICE2 = "demo-voice-2";

const contacts: CanvasContact[] = [
  { contactId: VOICE1, channel: "VOICE", initiationTimestamp: "2026-06-10T15:20:00Z", duration: 96, agentUsername: "andrea.soporte", hasRecording: true },
  { contactId: CHAT1, channel: "CHAT", initiationTimestamp: "2026-06-08T11:30:00Z", duration: 0, agentUsername: "luis.ventas" },
  { contactId: EMAIL1, channel: "EMAIL", initiationTimestamp: "2026-06-03T09:15:00Z", duration: 0, agentUsername: "soporte" },
  { contactId: VOICE2, channel: "VOICE", initiationTimestamp: "2026-05-20T16:40:00Z", duration: 41, agentUsername: "andrea.soporte", hasRecording: true },
];

const details: Record<string, ContactDetail> = {
  [VOICE1]: detail({
    contactId: VOICE1,
    channel: "VOICE",
    initiationTimestamp: "2026-06-10T15:20:00Z",
    duration: 96,
    recording: { url: "", expiresAt: "" },
    transcript: {
      source: "contact-lens-s3",
      overallSentiment: "POSITIVE",
      segments: [
        voiceSeg("AGENT", "Soporte Novasys, buenas tardes. ¿En qué le ayudo?", 1000, 6000, "NEUTRAL"),
        voiceSeg("CUSTOMER", "Hola, mi internet no funciona desde anoche y trabajo desde casa, ya es el colmo.", 7000, 16000, "NEGATIVE"),
        voiceSeg("AGENT", "Lamento muchísimo el inconveniente. Déjeme revisar su línea ahora mismo.", 17000, 24000, "NEUTRAL"),
        voiceSeg("CUSTOMER", "Por favor, porque ya perdí una reunión importante.", 25000, 31000, "NEGATIVE"),
        voiceSeg("AGENT", "Veo una caída en su zona que ya está resuelta. Voy a reiniciar su señal de forma remota.", 32000, 42000, "NEUTRAL"),
        voiceSeg("CUSTOMER", "Ah, a ver… sí, ya empezó a cargar. Qué alivio.", 43000, 50000, "POSITIVE"),
        voiceSeg("AGENT", "Perfecto. Además le aplico un descuento por las molestias en su próxima factura.", 51000, 60000, "POSITIVE"),
        voiceSeg("CUSTOMER", "Muchísimas gracias, súper amable. Excelente atención.", 61000, 68000, "POSITIVE"),
      ],
    },
    wrapUp: {
      notes: "Caída de zona, ya resuelta. Reinicio remoto OK. Aplicado descuento por molestias.",
      summary: "Cliente reportó caída de internet desde la noche anterior (molesto, perdió una reunión). Se identificó una caída de zona ya resuelta; se reinició la señal remotamente y el servicio se restableció en la llamada. Se aplicó un descuento por las molestias. Cliente terminó satisfecho.",
      stage: "resuelto",
      stageLabel: "Resuelto",
      subStage: "fcr",
      subStageLabel: "Resuelto en primer contacto",
      valoracion: "caliente",
      tags: ["FCR", "Soporte L1"],
      followUps: {},
      followUpTaskIds: [],
      agentUsername: "andrea.soporte",
      updatedAt: "2026-06-10T15:22:00Z",
    },
  }),
  [CHAT1]: detail({
    contactId: CHAT1,
    channel: "CHAT",
    subChannel: "messaging-whatsapp",
    initiationTimestamp: "2026-06-08T11:30:00Z",
    agentUsername: "luis.ventas",
    queueName: "Ventas",
    transcript: {
      source: "chat-s3",
      segments: [
        chatMsg("CUSTOMER", "Hola! Vi su promo de fibra de 500 megas, ¿sigue disponible?", "2026-06-08T11:30:05Z"),
        chatMsg("AGENT", "¡Hola! Sí, sigue vigente esta semana. ¿Para qué distrito sería la instalación?", "2026-06-08T11:31:10Z"),
        chatMsg("CUSTOMER", "Para Miraflores. ¿Cuánto sale al mes?", "2026-06-08T11:32:00Z"),
        chatMsg("AGENT", "En Miraflores tenemos cobertura. El plan de 500 megas queda en S/ 99 mensuales con instalación gratis. 🙌", "2026-06-08T11:33:20Z"),
        chatMsg("CUSTOMER", "Me interesa, ¿cómo agendo?", "2026-06-08T11:34:05Z"),
        chatMsg("AGENT", "Le mando el formulario para reservar su visita técnica. ✅", "2026-06-08T11:34:40Z"),
      ],
    },
    wrapUp: {
      notes: "Interesado en fibra 500 megas, Miraflores. Enviado formulario de visita.",
      summary: "Cliente consultó por la promo de fibra de 500 megas para Miraflores. Se confirmó cobertura y precio (S/ 99/mes, instalación gratis). Mostró interés y se le envió el formulario para agendar la visita técnica.",
      stage: "interesado",
      stageLabel: "Interesado",
      subStage: "agendar",
      subStageLabel: "Por agendar visita",
      valoracion: "muy_caliente",
      tags: ["Ventas", "Fibra"],
      followUps: {},
      followUpTaskIds: [],
      agentUsername: "luis.ventas",
      updatedAt: "2026-06-08T11:35:00Z",
    },
  }),
  [EMAIL1]: detail({
    contactId: EMAIL1,
    channel: "EMAIL",
    initiationTimestamp: "2026-06-03T09:15:00Z",
    agentUsername: "soporte",
    queueName: "Soporte",
    attributes: { email_subject: "Reembolso por días sin servicio — solicitud" },
    transcript: {
      source: "email",
      segments: [
        chatMsg("CUSTOMER", "Estimados, estuve sin servicio 3 días la semana pasada. Solicito el reembolso proporcional según el contrato. Adjunto el detalle. Saludos, María.", "2026-06-03T09:15:00Z"),
      ],
    },
    attachments: [{ fileId: "f1", fileName: "detalle-dias-sin-servicio.pdf", url: null, fileStatus: "AVAILABLE" }],
  }),
  [VOICE2]: detail({
    contactId: VOICE2,
    channel: "VOICE",
    initiationTimestamp: "2026-05-20T16:40:00Z",
    duration: 41,
    recording: { url: "", expiresAt: "" },
    transcript: {
      source: "contact-lens-s3",
      overallSentiment: "NEUTRAL",
      segments: [
        voiceSeg("AGENT", "Soporte Novasys, ¿en qué le ayudo?", 1000, 5000, "NEUTRAL"),
        voiceSeg("CUSTOMER", "Quería confirmar mi fecha de pago de este mes.", 6000, 12000, "NEUTRAL"),
        voiceSeg("AGENT", "Claro, su fecha de corte es el 28. ¿Algo más?", 13000, 19000, "NEUTRAL"),
        voiceSeg("CUSTOMER", "No, eso era todo. Gracias.", 20000, 24000, "POSITIVE"),
      ],
    },
  }),
};

export function ConversationCanvasDemoPage() {
  return (
    <div style={{ height: "100vh", overflow: "auto", background: "var(--bg-0)" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
        <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
          ConversationCanvas · preview de diseño (datos mock)
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 18px", color: "var(--text-1)" }}>
          Hilo omnicanal del cliente
        </h1>
        <Card>
          <CardBody>
            <ConversationCanvas
              phone="+51 987 654 321"
              name="María Quispe"
              demo={{ contacts, details }}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
