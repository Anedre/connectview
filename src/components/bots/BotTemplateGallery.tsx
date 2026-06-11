import { useMemo, useState } from "react";
import {
  MessageCircle,
  Camera,
  Send,
  Mail,
  MessageSquare,
  Music2,
  MessagesSquare,
  Plus,
  Sparkles,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  BOT_TEMPLATES,
  BOT_CATEGORIES,
  BOT_CHANNELS,
  type Bot,
  type BotTemplate,
  type BotChannel,
} from "@/lib/botFlow";

/**
 * BotTemplateGallery — the premium, Kommo-style "Crear un bot" catalog (#16).
 * A channel filter + category tabs + a featured AI banner + a grid of cards,
 * each topped with a generated chat-mockup preview (the "imagen alusiva")
 * built from the template's own data — no raster assets needed. Picking a card
 * hands a ready-to-edit Bot up via onPick.
 */
const CH_GLYPH: Record<BotChannel, LucideIcon> = {
  whatsapp: MessageCircle,
  instagram: Camera,
  telegram: Send,
  messenger: MessagesSquare,
  tiktok: Music2,
  email: Mail,
  webchat: MessageSquare,
};

function ChannelBadge({ id, size = 26 }: { id: BotChannel; size?: number }) {
  const ch = BOT_CHANNELS.find((c) => c.id === id);
  const Glyph = CH_GLYPH[id];
  if (!ch) return null;
  return (
    <span
      className="tg-chbadge"
      title={ch.label}
      style={{ width: size, height: size, background: ch.color }}
    >
      <Glyph size={size * 0.52} strokeWidth={2.4} />
    </span>
  );
}

function TemplateCard({ t, onPick }: { t: BotTemplate; onPick: (b: Bot) => void }) {
  const p = t.preview;
  const primary = t.channels?.[0];
  return (
    <button
      className="tg-card"
      onClick={() => onPick(t.build())}
      style={{ "--tg-accent": t.accent } as React.CSSProperties}
    >
      <div
        className="tg-card__preview"
        style={{ background: `linear-gradient(155deg, ${t.accent}33, ${t.accent}12 70%), #fbfbfe` }}
      >
        {primary && (
          <span className="tg-card__badge">
            <ChannelBadge id={primary} />
          </span>
        )}
        {t.channels && t.channels.length > 1 && (
          <span className="tg-card__badge2">
            <ChannelBadge id={t.channels[1]} size={22} />
          </span>
        )}
        {p?.emoji && <span className="tg-card__emoji" aria-hidden>{p.emoji}</span>}
        <div className="tg-card__bubble">{p?.bubble || t.description}</div>
        {p?.reply && (
          <div className="tg-card__reply" style={{ background: t.accent }}>
            {p.reply}
          </div>
        )}
      </div>
      <div className="tg-card__title">{t.name}</div>
      <div className="tg-card__desc">{t.description}</div>
    </button>
  );
}

export function BotTemplateGallery({
  onPick,
  onBack,
}: {
  onPick: (bot: Bot) => void;
  onBack?: () => void;
}) {
  const [cat, setCat] = useState<"all" | string>("all");
  const [channels, setChannels] = useState<Set<BotChannel>>(new Set());

  const blank = BOT_TEMPLATES.find((t) => t.id === "blank");
  const ai = BOT_TEMPLATES.find((t) => t.id === "ai");
  const cards = useMemo(
    () => BOT_TEMPLATES.filter((t) => t.id !== "blank"),
    []
  );

  const toggleChannel = (id: BotChannel) =>
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOn = channels.size === BOT_CHANNELS.length;
  const toggleAll = () =>
    setChannels(allOn ? new Set() : new Set(BOT_CHANNELS.map((c) => c.id)));

  const filtered = cards.filter(
    (t) =>
      (cat === "all" || t.category === cat) &&
      (channels.size === 0 || (t.channels || []).some((c) => channels.has(c)))
  );

  const TABS = [{ id: "all", label: "Todas las plantillas" }, ...BOT_CATEGORIES];

  return (
    <div className="tg">
      {/* Header */}
      <div className="tg-head">
        <div className="tg-head__title">Crear un bot</div>
        {onBack && (
          <button className="tg-head__close" onClick={onBack} title="Cerrar">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="tg-body">
        {/* Sidebar — start-from-scratch + channel filter */}
        <aside className="tg-side">
          {blank && (
            <button className="tg-blank" onClick={() => onPick(blank.build())}>
              <Plus size={15} /> Comenzar desde cero
            </button>
          )}
          <div className="tg-side__title">Canales</div>
          <label className="tg-ch tg-ch--all">
            <input type="checkbox" checked={allOn} onChange={toggleAll} />
            <span>Seleccionar todos</span>
          </label>
          {BOT_CHANNELS.map((ch) => (
            <label key={ch.id} className="tg-ch">
              <input
                type="checkbox"
                checked={channels.has(ch.id)}
                onChange={() => toggleChannel(ch.id)}
              />
              <ChannelBadge id={ch.id} size={20} />
              <span>{ch.label}</span>
            </label>
          ))}
        </aside>

        {/* Main — tabs + AI banner + grid */}
        <div className="tg-main">
          <div className="tg-tabs">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                className={`tg-tab ${cat === tb.id ? "tg-tab--on" : ""}`}
                onClick={() => setCat(tb.id)}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {ai && (
            <button className="tg-banner" onClick={() => onPick(ai.build())}>
              <span className="tg-banner__icon"><Sparkles size={18} /></span>
              <div className="tg-banner__txt">
                <div className="tg-banner__h">Prueba el agente de IA — comunicación automatizada con clientes 24/7</div>
                <div className="tg-banner__s">Comienza con una plantilla prediseñada o crea tu propio agente desde cero.</div>
              </div>
              <ChevronRight size={20} className="tg-banner__chev" />
            </button>
          )}

          {filtered.length === 0 ? (
            <div className="tg-empty">Ninguna plantilla coincide con los filtros.</div>
          ) : (
            <div className="tg-grid">
              {filtered.map((t) => (
                <TemplateCard key={t.id} t={t} onPick={onPick} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
