import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChannelChip } from "@/components/vox/primitives";
import { Av, Btn, Icon, Pill } from "@/components/aria";
import { useCCP } from "@/hooks/useCCP";
import {
  useConversation,
  useConversationActions,
  type ConvMessage,
} from "@/hooks/useConversations";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useUsers } from "@/hooks/useUsers";
import { chipType, CH_LABEL } from "./channelMeta";
import { ConversationTypifyModal } from "./ConversationTypifyModal";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ts del ÚLTIMO mensaje entrante (del cliente) — ancla de la ventana de 24h de
 *  Meta. Función fuera del componente para no chocar con el gate del React
 *  Compiler (nada de useMemo con for-return). */
function lastInboundTs(msgs: ConvMessage[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].direction === "in") return msgs[i].ts;
  }
  return undefined;
}

/** Nombre legible de un agente para el selector de traspaso. */
function agentLabel(u: {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
}): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.username || u.email || "Agente";
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Plantilla HSM de WhatsApp (shape laxo de list-whatsapp-templates). */
type WaTemplate = {
  name: string;
  language?: string;
  status?: string;
  category?: string;
  body?: string;
  bodyText?: string;
};

/** Respuestas rápidas (canned) — al hacer click rellenan el textarea. */
const QUICK_REPLIES = [
  "¡Gracias por escribir! 🙌",
  "Te comparto el brochure del programa.",
  "¿Agendamos una llamada?",
];

/** Adjunto del mensaje renderizado INLINE según su tipo: imagen visible,
 *  audio/video con reproductor, y documento/pdf como tarjeta descargable.
 *  El backend ya entrega `{ type, url }` para el media entrante (WhatsApp/
 *  Instagram/Messenger). */
function AttachmentView({
  att,
  out,
  hasText,
}: {
  att: { type: string; url: string };
  out: boolean;
  hasText: boolean;
}) {
  const t = (att.type || "").toLowerCase();
  const url = att.url;
  const isImage = t.includes("image") || /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(url);
  const isAudio =
    t.includes("audio") || t.includes("voice") || /\.(mp3|ogg|m4a|wav|opus|aac)(\?|$)/i.test(url);
  const isVideo = t.includes("video") || /\.(mp4|webm|mov|3gp)(\?|$)/i.test(url);
  const mb = hasText ? 6 : 0;

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{ display: "block", marginBottom: mb }}>
        <img
          src={url}
          alt="Imagen adjunta"
          style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 10, display: "block" }}
        />
      </a>
    );
  }
  if (isAudio) {
    return (
      <audio controls src={url} style={{ width: 250, maxWidth: "100%", marginBottom: mb, display: "block" }} />
    );
  }
  if (isVideo) {
    return (
      <video
        controls
        src={url}
        style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 10, marginBottom: mb, display: "block" }}
      />
    );
  }
  // Documento / PDF / otro → tarjeta descargable.
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: mb,
        padding: "8px 10px",
        borderRadius: 10,
        background: out ? "rgba(255,255,255,.18)" : "var(--bg-2)",
        border: "1px solid " + (out ? "rgba(255,255,255,.28)" : "var(--border-1)"),
        color: out ? "var(--accent-ink)" : "var(--text-1)",
        textDecoration: "none",
        fontSize: 12.5,
        fontWeight: 600,
        maxWidth: 240,
      }}
    >
      <Icon name="fileText" size={16} />
      <span className="grow trunc">{att.type || "Documento"}</span>
      <Icon name="download" size={13} />
    </a>
  );
}

function Bubble({ m }: { m: ConvMessage }) {
  const out = m.direction === "out";
  return (
    <div className={"msg " + (out ? "msg--out" : "msg--in")}>
      {m.attachment?.url && (
        <AttachmentView att={m.attachment} out={out} hasText={!!m.text} />
      )}
      {m.text && (
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</div>
      )}
      <div className="msg__time" style={{ textAlign: "right" }}>
        {m.agent ? `${m.agent} · ` : ""}
        {fmtTime(m.ts)}
        {/* Visto — el cliente leyó este mensaje saliente (read receipt de Meta). */}
        {out && m.readAt && (
          <span
            title={`Visto · ${fmtTime(m.readAt)}`}
            style={{ marginLeft: 5, color: "var(--cyan)", fontWeight: 700, letterSpacing: "-1px" }}
          >
            ✓✓
          </span>
        )}
      </div>
    </div>
  );
}

const LIST_INP: React.CSSProperties = {
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-2)",
  background: "var(--bg-2)",
  color: "var(--text-1)",
};

export function ConversationThread({ conversationId }: { conversationId: string }) {
  const { conversation, loading } = useConversation(conversationId);
  const { reply, replyComment, commentToDm, markRead, close, sendList, sendMedia, sendTemplate, assign, assignTo, release } =
    useConversationActions();
  const { placeCall, agentState } = useCCP();
  const { user } = useConnectAuth();
  const { users } = useUsers();
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [typifyOpen, setTypifyOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [listHeader, setListHeader] = useState("");
  const [listBody, setListBody] = useState("");
  const [listButton, setListButton] = useState("Ver opciones");
  const [listRows, setListRows] = useState<{ title: string; description: string }[]>([
    { title: "", description: "" },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const msgs = conversation?.messages ?? [];
  const isComment = conversation?.channel === "fb_comment";
  const isWhatsApp = conversation?.channel === "whatsapp";

  // Fase 4 · F4.2a — enviar un LIST interactivo (menú tappable) por WhatsApp.
  const sendListNow = async () => {
    const rows = listRows
      .filter((r) => r.title.trim())
      .map((r, i) => ({
        id: `opt_${i}`,
        title: r.title.trim(),
        description: r.description.trim() || undefined,
      }));
    if (!listBody.trim() || !rows.length) {
      toast.error("Poné un texto y al menos una opción con título");
      return;
    }
    try {
      await sendList.mutateAsync({
        conversationId,
        header: listHeader.trim() || undefined,
        body: listBody.trim(),
        button: listButton.trim() || undefined,
        rows,
      });
      setListOpen(false);
      setListHeader("");
      setListBody("");
      setListRows([{ title: "", description: "" }]);
      toast.success("Lista enviada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar la lista");
    }
  };

  // Adjuntar archivo (imagen / PDF / audio / video): sube a S3 vía
  // uploadConversationMedia (presigned PUT) y lo envía al cliente por sendMedia.
  // Degrada honesto si el backend aún no está desplegado.
  const handleAttach = async (file: File) => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.uploadConversationMedia) {
      toast.error("El envío de archivos requiere desplegar el backend del inbox.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      toast.error("El archivo supera el límite de 16 MB.");
      return;
    }
    setUploading(true);
    try {
      const pre = await authedFetch(endpoints.uploadConversationMedia, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!pre.ok) throw new Error(`Upload HTTP ${pre.status}`);
      const { uploadUrl, publicUrl } = await pre.json();
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("No se pudo subir el archivo");
      const mediaType = file.type.startsWith("image")
        ? "image"
        : file.type.startsWith("audio")
        ? "audio"
        : file.type.startsWith("video")
        ? "video"
        : "document";
      await sendMedia.mutateAsync({
        conversationId,
        mediaUrl: publicUrl,
        mediaType,
        filename: file.name,
      });
      toast.success("Archivo enviado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar el archivo");
    } finally {
      setUploading(false);
    }
  };

  // Plantillas HSM de WhatsApp — carga las aprobadas (reusa list-whatsapp-
  // templates de la sección Plantillas) y las envía por sendTemplate.
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  useEffect(() => {
    if (!tplOpen) return;
    const ep = getApiEndpoints();
    if (!ep?.listWhatsAppTemplates) {
      setTemplates([]);
      return;
    }
    setTplLoading(true);
    authedFetch(`${ep.listWhatsAppTemplates}?includeAll=true`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.templates || d.data || d.items || []) as WaTemplate[];
        setTemplates(list.filter((t) => (t.status || "APPROVED").toUpperCase() === "APPROVED"));
      })
      .catch(() => setTemplates([]))
      .finally(() => setTplLoading(false));
  }, [tplOpen]);
  const sendTpl = async (t: WaTemplate) => {
    try {
      await sendTemplate.mutateAsync({
        conversationId,
        templateName: t.name,
        language: t.language || "es",
      });
      setTplOpen(false);
      toast.success("Plantilla enviada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar la plantilla");
    }
  };

  // Cerrar la conversación enviando una encuesta CSAT rápida antes de cerrar.
  const closeWithSurvey = () => {
    close.mutate({
      conversationId,
      survey: {
        body: "¿Cómo calificarías la atención que recibiste hoy?",
        options: ["😀 Excelente", "🙂 Buena", "😐 Regular", "🙁 Mala"],
      },
    });
    setMenuOpen(false);
  };

  // Marcar leída al abrir (si tiene no-leídas). markRead invalida la lista.
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (conversation && conversation.unread > 0 && markedRef.current !== conversationId) {
      markedRef.current = conversationId;
      markRead.mutate(conversationId);
    }
  }, [conversation, conversationId, markRead]);

  // Auto-scroll al fondo cuando cambian los mensajes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, conversationId]);

  // DM directo (IG/Messenger) — Enter o botón Enviar.
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    try {
      await reply.mutateAsync({ conversationId, text: t });
    } catch (e) {
      setText(t); // restaurar para reintentar
      const msg = e instanceof Error ? e.message : "No se pudo enviar";
      toast.error(
        msg === "conversation_closed"
          ? "La conversación está cerrada. Enviá una plantilla para reabrirla."
          : msg === "owned_by_other"
            ? "Este chat lo tomó otro agente. Pedí que te lo traspasen para responder."
            : msg,
      );
    }
  };

  // Comentarios (Fase B): responder en público o pasar a privado.
  const runComment = async (kind: "public" | "dm") => {
    const t = text.trim();
    if (!t) return;
    const m = kind === "public" ? replyComment : commentToDm;
    setText("");
    try {
      await m.mutateAsync({ conversationId, text: t });
      toast.success(kind === "public" ? "Respondido en público" : "Pasado a privado (DM)");
    } catch (e) {
      setText(t);
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    }
  };

  // "Llamar" desde el hilo → softphone (Amazon Connect), como en el embudo de Leads.
  const callContact = async () => {
    const phone = conversation?.phone?.trim();
    if (!phone) {
      toast.error("Este contacto no tiene teléfono para llamar");
      return;
    }
    if (agentState === "Offline" || agentState === "Init") {
      toast.error("Conecta tu softphone para llamar (cambia a Available)");
      return;
    }
    try {
      await placeCall(phone);
      toast.success(`Llamando a ${phone}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo iniciar la llamada");
    }
  };

  if (!conversation && loading) {
    return (
      <div className="dim" style={{ margin: "auto", padding: 24, fontSize: 13 }}>
        Cargando conversación…
      </div>
    );
  }
  if (!conversation) {
    return (
      <div className="dim" style={{ margin: "auto", padding: 24, fontSize: 13 }}>
        Conversación no encontrada.
      </div>
    );
  }

  const name = conversation.customerName || conversation.senderId;
  const closed = conversation.status === "closed";
  const assignee = conversation.assignee;
  const myEmail = user?.email || user?.userId || "";
  const owner = conversation.ownerAgentId;
  const isMine = !!owner && owner.toLowerCase() === myEmail.toLowerCase();
  const isPrivileged = user?.highestRole === "Admins" || user?.highestRole === "Supervisors";
  // Estado visible del chat: Bot IA → (En cola / Tuya / dueño) → Cerrado. Cuando
  // la atiende un humano mostramos de quién es (ownership).
  const stateLabel = closed
    ? "Cerrado"
    : assignee === "bot"
      ? "Bot IA"
      : !owner
        ? "En cola"
        : isMine
          ? "Tuya"
          : conversation.ownerAgentName || "Agente";
  const stateTone: "green" | "iris" | "outline" | "cyan" = closed
    ? "outline"
    : assignee === "bot"
      ? "iris"
      : !owner
        ? "cyan"
        : "green";
  // ¿Puedo operar este chat? El dueño, un chat sin dueño, o un privilegiado.
  const canOperate = !owner || isMine || isPrivileged;
  // Agentes a los que se puede traspasar (con email, distintos de mí y del dueño).
  // Comparación case-insensitive: el email del token y el del directorio pueden
  // diferir en mayúsculas (p.ej. Anedre… vs anedre…).
  const myEmailLc = myEmail.toLowerCase();
  const ownerLc = (owner || "").toLowerCase();
  const agentsToShow = users.filter((u) => {
    const e = (u.email || "").toLowerCase();
    return e && e !== myEmailLc && e !== ownerLc;
  });
  const doTransfer = async (u: {
    email?: string;
    firstName?: string;
    lastName?: string;
    username?: string;
  }) => {
    if (!u.email) return;
    try {
      await assignTo.mutateAsync({ conversationId, agentId: u.email, agentName: agentLabel(u) });
      setTransferOpen(false);
      toast.success(`Traspasado a ${agentLabel(u)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo traspasar");
    }
  };
  const isDM = conversation.channel === "instagram" || conversation.channel === "messenger";
  // Ventana de 24h de Meta (WhatsApp): sin inbound del cliente en las últimas
  // 24h solo se pueden enviar PLANTILLAS HSM. Fuera de ventana o cerrada → el
  // composer se limita a plantillas (de promoción).
  const lastIn = lastInboundTs(msgs);
  const within24h = lastIn ? Date.now() - new Date(lastIn).getTime() < DAY_MS : false;
  const templatesOnly = isWhatsApp && (closed || !within24h);
  // IG/Messenger cerrado no tiene plantillas HSM → bloqueado hasta que el
  // cliente reabra (regla de negocio: "solo se reabre cuando el cliente escribe").
  const closedBlocked = isDM && closed;
  // "Escribiendo…" — typing entrante (IG/Messenger; WhatsApp no lo emite). El
  // poll de useConversation lo refresca; expira solo cuando pasa typingUntil.
  const isTyping =
    !!conversation.typingUntil &&
    new Date(conversation.typingUntil).getTime() > Date.now();
  const channelLine = `${CH_LABEL[conversation.channel] || conversation.channel}${
    conversation.ml ? ` · ${conversation.ml.kind === "question" ? "Pregunta" : "Post-venta"}` : ""
  }`;

  return (
    <>
      {/* Header del hilo */}
      <div
        className="row between"
        style={{
          gap: 12,
          padding: "12px 20px",
          borderBottom: "1px solid var(--border-1)",
          background: "var(--bg-1)",
          flex: "0 0 auto",
        }}
      >
        <div className="row gap12" style={{ minWidth: 0 }}>
          <span style={{ position: "relative", flex: "0 0 auto" }}>
            <Av name={name} size={40} radius={12} />
            <span
              style={{
                position: "absolute",
                right: -3,
                bottom: -3,
                transform: "scale(0.72)",
                transformOrigin: "bottom right",
              }}
            >
              <ChannelChip type={chipType(conversation.channel)} />
            </span>
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="trunc" style={{ fontWeight: 750, fontSize: 15 }}>
              {name}
            </div>
            <div className="row gap6" style={{ fontSize: 12, color: "var(--text-3)", alignItems: "center", minWidth: 0 }}>
              <Pill tone={stateTone}>{stateLabel}</Pill>
              <span className="trunc">{channelLine}</span>
            </div>
          </div>
        </div>

        <div className="row gap6" style={{ flex: "0 0 auto", position: "relative" }}>
          <Btn
            variant="ghost"
            size="sm"
            icon="phone"
            onClick={callContact}
            disabled={!conversation.phone}
            title={conversation.phone ? `Llamar a ${conversation.phone}` : "Sin teléfono para llamar"}
          />
          <Btn
            variant="ghost"
            size="sm"
            icon="sparkle"
            onClick={() => toast("El resumen con IA de esta conversación llega pronto.")}
            title="Resumen con IA"
          >
            Resumen IA
          </Btn>
          <Btn
            variant="ghost"
            size="sm"
            icon="more"
            title="Más acciones"
            onClick={() => setMenuOpen((v) => !v)}
          />
          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 90 }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 100,
                  minWidth: 200,
                  background: "var(--bg-1)",
                  border: "1px solid var(--border-2)",
                  borderRadius: "var(--r-lg, 12px)",
                  boxShadow: "var(--sh-4)",
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {/* Ownership: tomar (del bot o de la cola) / devolver / traspasar / soltar */}
                {!closed && !isMine && (assignee === "bot" || !owner || isPrivileged) && (
                  <button
                    type="button"
                    className="row gap8"
                    onClick={() => {
                      setMenuOpen(false);
                      assign.mutate({ conversationId, assignee: "agent" });
                      toast.success("Tomaste el chat — ahora lo atendés vos");
                    }}
                    style={menuItemStyle}
                  >
                    <Icon name="chat" size={15} /> Tomar el chat
                  </button>
                )}
                {!closed && assignee === "agent" && (isMine || isPrivileged) && (
                  <button
                    type="button"
                    className="row gap8"
                    onClick={() => {
                      setMenuOpen(false);
                      assign.mutate({ conversationId, assignee: "bot" });
                      toast.success("Devuelto al Agente IA");
                    }}
                    style={menuItemStyle}
                  >
                    <Icon name="sparkle" size={15} /> Devolver a la IA
                  </button>
                )}
                {!closed && canOperate && (
                  <button
                    type="button"
                    className="row gap8"
                    onClick={() => {
                      setMenuOpen(false);
                      setTransferOpen(true);
                    }}
                    style={menuItemStyle}
                  >
                    <Icon name="userplus" size={15} /> Traspasar a otro agente
                  </button>
                )}
                {!closed && assignee === "agent" && owner && (isMine || isPrivileged) && (
                  <button
                    type="button"
                    className="row gap8"
                    onClick={() => {
                      setMenuOpen(false);
                      release.mutate(conversationId);
                      toast.success("Chat devuelto a la cola");
                    }}
                    style={menuItemStyle}
                  >
                    <Icon name="arrowRight" size={15} /> Soltar a la cola
                  </button>
                )}
                <button
                  type="button"
                  className="row gap8"
                  onClick={() => {
                    setMenuOpen(false);
                    setTypifyOpen(true);
                  }}
                  style={menuItemStyle}
                >
                  <Icon name="tag" size={15} /> Tipificar conversación
                </button>
                <button
                  type="button"
                  className="row gap8"
                  onClick={() => {
                    setMenuOpen(false);
                    markRead.mutate(conversationId);
                  }}
                  style={menuItemStyle}
                >
                  <Icon name="check" size={15} /> Marcar como leída
                </button>
                {!closed && (
                  <button
                    type="button"
                    className="row gap8"
                    onClick={() => {
                      setMenuOpen(false);
                      close.mutate({ conversationId });
                    }}
                    disabled={close.isPending}
                    style={menuItemStyle}
                  >
                    <Icon name="checkCircle" size={15} /> Cerrar conversación
                  </button>
                )}
                {!closed && (
                  <button
                    type="button"
                    className="row gap8"
                    onClick={closeWithSurvey}
                    disabled={close.isPending}
                    style={menuItemStyle}
                    title="Envía una encuesta CSAT al cliente y cierra la conversación"
                  >
                    <Icon name="star" size={15} /> Cerrar + enviar encuesta
                  </button>
                )}
              </div>
            </>
          )}
          <Btn
            variant="soft"
            size="sm"
            icon="tag"
            onClick={() => setTypifyOpen(true)}
            title="Tipificar la conversación (registra la gestión en el lead)"
          >
            Tipificar
          </Btn>
          {!closed && (
            <Btn
              variant="ghost"
              size="sm"
              icon="check"
              onClick={() => close.mutate({ conversationId })}
              disabled={close.isPending}
              title="Cerrar conversación"
            >
              Cerrar
            </Btn>
          )}
        </div>
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} className="msgs">
        {msgs.length === 0 ? (
          <div className="dim" style={{ margin: "auto", fontSize: 12.5 }}>
            Sin mensajes todavía.
          </div>
        ) : (
          msgs.map((m) => <Bubble key={m.id} m={m} />)
        )}
        {isTyping && (
          <div
            className="msg msg--in"
            style={{ width: "fit-content", display: "inline-flex", alignItems: "center" }}
          >
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="composer" style={{ flex: "0 0 auto" }}>
        {templatesOnly ? (
          /* Ventana de 24h vencida o chat cerrado (WhatsApp): solo plantillas. */
          <div className="col gap10" style={{ padding: "2px 2px" }}>
            <div className="row gap8" style={{ alignItems: "flex-start" }}>
              <span className="card__ico" style={{ ["--_c" as string]: "var(--gold)", flex: "0 0 auto" }}>
                <Icon name="wa" size={15} />
              </span>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-2)" }}>
                {closed
                  ? "Conversación cerrada. Fuera de la ventana de 24h de WhatsApp solo podés enviar plantillas aprobadas (promociones, reactivación…)."
                  : "Pasaron más de 24h desde el último mensaje del cliente. Por la política de WhatsApp solo podés enviar una plantilla aprobada para reabrir la conversación."}
              </div>
            </div>
            <div className="row gap8">
              <Btn variant="primary" size="sm" icon="fileText" onClick={() => setTplOpen(true)}>
                Enviar plantilla
              </Btn>
              <Btn variant="soft" size="sm" icon="tag" onClick={() => setTypifyOpen(true)}>
                Tipificar
              </Btn>
            </div>
          </div>
        ) : closedBlocked ? (
          /* IG/Messenger cerrado: sin plantillas → reabre solo el cliente. */
          <div className="row gap8" style={{ alignItems: "flex-start", padding: "2px 2px" }}>
            <span className="card__ico" style={{ ["--_c" as string]: "var(--text-3)", flex: "0 0 auto" }}>
              <Icon name="checkCircle" size={15} />
            </span>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-2)" }}>
              Conversación cerrada. Se reabrirá automáticamente cuando el cliente vuelva a escribir.
              <button
                type="button"
                className="pill pill--outline"
                style={{ cursor: "pointer", marginLeft: 8 }}
                onClick={() => setTypifyOpen(true)}
              >
                Tipificar
              </button>
            </div>
          </div>
        ) : (
          <>
        <div className="composer__box" style={{ alignItems: "flex-end" }}>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAttach(f);
              e.target.value = "";
            }}
          />
          <Btn
            variant="quiet"
            size="sm"
            icon="paperclip"
            title="Adjuntar archivo (imagen, PDF, audio…)"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{ flex: "0 0 auto" }}
          />
          {isWhatsApp && (
            <Btn
              variant="quiet"
              size="sm"
              icon="fileText"
              title="Enviar plantilla de WhatsApp"
              onClick={() => setTplOpen(true)}
              style={{ flex: "0 0 auto" }}
            />
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // En comentarios NO auto-enviamos con Enter (evita publicar en
              // público sin querer); el agente elige público vs privado.
              if (e.key === "Enter" && !e.shiftKey && !isComment) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              closed
                ? "Reabrir respondiendo…"
                : isComment
                  ? "Escribe tu respuesta al comentario…"
                  : "Escribe una respuesta…  (Enter para enviar)"
            }
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              maxHeight: 120,
              border: "none",
              background: "none",
              outline: "none",
              padding: 0,
              fontSize: 14,
              color: "var(--text-1)",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          <Btn
            variant="quiet"
            size="sm"
            icon="sparkle"
            title="Sugerir respuesta con IA (próximamente)"
            onClick={() => toast("Sugerir respuesta con IA llega pronto.")}
            style={{ flex: "0 0 auto" }}
          />
          {isComment ? (
            <div className="row gap6" style={{ flex: "0 0 auto" }}>
              <Btn
                variant="soft"
                size="sm"
                icon="chat"
                onClick={() => runComment("public")}
                disabled={replyComment.isPending || !text.trim()}
                title="Responder EN PÚBLICO al comentario (visible para todos)"
              >
                {replyComment.isPending ? "…" : "Público"}
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                icon="send"
                onClick={() => runComment("dm")}
                disabled={commentToDm.isPending || !text.trim() || conversation.dmSent}
                title={
                  conversation.dmSent
                    ? "Ya se pasó a privado (Meta permite un solo DM por comentario)"
                    : "Pasar a privado: enviar un DM al autor del comentario"
                }
              >
                {commentToDm.isPending ? "…" : conversation.dmSent ? "DM enviado" : "Privado"}
              </Btn>
            </div>
          ) : (
            <div className="row gap6" style={{ flex: "0 0 auto" }}>
              {isWhatsApp && (
                <Btn
                  variant="soft"
                  size="sm"
                  icon="grid"
                  onClick={() => setListOpen(true)}
                  title="Enviar un menú de opciones (lista interactiva de WhatsApp)"
                >
                  Lista
                </Btn>
              )}
              <Btn
                variant="primary"
                size="sm"
                icon="send"
                onClick={send}
                disabled={reply.isPending || !text.trim()}
                title="Enviar"
              >
                {reply.isPending ? "Enviando…" : "Enviar"}
              </Btn>
            </div>
          )}
        </div>

        {/* Respuestas rápidas — al click rellenan el textarea. */}
        {!closed && (
          <div className="row gap8" style={{ marginTop: 9, flexWrap: "wrap" }}>
            <span className="dim" style={{ fontSize: 11.5 }}>
              Respuestas rápidas:
            </span>
            {QUICK_REPLIES.map((s) => (
              <button
                key={s}
                type="button"
                className="pill pill--outline"
                style={{ cursor: "pointer" }}
                onClick={() => setText(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="dim" style={{ fontSize: 10.5, marginTop: 8 }}>
          {isComment
            ? "“Público” responde en el hilo del comentario; “Privado” abre un DM al autor (1 vez por comentario, ventana de Meta)."
            : conversation.channel === "mercadolibre"
              ? conversation.ml?.kind === "question"
                ? "La respuesta se publica como respuesta a la pregunta en Mercado Libre."
                : "La respuesta se envía por la mensajería post-venta de Mercado Libre."
              : "La respuesta se envía por la Graph API de Meta al remitente."}
        </div>
          </>
        )}
      </div>

      {listOpen && (
        <div
          onClick={() => setListOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(0,0,0,0.5)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              maxWidth: "100%",
              maxHeight: "88vh",
              overflowY: "auto",
              background: "var(--bg-1)",
              border: "1px solid var(--border-2)",
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 800 }}>Enviar lista interactiva</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", margin: "4px 0 14px" }}>
              Un menú tappable de WhatsApp (hasta 10 opciones). No necesita plantilla aprobada — se
              envía dentro de la ventana de 24h.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={listHeader}
                onChange={(e) => setListHeader(e.target.value)}
                placeholder="Título (opcional)"
                style={LIST_INP}
              />
              <textarea
                value={listBody}
                onChange={(e) => setListBody(e.target.value)}
                rows={2}
                placeholder="Texto del mensaje…"
                style={{ ...LIST_INP, resize: "vertical", fontFamily: "inherit" }}
              />
              <input
                value={listButton}
                onChange={(e) => setListButton(e.target.value)}
                placeholder="Texto del botón (ej. Ver opciones)"
                style={LIST_INP}
              />
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginTop: 4 }}>
                Opciones
              </div>
              {listRows.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    value={r.title}
                    onChange={(e) =>
                      setListRows((rows) =>
                        rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                      )
                    }
                    placeholder={`Opción ${i + 1}`}
                    style={{ ...LIST_INP, flex: 1 }}
                  />
                  <input
                    value={r.description}
                    onChange={(e) =>
                      setListRows((rows) =>
                        rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                      )
                    }
                    placeholder="Descripción (opcional)"
                    style={{ ...LIST_INP, flex: 1 }}
                  />
                  {listRows.length > 1 && (
                    <button
                      className="btn btn--sm"
                      onClick={() => setListRows((rows) => rows.filter((_, j) => j !== i))}
                      title="Quitar"
                      style={{ flex: "0 0 auto" }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {listRows.length < 10 && (
                <button
                  className="btn btn--sm"
                  onClick={() => setListRows((rows) => [...rows, { title: "", description: "" }])}
                  style={{ alignSelf: "flex-start" }}
                >
                  + Opción
                </button>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={() => setListOpen(false)}>
                Cancelar
              </button>
              <button
                className="btn btn--primary"
                onClick={sendListNow}
                disabled={sendList.isPending}
              >
                {sendList.isPending ? "Enviando…" : "Enviar lista"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — enviar una plantilla HSM de WhatsApp. */}
      {tplOpen && (
        <div
          className="scrim"
          style={{ display: "grid", placeItems: "center", zIndex: 300 }}
          onClick={() => setTplOpen(false)}
        >
          <div
            className="card card--pop"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 460, maxWidth: "94vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
          >
            <div className="card__head">
              <div className="card__title">
                <span className="card__ico" style={{ ["--_c" as string]: "var(--green)" }}>
                  <Icon name="wa" size={16} />
                </span>
                Enviar plantilla
              </div>
              <button type="button" className="ctab__x" onClick={() => setTplOpen(false)}>
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="card__pad" style={{ overflowY: "auto" }}>
              {tplLoading ? (
                <div className="dim" style={{ padding: 20, textAlign: "center", fontSize: 13 }}>
                  Cargando plantillas…
                </div>
              ) : templates.length === 0 ? (
                <div className="dim" style={{ padding: 16, textAlign: "center", fontSize: 12.5, lineHeight: 1.5 }}>
                  No hay plantillas aprobadas. Créalas en Configuración → Plantillas de WhatsApp.
                </div>
              ) : (
                <div className="col gap8">
                  {templates.map((t) => (
                    <button
                      key={t.name + (t.language || "")}
                      type="button"
                      onClick={() => sendTpl(t)}
                      disabled={sendTemplate.isPending}
                      className="row between"
                      style={{
                        padding: "10px 12px",
                        borderRadius: "var(--r-md)",
                        border: "1px solid var(--border-1)",
                        background: "var(--bg-2)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <b style={{ fontSize: 13 }}>{t.name}</b>
                        <div className="dim trunc" style={{ fontSize: 11.5, marginTop: 2, maxWidth: 320 }}>
                          {t.body || t.bodyText || t.category || "Plantilla HSM"}
                        </div>
                      </span>
                      <span className="row gap6" style={{ flex: "0 0 auto" }}>
                        {t.language && <Pill tone="outline">{t.language}</Pill>}
                        <Icon name="send" size={14} style={{ color: "var(--green)" }} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tipificar la conversación — misma taxonomía que el wrap-up de voz. */}
      {typifyOpen && (
        <ConversationTypifyModal
          conversation={conversation}
          onClose={() => setTypifyOpen(false)}
        />
      )}

      {/* Traspasar / derivar el chat a otro agente (ownership). */}
      {transferOpen && (
        <div
          className="scrim"
          style={{ display: "grid", placeItems: "center", zIndex: 320 }}
          onClick={() => setTransferOpen(false)}
        >
          <div
            className="card card--pop"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 420, maxWidth: "94vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
          >
            <div className="card__head">
              <div className="card__title">
                <span className="card__ico" style={{ ["--_c" as string]: "var(--cyan)" }}>
                  <Icon name="userplus" size={16} />
                </span>
                Traspasar conversación
              </div>
              <button type="button" className="ctab__x" onClick={() => setTransferOpen(false)}>
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="card__pad" style={{ overflowY: "auto" }}>
              <div className="dim" style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
                Elegí a quién derivar el chat. Le aparecerá en su bandeja y saldrá de la tuya.
              </div>
              {agentsToShow.length === 0 ? (
                <div className="dim" style={{ padding: 16, textAlign: "center", fontSize: 12.5 }}>
                  No hay otros agentes disponibles.
                </div>
              ) : (
                <div className="col gap6">
                  {agentsToShow.map((u) => (
                    <button
                      key={u.email}
                      type="button"
                      onClick={() => doTransfer(u)}
                      disabled={assignTo.isPending}
                      className="row gap10"
                      style={{
                        padding: "8px 10px",
                        borderRadius: "var(--r-md)",
                        border: "1px solid var(--border-1)",
                        background: "var(--bg-2)",
                        cursor: "pointer",
                        textAlign: "left",
                        alignItems: "center",
                      }}
                    >
                      <Av name={agentLabel(u)} size={30} radius={9} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <b className="trunc" style={{ fontSize: 13, display: "block" }}>
                          {agentLabel(u)}
                        </b>
                        <div className="dim trunc" style={{ fontSize: 11 }}>
                          {u.email}
                        </div>
                      </span>
                      <Icon name="arrowRight" size={14} style={{ color: "var(--cyan)" }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const menuItemStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  fontSize: 13,
  textAlign: "left",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-1)",
  width: "100%",
};
