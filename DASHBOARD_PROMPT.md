# Prompt — Vox CRM "Inicio" dashboard (OP redesign)

> Paste this into a top UI-generation tool (v0.dev, Lovable, Bolt, or a Claude
> artifact). It's self-contained with realistic mock data. UI copy is Spanish.
> Wiring notes for the real Vox data are at the bottom.

---

You are a senior product designer + front-end engineer. Build a **stunning,
modern, animated analytics dashboard** — the home screen ("Inicio · Vista
ejecutiva") of **Vox CRM**, a contact-center platform built on Amazon Connect
for an education client (UDEP). This is the executive overview a manager sees
first. Make it look like the best of **Linear + Vercel Analytics + Stripe
Dashboard + Chattigo** — premium, dense-but-clean, alive.

## Tech & constraints
- **React 18+ + TypeScript**, single self-contained page component.
- **Tailwind CSS** for styling. **framer-motion** for animation. **recharts**
  for charts. **lucide-react** for icons. (All allowed/expected.)
- **Theme-aware**: support BOTH a **deep-black dark mode** (default) and a clean
  light mode, driven by a `dark` class on `<html>`. NO navy/blue-tinted darks —
  the dark theme must be **near-pure neutral black**.
- Fully **responsive** (graceful down to tablet). Accessible (aria labels,
  ≥4.5:1 text contrast, keyboard-focusable interactive cards).
- All numbers/labels in **Spanish** (es-PE). Currency `S/`.

## Visual direction (this is the most important part)
- **Dark mode palette (deep black):** app bg `#0A0A0B`, panels `#101011`,
  nested cards `#161617`, hairline borders `#232325`, text `#F2F2F3 / #A8A8AD /
  #6E6E76`. Light mode: bg `#F6F7F9`, cards `#FFFFFF`, text `#0E1525`.
- **Accents (vivid, pop on black):** cyan `#2BC6E6`, violet `#9B8CF0`, green
  `#25B873`, amber `#F5A524`, red `#ED5257`, pink `#ED84C2`. Use them
  purposefully (one accent per metric family), never rainbow-soup.
- Premium touches: subtle radial accent glows behind hero, **glassmorphism**
  (backdrop-blur + 1px translucent border) on floating elements, soft layered
  shadows, gradient strokes on charts, 12–16px radii, generous spacing, crisp
  typography (big numbers `font-weight:800` + tight negative letter-spacing;
  uppercase section labels with letter-spacing).
- It should feel **alive**: things animate in, numbers count up, charts draw,
  hovers respond. Never static or flat.

## Layout (top → bottom)
1. **Header bar**: breadcrumb "Inicio", title "Vista ejecutiva", subtitle
   "{n} agentes conectados · {m} colas activas". Right side: a pulsing green
   **"Live · HH:MM"** pill and a "Actualizar" button. Below: an animated
   **segmented period filter** (Hoy / Ayer / Semana / Mes) with a sliding
   active indicator.
2. **Hero KPI row** (6–7 cards, responsive auto-fit): each card has an
   uppercase label, a **count-up animated** big number, a colored **delta**
   (▲ green / ▼ red "vs período anterior"), and an inline **sparkline** (mini
   area chart). Cards **lift + glow + show an accent wash on hover**, and are
   **clickable** (cursor pointer). Metrics:
   Contactos · Sentiment positivo (%) · AHT promedio (m:ss) · Leads · Citas
   próximas · Plantillas WhatsApp · Agentes (disponibles/online).
3. **Main row** (2 cols, ~1.6fr / 1fr):
   - **Volumen de contactos por canal** — stacked bar chart per day, channels
     Voz/WhatsApp/Chat/Email/SMS each its own accent, animated grow-in, legend,
     rich tooltip.
   - **Sentiment de contactos** — donut with the total in the center
     (Positivo/Neutral/Mixto/Negativo), animated sweep, legend with value + %.
4. **Vivid row** (3 cols):
   - **Satisfacción** — a big **radial gauge** (animated arc fill) showing the
     positive-sentiment %.
   - **Ranking de agentes** — top-5 horizontal bars (animated width), avatar
     initials, rank number.
   - **Contactos por cola** — donut with center total + legend.
5. **Growth row** (2 cols, ~1fr / 1.4fr):
   - **Fuentes de leads** — donut (Web/Campaña/Salesforce/WhatsApp/Manual).
   - **Embudo de leads** — a real **funnel** visualization across pipeline
     stages (Contactado → Interesado → Negociando → Cerrando → Inscrito…),
     bars colored by stage valoración (green positive / violet closing / red
     negative), animated.
6. **Bottom row** (2 cols):
   - **Campañas activas** — list with per-campaign progress bars.
   - **Colas en tiempo real** — rows: queue name · en cola · libres · espera ·
     status pill (OK/Media/En riesgo).
7. (Bonus, if you can) an **activity heatmap** (contacts by hour × weekday) —
   it reads very "pro".

## Animations (use framer-motion)
- **Staggered entrance**: cards/sections fade+rise in sequence on mount.
- **Count-up** on every big KPI number.
- **Charts draw in** (recharts `isAnimationActive` + a mount delay).
- **Hover micro-interactions** on KPI cards (translateY(-3px), accent border,
  glow shadow) and on chart elements.
- **Animated period switch**: re-animate the data when the filter changes.
- **Skeleton shimmer** loading states for every card (not spinners).
- Respect `prefers-reduced-motion`.

## Quality bar
- No placeholder lorem; use the realistic mock data below so it looks populated.
- No overflow/clipping; charts fill their cards (no empty whitespace, no tiny
  charts lost in big boxes — every block is balanced and full).
- Empty states are designed (icon + helpful line), not blank.
- Clean componentization (a reusable `<StatCard>`, `<DonutCard>`, `<GaugeCard>`,
  `<RankCard>`, `<Panel>`).

## Mock data (use this exact shape so it's easy to wire to the real API later)
```ts
const kpis = {
  contactos: { value: 184, delta: +23, spark: [12,18,9,22,17,28,31] },
  sentimentPos: { value: 62 }, // %
  aht: { seconds: 176 },       // 2:56
  leads: { value: 47, delta: +12, spark: [3,5,4,8,6,11,10] },
  citas: { value: 9, total: 14 },
  plantillasWA: { value: 320 },
  agentes: { available: 6, online: 8 },
};
const volumeByChannel = [ // one per day
  { label:"24/5", voz:14, wa:22, chat:6, email:3, sms:1 },
  { label:"25/5", voz:18, wa:25, chat:9, email:2, sms:0 },
  { label:"26/5", voz:12, wa:30, chat:7, email:4, sms:2 },
  { label:"27/5", voz:20, wa:28, chat:11, email:3, sms:1 },
  { label:"28/5", voz:9,  wa:33, chat:5, email:6, sms:2 },
  { label:"29/5", voz:16, wa:27, chat:8, email:1, sms:0 },
  { label:"30/5", voz:11, wa:24, chat:10, email:5, sms:1 },
];
const sentiment = [ {name:"Positivo",value:114,color:"#25B873"},{name:"Neutral",value:48,color:"#2BC6E6"},{name:"Mixto",value:14,color:"#F5A524"},{name:"Negativo",value:8,color:"#ED5257"} ];
const agentRank = [ {name:"María Gonzales",value:42},{name:"Carlos Ruiz",value:38},{name:"Andre Alata",value:31},{name:"Lucía Vega",value:27},{name:"Diego Soto",value:19} ];
const byQueue = [ {name:"UDEP-Pregrado",value:78},{name:"UDEP-Posgrado",value:41},{name:"UDEP-Alumnos",value:33},{name:"UDEP-Diplomados",value:20},{name:"Gerencia",value:12} ];
const leadSources = [ {name:"Web",value:18},{name:"Campaña",value:14},{name:"WhatsApp",value:9},{name:"Salesforce",value:4},{name:"Manual",value:2} ];
const funnel = [ {label:"Contactado",value:47,color:"#9B8CF0"},{label:"Interesado",value:31,color:"#25B873"},{label:"Negociando",value:18,color:"#25B873"},{label:"Cerrando",value:9,color:"#9B8CF0"},{label:"Inscrito",value:5,color:"#25B873"},{label:"No interesado",value:6,color:"#ED5257"} ];
const campaigns = [ {name:"Admisión Pregrado 2026-I", done:340, total:500, status:"RUNNING"},{name:"Reactivación Posgrado", done:120, total:300, status:"PAUSED"} ];
const liveQueues = [ {name:"UDEP-Pregrado", enCola:3, libres:4, espera:"0:42", status:"ok"},{name:"UDEP-Posgrado", enCola:8, libres:1, espera:"2:15", status:"warn"},{name:"UDEP-Alumnos", enCola:0, libres:5, espera:"0:00", status:"ok"} ];
const heatmap = /* 7 weekdays × 24 hours, ints 0..30 */;
```

## Deliverable
One polished, runnable React + TS file (plus any small subcomponents).
Dark mode by default. Everything animated and interactive per above. Make it
genuinely impressive — the kind of dashboard that makes someone say "wow".

---

## (For wiring to the REAL Vox data afterward — context, do not block on this)
- Real endpoints exist in `getApiEndpoints()` (`@/lib/api`): `queryContacts`
  (→ `ContactRecord[]`: `{initiationTimestamp, agentUsername, queueName,
  channel, duration, sentiment, status}`), `manageLeads`, `manageAppointment`
  (`{whenISO,status}`), `getHsmReport`, plus live `useRealtimeMetrics()`
  (`{summary,queues:[{queueId,queueName,contactsInQueue,agentsAvailable,
  oldestContactAge}],agents}`).
- Resolve `agentUsername`/`queueName` UUIDs to names via `useUsers()
  .userIdToName` and the live `metrics.queues` id→name map.
- Theme tokens already exist as CSS vars in `src/index.css`
  (`--bg-0/1/2`, `--text-1/2/3`, `--accent-cyan/violet/green/amber/red/pink`,
  `--border-1`) — prefer those over hardcoded hex when porting in.
- Channel normalize: VOICE→Voz, WHATSAPP→WhatsApp, CHAT→Chat, EMAIL→Email,
  SMS→SMS, TASK→Tarea.
