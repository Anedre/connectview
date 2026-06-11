import { useMemo, useState } from "react";
import { Mail, MessageSquare, Plus, Sparkles, ChevronRight, X, Search } from "lucide-react";
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
// Logos de marca reales (paths oficiales de simple-icons, viewBox 24×24,
// monocromos → se pintan blancos sobre el círculo de color de la marca).
const CH_PATH: Partial<Record<BotChannel, string>> = {
  whatsapp:
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  instagram:
    "M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z",
  telegram:
    "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  messenger:
    "M.001 11.639C.001 4.949 5.241 0 12.001 0S24 4.95 24 11.639c0 6.689-5.24 11.638-12 11.638-1.21 0-2.371-.159-3.461-.45a.96.96 0 0 0-.641.05l-2.39 1.05a.96.96 0 0 1-1.35-.85l-.06-2.141a.97.97 0 0 0-.32-.682C1.211 18.282 0 15.092 0 11.639zm8.32-2.19l-3.52 5.6c-.35.53.32 1.139.81.769l3.79-2.87a.72.72 0 0 1 .86 0l2.8 2.1c.84.63 2.04.41 2.6-.48l3.52-5.6c.35-.53-.32-1.13-.81-.77l-3.79 2.87a.72.72 0 0 1-.86 0l-2.8-2.1a1.8 1.8 0 0 0-2.6.48z",
  tiktok:
    "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
};
const IG_GRADIENT =
  "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)";

function ChannelGlyph({ id, size }: { id: BotChannel; size: number }) {
  const path = CH_PATH[id];
  if (path) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    );
  }
  if (id === "email") return <Mail size={size} strokeWidth={2.4} />;
  return <MessageSquare size={size} strokeWidth={2.4} />;
}

function ChannelBadge({ id, size = 26 }: { id: BotChannel; size?: number }) {
  const ch = BOT_CHANNELS.find((c) => c.id === id);
  if (!ch) return null;
  const bg = id === "instagram" ? IG_GRADIENT : ch.color;
  return (
    <span className="tg-chbadge" title={ch.label} style={{ width: size, height: size, background: bg }}>
      <ChannelGlyph id={id} size={Math.round(size * 0.58)} />
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
  const [q, setQ] = useState("");

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

  const needle = q.trim().toLowerCase();
  const filtered = cards.filter(
    (t) =>
      (cat === "all" || t.category === cat) &&
      (channels.size === 0 || (t.channels || []).some((c) => channels.has(c))) &&
      (!needle || `${t.name} ${t.description}`.toLowerCase().includes(needle))
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

        {/* Main — search + tabs + AI banner + grid */}
        <div className="tg-main">
          <div className="tg-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar plantilla…"
            />
            {q && (
              <button className="tg-search__clear" onClick={() => setQ("")} title="Limpiar">
                <X size={14} />
              </button>
            )}
          </div>
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
