/* global React, Icon, Kpi, Spark, Avatar, ChannelChip, StatusPill, DATA */
const { useMemo } = React;

function Dashboard({ role, setRoute, callState, onSimulateCall }) {
  // Different KPIs depending on role
  const roleKpis = {
    agent: [
      { label: 'Llamadas hoy',   value: '24',   delta: '+3 vs ayer', dir: 'up',   spark: [4,6,5,8,7,9,10,11,9,12,14,12,15], color: 'var(--accent-cyan)' },
      { label: 'Tiempo en línea',value: '5h 14m', delta: '92% productividad', dir: 'up', spark: [3,4,5,5,6,7,8,8,9,9,10,11,11], color: 'var(--accent-green)' },
      { label: 'AHT promedio',   value: '4:38', delta: '−12s vs meta', dir: 'down', spark: [6,5,6,5,4,4,5,4,4,3,4,4,4], color: 'var(--accent-amber)' },
      { label: 'CSAT del día',   value: '94%',  delta: '+2 pts',     dir: 'up',   spark: [80,82,85,84,86,89,90,92,91,93,94], color: 'var(--accent-green)' },
    ],
    supervisor: [
      { label: 'Agentes activos',     value: '142 / 168', delta: '+8 vs hora anterior', dir: 'up', spark: [120,125,130,128,135,140,142,141,142], color: 'var(--accent-cyan)' },
      { label: 'Cola global',         value: '63',        delta: '+12 en últimos 5m', dir: 'up', spark: [40,45,48,52,55,58,60,63], color: 'var(--accent-red)' },
      { label: 'SLA cumplimiento',    value: '74%',       delta: '−6 pts vs target',  dir: 'down', spark: [88,86,84,82,80,78,76,74], color: 'var(--accent-amber)' },
      { label: 'Sentiment promedio',  value: '+0.42',     delta: 'Mejor que ayer',    dir: 'up', spark: [0.2,0.25,0.3,0.32,0.38,0.4,0.41,0.42], color: 'var(--accent-green)' },
    ],
    manager: [
      { label: 'Volumen mensual',      value: '184.2k',  delta: '+12.4% MoM', dir: 'up', spark: [120,128,140,148,156,168,178,184], color: 'var(--accent-cyan)' },
      { label: 'Conversión outbound',  value: '18.4%',   delta: '+1.8 pts',  dir: 'up', spark: [14,15,15,16,17,17,18,18.4], color: 'var(--accent-green)' },
      { label: 'NPS contact center',   value: '64',      delta: '+4 pts QoQ', dir: 'up', spark: [52,55,58,60,61,62,63,64], color: 'var(--accent-green)' },
      { label: 'Costo por contacto',   value: '$2.18',   delta: '−8% vs Q2', dir: 'down', spark: [2.6,2.5,2.45,2.4,2.3,2.25,2.2,2.18], color: 'var(--accent-amber)' },
    ],
  }[role] || [];

  const greeting = role === 'agent' ? 'Hola, Camila' : role === 'supervisor' ? 'Centro de operaciones' : 'Vista ejecutiva';
  const subgreet = {
    agent: 'Tienes 3 callbacks programados y 2 casos asignados pendientes.',
    supervisor: '4 colas en alerta · 12 agentes requieren atención',
    manager: 'Vista consolidada de operación · semana 32',
  }[role];

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Inicio</span></div>
          <h1 className="view__title">{greeting}</h1>
          <div className="view__sub">{subgreet}</div>
        </div>
        <div className="view__actions">
          <button className="btn"><Icon.Refresh style={{ width: 14, height: 14 }} /> Actualizar</button>
          <button className="btn"><Icon.Calendar style={{ width: 14, height: 14 }} /> Hoy · 08:00 – 18:00</button>
          {role === 'agent' && (
            <button className="btn btn--primary" onClick={onSimulateCall} disabled={callState !== 'idle'}>
              <Icon.PhoneIn style={{ width: 14, height: 14 }} />
              Simular llamada entrante
            </button>
          )}
        </div>
      </div>

      <div className="kpi-grid">
        {roleKpis.map(k => (
          <Kpi key={k.label} label={k.label} value={k.value} delta={k.delta} deltaDir={k.dir} spark={k.spark} color={k.color} />
        ))}
      </div>

      <div style={{ height: 16 }} />

      {role === 'agent' && <AgentDashSections setRoute={setRoute} />}
      {role === 'supervisor' && <SupervisorDashSections setRoute={setRoute} />}
      {role === 'manager' && <ManagerDashSections setRoute={setRoute} />}
    </div>
  );
}

function AgentDashSections({ setRoute }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Mis casos asignados</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn--ghost btn--sm">Todos · 8</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setRoute('cases')}>Ver todos <Icon.ChevRight style={{ width: 12, height: 12 }} /></button>
            </div>
          </div>
          <div className="card__body card__body--flush">
            <table className="t">
              <thead><tr><th></th><th>Caso</th><th>Asunto</th><th>Prioridad</th><th>SLA</th><th>Antigüedad</th></tr></thead>
              <tbody>
                {DATA.CASES.slice(0, 5).map(c => (
                  <tr key={c.id}>
                    <td style={{ width: 28 }}><ChannelChip type={c.channel} /></td>
                    <td className="col-num col-muted">{c.id}</td>
                    <td><div style={{ maxWidth: 380 }} className="truncate">{c.subject}</div></td>
                    <td><StatusPill status={c.priority} /></td>
                    <td><StatusPill status={c.sla} /></td>
                    <td className="col-num col-muted">{c.age}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card__head"><div className="card__title">Próximas tareas</div></div>
          <div className="card__body">
            <div className="tl">
              {[
                { t: '14:00', title: 'Callback · Ariadna Ferré', body: 'Confirmar entrega del envío internacional', icon: Icon.Phone, color: 'var(--accent-green)' },
                { t: '14:30', title: 'Email a Heriberto Q.', body: 'Enviar análisis del cargo duplicado', icon: Icon.Mail, color: 'var(--accent-amber)' },
                { t: '15:15', title: 'Coaching con Marisa', body: 'Revisión semanal · 30min', icon: Icon.User, color: 'var(--accent-violet)' },
                { t: '16:00', title: 'WhatsApp · Imani Okafor', body: 'Seguimiento OTP', icon: Icon.WhatsApp, color: 'var(--accent-cyan)' },
              ].map((it, i) => {
                const Icn = it.icon;
                return (
                  <div key={i} className="tl__item">
                    <div className="tl__dot" style={{ color: it.color, borderColor: it.color, background: 'transparent' }}>
                      <Icn style={{ width: 12, height: 12 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="tl__time">{it.t}</div>
                      <div className="tl__body">
                        <div className="tl__title">{it.title}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{it.body}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="grid-2">
        <div className="card">
          <div className="card__head">
            <div className="card__title">Mi actividad reciente</div>
            <span className="card__sub">Últimas 24h</span>
          </div>
          <div className="card__body">
            <div className="tl">
              {[
                { t: '13:42', title: 'Llamada con Solange Médard', body: 'AHT 3:14 · Sentiment positivo', icon: Icon.Phone, color: 'var(--accent-green)' },
                { t: '13:18', title: 'Caso VX-4815 actualizado', body: 'Cambio de titular — esperando documentación', icon: Icon.Ticket, color: 'var(--accent-amber)' },
                { t: '12:50', title: 'Email enviado a Béatrice S.', body: 'Confirmación de activación módulo', icon: Icon.Mail, color: 'var(--accent-amber)' },
                { t: '12:11', title: 'Llamada con Ariadna Ferré', body: 'AHT 6:48 · Escalado a logística', icon: Icon.Phone, color: 'var(--accent-green)' },
              ].map((it, i) => {
                const Icn = it.icon;
                return (
                  <div key={i} className="tl__item">
                    <div className="tl__dot" style={{ color: it.color, borderColor: it.color }}><Icn style={{ width: 12, height: 12 }} /></div>
                    <div style={{ flex: 1 }}>
                      <div className="tl__time">{it.t}</div>
                      <div className="tl__body">
                        <div className="tl__title">{it.title}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{it.body}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div className="card__title">Tu rendimiento esta semana</div>
            <span className="chip chip--green"><Icon.ArrowUp style={{ width: 11, height: 11 }} /> Top 12%</span>
          </div>
          <div className="card__body">
            <PerfWeekChart />
            <div className="divider" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <Mini label="FCR" value="86%" />
              <Mini label="Adherencia" value="98%" />
              <Mini label="Calidad QA" value="9.2 / 10" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Mini({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function PerfWeekChart() {
  const data = [
    { d: 'Lun', calls: 22, csat: 90 },
    { d: 'Mar', calls: 18, csat: 88 },
    { d: 'Mié', calls: 26, csat: 92 },
    { d: 'Jue', calls: 24, csat: 91 },
    { d: 'Vie', calls: 30, csat: 94 },
    { d: 'Sáb', calls: 12, csat: 89 },
    { d: 'Dom', calls: 0, csat: 0 },
  ];
  const max = 32;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 120, padding: '8px 0' }}>
      {data.map(d => (
        <div key={d.d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ width: '100%', height: 90, display: 'flex', alignItems: 'flex-end', gap: 3 }}>
            <div style={{ flex: 1, background: 'var(--accent-cyan)', borderRadius: 3, height: `${(d.calls / max) * 100}%`, opacity: 0.9 }} />
            <div style={{ flex: 1, background: 'var(--accent-green-soft)', border: '1px solid var(--accent-green)', borderRadius: 3, height: `${(d.csat / 100) * 100}%` }} />
          </div>
          <div className="muted mono" style={{ fontSize: 10.5 }}>{d.d}</div>
        </div>
      ))}
    </div>
  );
}

function SupervisorDashSections({ setRoute }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Colas en tiempo real</div>
            <button className="btn btn--ghost btn--sm" onClick={() => setRoute('queue')}>Abrir supervisión <Icon.ChevRight style={{ width: 12, height: 12 }} /></button>
          </div>
          <div className="card__body card__body--flush">
            {DATA.QUEUES.map(q => (
              <div key={q.id} className={`queue-row ${q.status === 'alert' ? 'queue-row--alert' : q.status === 'warn' ? 'queue-row--warn' : ''}`}>
                <ChannelChip type={q.channel} />
                <div className="grow truncate">{q.name}</div>
                <div className="mono col-num"><span className="muted" style={{ fontSize: 11 }}>cola </span>{q.inQueue}</div>
                <div className="mono col-num"><span className="muted" style={{ fontSize: 11 }}>SLA </span>{q.sla}%</div>
                <div className="mono col-num"><span className="muted" style={{ fontSize: 11 }}>esp </span>{Math.floor(q.longest / 60)}:{String(q.longest % 60).padStart(2, '0')}</div>
                <div><StatusPill status={q.status === 'alert' ? 'En riesgo' : q.status === 'warn' ? 'Media' : 'OK'} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div className="card__title">Agentes que requieren atención</div>
            <span className="chip chip--red">{12} alertas</span>
          </div>
          <div className="card__body">
            <div className="col" style={{ gap: 8 }}>
              {[
                { name: 'Diego Paredes', team: 'Soporte L1', reason: 'AHT 8:01 — supera meta en 240%', sent: 'neg', icon: 'aht' },
                { name: 'Renata Castro', team: 'Soporte L1', reason: 'Break extendido (06:33 / 5min)', sent: 'neu', icon: 'break' },
                { name: 'Sofía Aguilar', team: 'Soporte L2', reason: 'Sentiment negativo en llamada actual', sent: 'neg', icon: 'sent' },
                { name: 'Joaquín Mora', team: 'Soporte L1', reason: 'No conectado — turno empezó hace 12m', sent: 'neg', icon: 'off' },
              ].map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'var(--bg-2)', borderRadius: 8 }}>
                  <Avatar name={a.name} />
                  <div className="grow">
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{a.team} · {a.reason}</div>
                  </div>
                  <button className="btn btn--sm"><Icon.Eye style={{ width: 12, height: 12 }} /> Whisper</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="card">
        <div className="card__head">
          <div className="card__title">Volumen de contactos · últimas 4 horas</div>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip chip--cyan"><span className="dot" /> Voz</span>
            <span className="chip chip--violet"><span className="dot" /> Digital</span>
            <span className="chip chip--green"><span className="dot" /> Resuelto FCR</span>
          </div>
        </div>
        <div className="card__body">
          <VolumeChart />
        </div>
      </div>
    </>
  );
}

function VolumeChart() {
  const pts = 48;
  const voice = Array.from({ length: pts }, (_, i) => 40 + Math.sin(i / 4) * 12 + Math.random() * 8);
  const digi  = Array.from({ length: pts }, (_, i) => 28 + Math.cos(i / 5) * 10 + Math.random() * 6);
  const fcr   = voice.map((v, i) => (v + digi[i]) * 0.78);
  const W = 1000, H = 200;
  const max = Math.max(...voice, ...digi, ...fcr) * 1.1;
  const toPath = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i / (pts - 1)) * W} ${H - (v / max) * H}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 200 }}>
        {[0.25, 0.5, 0.75].map(p => <line key={p} x1="0" y1={H * p} x2={W} y2={H * p} stroke="var(--border-1)" strokeDasharray="2 4" />)}
        <path d={`${toPath(voice)} L ${W} ${H} L 0 ${H} Z`} fill="var(--accent-cyan-soft)" />
        <path d={toPath(voice)} fill="none" stroke="var(--accent-cyan)" strokeWidth="1.5" />
        <path d={toPath(digi)} fill="none" stroke="var(--accent-violet)" strokeWidth="1.5" />
        <path d={toPath(fcr)} fill="none" stroke="var(--accent-green)" strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        {['11:00','12:00','13:00','14:00','15:00'].map(t => <span key={t} className="muted mono" style={{ fontSize: 10.5 }}>{t}</span>)}
      </div>
    </div>
  );
}

function ManagerDashSections({ setRoute }) {
  return (
    <>
      <div className="grid-2">
        <div className="card">
          <div className="card__head">
            <div className="card__title">Volumen de contactos · 30 días</div>
            <span className="chip chip--green"><Icon.ArrowUp style={{ width: 11, height: 11 }} /> +12.4%</span>
          </div>
          <div className="card__body">
            <VolumeChart />
          </div>
        </div>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Resumen por canal</div>
          </div>
          <div className="card__body">
            <div className="col" style={{ gap: 14 }}>
              {[
                { type: 'voice', label: 'Voz', value: '82.4k', share: 45, color: 'var(--accent-green)' },
                { type: 'wa',    label: 'WhatsApp', value: '48.1k', share: 26, color: '#1FAE6C' },
                { type: 'chat',  label: 'Chat web', value: '28.9k', share: 16, color: 'var(--accent-cyan)' },
                { type: 'email', label: 'Email', value: '16.4k', share: 9,  color: 'var(--accent-amber)' },
                { type: 'sms',   label: 'SMS',   value: '8.4k',  share: 4,  color: 'var(--accent-violet)' },
              ].map(r => (
                <div key={r.type}>
                  <div className="spread" style={{ marginBottom: 6 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <ChannelChip type={r.type} />
                      <span style={{ fontSize: 13 }}>{r.label}</span>
                    </div>
                    <div className="mono"><span>{r.value}</span> <span className="muted" style={{ fontSize: 11 }}>{r.share}%</span></div>
                  </div>
                  <div className="bar"><div style={{ width: `${r.share * 2}%`, background: r.color }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="grid-3">
        <div className="card">
          <div className="card__head"><div className="card__title">Top campañas activas</div></div>
          <div className="card__body card__body--flush">
            {DATA.CAMPAIGNS.slice(0, 4).map(c => (
              <div key={c.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <ChannelChip type={c.channel} />
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{c.name}</span>
                  </div>
                  <span className="mono" style={{ fontSize: 11.5 }}>{c.conversion}%</span>
                </div>
                <div className="bar"><div style={{ width: `${c.progress}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card__head"><div className="card__title">Equipos por rendimiento</div></div>
          <div className="card__body">
            <div className="col" style={{ gap: 10 }}>
              {[
                { name: 'Retención',  csat: 94, color: 'var(--accent-green)' },
                { name: 'Ventas',     csat: 89, color: 'var(--accent-cyan)' },
                { name: 'Soporte L2', csat: 91, color: 'var(--accent-violet)' },
                { name: 'Soporte L1', csat: 76, color: 'var(--accent-amber)' },
                { name: 'Cobranza',   csat: 82, color: 'var(--accent-pink)' },
              ].map(t => (
                <div key={t.name}>
                  <div className="spread"><span style={{ fontSize: 13 }}>{t.name}</span><span className="mono">{t.csat}</span></div>
                  <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${t.csat}%`, background: t.color }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><div className="card__title">IA · Insights de la semana</div></div>
          <div className="card__body">
            <div className="col" style={{ gap: 12 }}>
              {[
                { ic: Icon.Sparkles, title: 'Pico de "demora en envío"', body: '+38% menciones esta semana — concentrado en cuenta enterprise Nordal Logistics.' },
                { ic: Icon.Shield, title: 'Riesgo de churn detectado', body: '14 clientes con sentiment ≤ -0.4 en últimas 2 interacciones.' },
                { ic: Icon.Lightning, title: 'Oportunidad de upsell', body: '62 cuentas con uso de API >85% del plan actual.' },
              ].map((it, i) => {
                const Icn = it.ic;
                return (
                  <div key={i} style={{ display: 'flex', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-violet-soft)', color: 'var(--accent-violet)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icn style={{ width: 14, height: 14 }} /></div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{it.title}</div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{it.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

window.Dashboard = Dashboard;
