/* global React, Icon, Avatar, ChannelChip, StatusPill, DATA */
const { useState, useEffect } = React;

function Supervision() {
  // Live ticking queue values for vibe
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 3000); return () => clearInterval(id); }, []);

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Operación</span></div>
          <h1 className="view__title">Cola en vivo · Supervisión</h1>
          <div className="view__sub">142 agentes activos · 63 contactos en cola · Refresh cada 3s</div>
        </div>
        <div className="view__actions">
          <span className="chip chip--green"><span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} /> Live</span>
          <button className="btn"><Icon.Filter style={{ width: 14, height: 14 }} /> Equipos</button>
          <button className="btn"><Icon.Sparkles style={{ width: 14, height: 14 }} /> Coach automático</button>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiTile label="En cola" value={63 + (tick % 3)} color="var(--accent-red)" sub="+12 últimos 5m" />
        <KpiTile label="En conversación" value={89 - (tick % 4)} color="var(--accent-cyan)" sub="84% utilización" />
        <KpiTile label="Disponibles" value={31 + (tick % 2)} color="var(--accent-green)" sub="22% del staff" />
        <KpiTile label="ACW" value={18} color="var(--accent-amber)" sub="AHT wrap 1:42" />
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Estado de las colas</div>
            <span className="muted" style={{ fontSize: 11 }}>{DATA.QUEUES.length} colas activas</span>
          </div>
          <div className="card__body card__body--flush">
            {DATA.QUEUES.map(q => (
              <div key={q.id} className={`queue-row ${q.status === 'alert' ? 'queue-row--alert' : q.status === 'warn' ? 'queue-row--warn' : ''}`}>
                <ChannelChip type={q.channel} />
                <div className="grow truncate">
                  <div style={{ fontWeight: 500 }}>{q.name}</div>
                  <div className="muted mono" style={{ fontSize: 10.5 }}>SL target 80% / 30s</div>
                </div>
                <div className="mono col-num"><span className="muted" style={{ fontSize: 10.5 }}>cola</span><br />{q.inQueue}</div>
                <div className="mono col-num">
                  <span className="muted" style={{ fontSize: 10.5 }}>SLA</span><br />
                  <span style={{ color: q.sla >= 80 ? 'var(--accent-green)' : q.sla >= 70 ? 'var(--accent-amber)' : 'var(--accent-red)' }}>{q.sla}%</span>
                </div>
                <div className="mono col-num"><span className="muted" style={{ fontSize: 10.5 }}>longest</span><br />{Math.floor(q.longest / 60)}:{String(q.longest % 60).padStart(2, '0')}</div>
                <button className="btn btn--sm">Ver detalle</button>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div className="card__title">Sentiment global · últimos 30 min</div>
            <span className="muted mono" style={{ fontSize: 11 }}>actualizado hace 4s</span>
          </div>
          <div className="card__body">
            <SentimentMatrix />
            <div className="divider" />
            <div className="section-title">Coaching automático · alertas IA</div>
            <div className="col" style={{ gap: 8 }}>
              {[
                { agent: 'Diego Paredes',   reason: 'Sentiment cliente cayó a -0.7 hace 30s', action: 'Whisper' },
                { agent: 'Sofía Aguilar',  reason: 'Cliente menciona "cancelar" 3 veces',     action: 'Tomar llamada' },
                { agent: 'Valeria Núñez',   reason: 'Largo silencio detectado (52s)',          action: 'Whisper' },
              ].map((a, i) => (
                <div key={i} className="row" style={{ padding: 10, background: 'var(--accent-red-soft)', borderRadius: 8 }}>
                  <Avatar name={a.agent} />
                  <div className="grow">
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{a.agent}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{a.reason}</div>
                  </div>
                  <button className="btn btn--sm btn--danger">{a.action}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">Agentes · {DATA.AGENTS.length} en operación</div>
          <div className="row" style={{ gap: 6 }}>
            <span className="chip chip--green"><span className="dot" /> Disponible · 31</span>
            <span className="chip chip--cyan"><span className="dot" /> En llamada · 89</span>
            <span className="chip chip--amber"><span className="dot" /> ACW · 18</span>
            <span className="chip chip--violet"><span className="dot" /> Break · 14</span>
            <span className="chip"><span className="dot" style={{ background: 'var(--text-3)' }} /> Off · 26</span>
          </div>
        </div>
        <div className="card__body">
          <div className="agents">
            {DATA.AGENTS.map(a => (
              <div key={a.id} className="agent">
                <Avatar name={a.name} color={a.color} />
                <div className="agent__meta">
                  <div className="agent__name">{a.name}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="state-dot" style={{ background: a.stateColor }} />
                    <span className="agent__state">{a.state}</span>
                    <span className="agent__time">· {a.time}</span>
                  </div>
                </div>
                <button className="btn btn--ghost btn--sm btn--icon" title="Whisper"><Icon.Headset style={{ width: 13, height: 13 }} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiTile({ label, value, color, sub }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value" style={{ color }}>{value}</div>
      <div className="kpi__delta kpi__delta--flat">{sub}</div>
    </div>
  );
}

function SentimentMatrix() {
  const cells = 7 * 4;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {Array.from({ length: cells }).map((_, i) => {
          const v = Math.sin(i * 0.7) * 0.5 + 0.5 + (Math.random() * 0.2 - 0.1);
          const color = v > 0.66 ? 'var(--accent-green)' : v > 0.4 ? 'var(--accent-amber)' : 'var(--accent-red)';
          const opacity = 0.3 + v * 0.6;
          return <div key={i} style={{ height: 18, background: color, opacity, borderRadius: 3 }} title={`Score ${(v * 2 - 1).toFixed(2)}`} />;
        })}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span className="muted mono" style={{ fontSize: 10.5 }}>-30m</span>
        <span className="muted mono" style={{ fontSize: 10.5 }}>-20m</span>
        <span className="muted mono" style={{ fontSize: 10.5 }}>-10m</span>
        <span className="muted mono" style={{ fontSize: 10.5 }}>ahora</span>
      </div>
    </div>
  );
}

window.Supervision = Supervision;
