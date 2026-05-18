/* global React, Icon, Avatar, ChannelChip, StatusPill, DATA */
const { useState } = React;

function Cases() {
  const [filter, setFilter] = useState('Todos');
  const filtered = DATA.CASES.filter(c => filter === 'Todos' || c.status === filter);
  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Clientes</span></div>
          <h1 className="view__title">Casos</h1>
          <div className="view__sub">24 abiertos · 8 en riesgo de SLA · 3 críticos</div>
        </div>
        <div className="view__actions">
          <button className="btn"><Icon.Filter style={{ width: 14, height: 14 }} /> Filtros</button>
          <button className="btn"><Icon.Workflow style={{ width: 14, height: 14 }} /> Automatizaciones</button>
          <button className="btn btn--primary"><Icon.Plus style={{ width: 14, height: 14 }} /> Nuevo caso</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi__label">Tiempo de primera respuesta</div><div className="kpi__value">2:14</div><div className="kpi__delta kpi__delta--down">−18s vs ayer</div></div>
        <div className="kpi"><div className="kpi__label">Tiempo de resolución</div><div className="kpi__value">4h 22m</div><div className="kpi__delta kpi__delta--down">−12% vs meta</div></div>
        <div className="kpi"><div className="kpi__label">FCR · primera resolución</div><div className="kpi__value">68%</div><div className="kpi__delta kpi__delta--up">+4 pts</div></div>
        <div className="kpi"><div className="kpi__label">Casos por agente</div><div className="kpi__value">6.4</div><div className="kpi__delta kpi__delta--flat">Estable</div></div>
      </div>

      <div style={{ height: 16 }} />

      <div className="card">
        <div className="card__head">
          <div className="row" style={{ gap: 6 }}>
            {['Todos','Abierto','En proceso','Esperando cliente','Resuelto'].map(f => (
              <button key={f} className={`btn btn--sm ${filter === f ? '' : 'btn--ghost'}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto' }} className="muted" style={{ fontSize: 11.5 }}>{filtered.length} casos</div>
        </div>
        <div className="card__body card__body--flush">
          <table className="t">
            <thead>
              <tr><th></th><th>Caso</th><th>Asunto</th><th>Contacto</th><th>Prioridad</th><th>Estado</th><th>SLA</th><th>Owner</th><th>Antigüedad</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td style={{ width: 28 }}><ChannelChip type={c.channel} /></td>
                  <td className="mono col-muted">{c.id}</td>
                  <td><div style={{ maxWidth: 420 }} className="truncate">{c.subject}</div></td>
                  <td>{c.contact}</td>
                  <td><StatusPill status={c.priority} /></td>
                  <td><StatusPill status={c.status} /></td>
                  <td><StatusPill status={c.sla.startsWith('Vence') ? 'En riesgo' : c.sla.includes('riesgo') ? 'En riesgo' : 'OK'} /></td>
                  <td><Avatar name={c.owner} size="sm" /></td>
                  <td className="col-num col-muted">{c.age}</td>
                  <td><button className="btn btn--ghost btn--sm btn--icon"><Icon.More style={{ width: 14, height: 14 }} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Campaigns() {
  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Crecimiento</span></div>
          <h1 className="view__title">Campañas outbound</h1>
          <div className="view__sub">5 activas · 14.2k contactos alcanzados hoy</div>
        </div>
        <div className="view__actions">
          <button className="btn"><Icon.Megaphone style={{ width: 14, height: 14 }} /> Plantillas</button>
          <button className="btn btn--primary"><Icon.Plus style={{ width: 14, height: 14 }} /> Nueva campaña</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi__label">Alcance hoy</div><div className="kpi__value">14,284</div><div className="kpi__delta kpi__delta--up">+22% vs ayer</div></div>
        <div className="kpi"><div className="kpi__label">Conversión promedio</div><div className="kpi__value">15.8%</div><div className="kpi__delta kpi__delta--up">+1.4 pts</div></div>
        <div className="kpi"><div className="kpi__label">Costo por contacto</div><div className="kpi__value">$0.18</div><div className="kpi__delta kpi__delta--down">−6%</div></div>
        <div className="kpi"><div className="kpi__label">Opt-out</div><div className="kpi__value">0.42%</div><div className="kpi__delta kpi__delta--flat">Saludable</div></div>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card__head"><div className="card__title">Campañas activas</div></div>
          <div className="card__body card__body--flush">
            {DATA.CAMPAIGNS.map(c => (
              <div key={c.id} style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-1)' }}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <ChannelChip type={c.channel} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name}</div>
                      <div className="muted mono" style={{ fontSize: 11 }}>{c.id} · owner <Avatar name={c.owner} size="sm" /></div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 12 }}>
                    <StatusPill status={c.status} />
                    <button className="btn btn--ghost btn--sm btn--icon"><Icon.More style={{ width: 14, height: 14 }} /></button>
                  </div>
                </div>
                <div className="bar"><div style={{ width: `${c.progress}%`, background: c.status === 'Pausada' ? 'var(--accent-amber)' : 'var(--accent-cyan)' }} /></div>
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, fontSize: 11.5 }}>
                  <span className="muted">Alcanzados <span className="mono" style={{ color: 'var(--text-1)' }}>{c.reached.toLocaleString()}</span> / {c.total.toLocaleString()}</span>
                  <span className="muted">Conversión <span className="mono" style={{ color: 'var(--accent-green)' }}>{c.conversion}%</span></span>
                  <span className="muted">Restante <span className="mono" style={{ color: 'var(--text-1)' }}>{(c.total - c.reached).toLocaleString()}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head"><div className="card__title">Listas de contactos</div></div>
          <div className="card__body">
            <div className="col" style={{ gap: 8 }}>
              {[
                { name: 'Cuentas Enterprise activas', count: 1284, color: 'var(--accent-violet)' },
                { name: 'Carrito abandonado 7d',       count: 9560, color: 'var(--accent-cyan)' },
                { name: 'Trial expirando esta semana', count: 442,  color: 'var(--accent-amber)' },
                { name: 'Sin actividad 30d',           count: 2120, color: 'var(--accent-pink)' },
                { name: 'NPS promotores',              count: 1840, color: 'var(--accent-green)' },
              ].map(l => (
                <div key={l.name} className="row" style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 6 }}>
                  <div style={{ width: 4, height: 28, background: l.color, borderRadius: 999 }} />
                  <div className="grow">
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{l.name}</div>
                    <div className="mono muted" style={{ fontSize: 11 }}>{l.count.toLocaleString()} contactos</div>
                  </div>
                  <button className="btn btn--ghost btn--sm">Usar</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Workflows() {
  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Crecimiento</span></div>
          <h1 className="view__title">Workflows · Automatizaciones</h1>
          <div className="view__sub">6 flujos · 26,832 ejecuciones esta semana</div>
        </div>
        <div className="view__actions">
          <button className="btn"><Icon.Knowledge style={{ width: 14, height: 14 }} /> Plantillas</button>
          <button className="btn btn--primary"><Icon.Plus style={{ width: 14, height: 14 }} /> Crear workflow</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><div className="card__title">Editor visual · "Routing inteligente · Soporte"</div><span className="chip chip--green"><span className="dot" /> Activo</span></div>
        <div className="card__body">
          <WorkflowCanvas />
        </div>
      </div>

      <div className="card">
        <div className="card__head"><div className="card__title">Todos los workflows</div></div>
        <div className="card__body card__body--flush">
          <table className="t">
            <thead><tr><th>Workflow</th><th>Trigger</th><th>Ejecuciones</th><th>Éxito</th><th>Última corrida</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {DATA.WORKFLOWS.map(w => (
                <tr key={w.id}>
                  <td style={{ fontWeight: 500 }}>{w.name}</td>
                  <td className="col-muted">{w.trigger}</td>
                  <td className="col-num">{w.runs.toLocaleString()}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <div style={{ width: 50, height: 5, background: 'var(--bg-3)', borderRadius: 999 }}>
                        <div style={{ width: `${w.success}%`, height: '100%', background: 'var(--accent-green)', borderRadius: 999 }} />
                      </div>
                      <span className="mono" style={{ fontSize: 11.5 }}>{w.success}%</span>
                    </div>
                  </td>
                  <td className="col-muted">{w.lastRun}</td>
                  <td><StatusPill status={w.status} /></td>
                  <td><button className="btn btn--ghost btn--sm btn--icon"><Icon.More style={{ width: 14, height: 14 }} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WorkflowCanvas() {
  const nodes = [
    { x: 40,  y: 70,  w: 150, h: 64, kind: 'trigger', title: 'Llamada entrante',  sub: 'Cualquier cola', icon: Icon.PhoneIn, color: 'var(--accent-green)' },
    { x: 240, y: 70,  w: 170, h: 64, kind: 'logic',   title: 'Identificar contacto', sub: 'Lookup por número', icon: Icon.Search, color: 'var(--accent-cyan)' },
    { x: 460, y: 10,  w: 180, h: 60, kind: 'branch',  title: 'Cliente Enterprise', sub: 'Si ARR > $100k', icon: Icon.Star, color: 'var(--accent-violet)' },
    { x: 460, y: 130, w: 180, h: 60, kind: 'branch',  title: 'Otro segmento', sub: 'SMB / Mid-Market', icon: Icon.Users, color: 'var(--accent-amber)' },
    { x: 690, y: 10,  w: 180, h: 60, kind: 'action',  title: 'Ruta a Equipo VIP', sub: 'Cola Retención prioritaria', icon: Icon.Flag, color: 'var(--accent-violet)' },
    { x: 690, y: 130, w: 180, h: 60, kind: 'action',  title: 'Ruta a Soporte L1', sub: 'Round-robin', icon: Icon.Users, color: 'var(--accent-amber)' },
    { x: 920, y: 70,  w: 160, h: 64, kind: 'end',     title: 'Log + Telemetría', sub: 'CloudWatch', icon: Icon.Check, color: 'var(--accent-green)' },
  ];
  const links = [
    [0, 1], [1, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 6],
  ];
  return (
    <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: 24, position: 'relative', height: 240, overflowX: 'auto' }}>
      <svg width="1100" height="220" style={{ display: 'block' }}>
        {/* grid */}
        <defs>
          <pattern id="wfgrid" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--border-1)" />
          </pattern>
        </defs>
        <rect width="1100" height="220" fill="url(#wfgrid)" />
        {links.map(([a, b], i) => {
          const A = nodes[a], B = nodes[b];
          const x1 = A.x + A.w, y1 = A.y + A.h / 2;
          const x2 = B.x,        y2 = B.y + B.h / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} stroke="var(--border-strong)" strokeWidth="1.5" fill="none" />
          );
        })}
        {nodes.map((n, i) => {
          const Icn = n.icon;
          return (
            <g key={i} transform={`translate(${n.x} ${n.y})`}>
              <rect width={n.w} height={n.h} rx="8" fill="var(--bg-1)" stroke={n.color} strokeWidth="1" />
              <foreignObject x="0" y="0" width={n.w} height={n.h}>
                <div xmlns="http://www.w3.org/1999/xhtml" style={{ display: 'flex', gap: 10, padding: 10, alignItems: 'center', height: '100%' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: n.color, color: '#0B0F1A', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icn style={{ width: 14, height: 14 }} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-1)' }}>{n.title}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{n.sub}</div>
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Reports() {
  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Crecimiento</span></div>
          <h1 className="view__title">Reportes</h1>
          <div className="view__sub">Periodo · últimos 30 días · 12 dashboards guardados</div>
        </div>
        <div className="view__actions">
          <button className="btn"><Icon.Calendar style={{ width: 14, height: 14 }} /> 01 Abr — 30 Abr</button>
          <button className="btn">Exportar</button>
          <button className="btn btn--primary"><Icon.Plus style={{ width: 14, height: 14 }} /> Nuevo dashboard</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi__label">Volumen total</div><div className="kpi__value">184.2k</div><div className="kpi__delta kpi__delta--up">+12.4% MoM</div></div>
        <div className="kpi"><div className="kpi__label">AHT promedio</div><div className="kpi__value">4:38</div><div className="kpi__delta kpi__delta--down">−14s</div></div>
        <div className="kpi"><div className="kpi__label">CSAT</div><div className="kpi__value">89%</div><div className="kpi__delta kpi__delta--up">+2 pts</div></div>
        <div className="kpi"><div className="kpi__label">FCR</div><div className="kpi__value">68%</div><div className="kpi__delta kpi__delta--up">+4 pts</div></div>
      </div>

      <div style={{ height: 16 }} />

      <div className="grid-2">
        <div className="card">
          <div className="card__head"><div className="card__title">Volumen por canal</div></div>
          <div className="card__body"><BigStackChart /></div>
        </div>
        <div className="card">
          <div className="card__head"><div className="card__title">Distribución de AHT</div></div>
          <div className="card__body"><AHTHistogram /></div>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="grid-3">
        <div className="card">
          <div className="card__head"><div className="card__title">Top motivos de contacto</div></div>
          <div className="card__body">
            <div className="col" style={{ gap: 8 }}>
              {[
                { name: 'Facturación / cobros',  pct: 24 },
                { name: 'Estado de envío',       pct: 18 },
                { name: 'Soporte técnico API',   pct: 16 },
                { name: 'Cambios de plan',        pct: 12 },
                { name: 'Reclamos',               pct: 10 },
                { name: 'Otros',                  pct: 20 },
              ].map(r => (
                <div key={r.name}>
                  <div className="spread" style={{ fontSize: 12.5 }}><span>{r.name}</span><span className="mono">{r.pct}%</span></div>
                  <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${r.pct * 3.5}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><div className="card__title">Top agentes · CSAT</div></div>
          <div className="card__body">
            <div className="col" style={{ gap: 8 }}>
              {DATA.AGENTS.slice(0, 6).map((a, i) => (
                <div key={a.id} className="row" style={{ padding: '4px 0' }}>
                  <span className="muted mono" style={{ width: 16 }}>{i + 1}</span>
                  <Avatar name={a.name} color={a.color} size="sm" />
                  <span style={{ flex: 1, fontSize: 12.5 }}>{a.name}</span>
                  <span className="mono">{(95 - i * 1.4).toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><div className="card__title">Heatmap · llamadas por hora</div></div>
          <div className="card__body"><CallHeatmap /></div>
        </div>
      </div>
    </div>
  );
}

function BigStackChart() {
  const days = 30;
  const W = 700, H = 200;
  const data = Array.from({ length: days }, (_, i) => ({
    voice: 60 + Math.sin(i / 3) * 12 + Math.random() * 10,
    wa: 30 + Math.cos(i / 4) * 8 + Math.random() * 5,
    chat: 20 + Math.sin(i / 5) * 4 + Math.random() * 3,
    email: 10 + Math.cos(i / 6) * 3 + Math.random() * 2,
  }));
  const max = 130;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }}>
        {data.map((d, i) => {
          const x = (i / days) * W;
          const bw = W / days - 2;
          let y = H;
          const segs = [
            { v: d.voice, c: 'var(--accent-cyan)' },
            { v: d.wa,    c: '#1FAE6C' },
            { v: d.chat,  c: 'var(--accent-violet)' },
            { v: d.email, c: 'var(--accent-amber)' },
          ];
          return (
            <g key={i}>
              {segs.map((s, j) => {
                const h = (s.v / max) * H;
                y -= h;
                return <rect key={j} x={x} y={y} width={bw} height={h} fill={s.c} opacity={0.85} rx="1" />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 11 }}>
        <span><span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--accent-cyan)', marginRight: 4 }} />Voz</span>
        <span><span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#1FAE6C', marginRight: 4 }} />WhatsApp</span>
        <span><span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--accent-violet)', marginRight: 4 }} />Chat</span>
        <span><span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--accent-amber)', marginRight: 4 }} />Email</span>
      </div>
    </div>
  );
}

function AHTHistogram() {
  const buckets = [3, 8, 14, 22, 28, 24, 18, 12, 6, 3, 2];
  const labels  = ['0-1','1-2','2-3','3-4','4-5','5-6','6-7','7-8','8-9','9-10','10+'];
  const max = Math.max(...buckets);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }}>
        {buckets.map((b, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span className="mono muted" style={{ fontSize: 10 }}>{b}</span>
            <div style={{ width: '100%', height: `${(b / max) * 120}px`, background: i >= 3 && i <= 5 ? 'var(--accent-cyan)' : 'var(--bg-3)', borderRadius: 3 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {labels.map(l => <span key={l} className="muted mono" style={{ fontSize: 10, flex: 1, textAlign: 'center' }}>{l}</span>)}
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Mediana: <span className="mono" style={{ color: 'var(--text-1)' }}>4:38</span> · p90: <span className="mono" style={{ color: 'var(--text-1)' }}>7:12</span></div>
    </div>
  );
}

function CallHeatmap() {
  const rows = 5; const cols = 12;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 3 }}>
      {Array.from({ length: rows * cols }).map((_, i) => {
        const v = Math.random();
        const col = i % cols;
        const peak = col >= 3 && col <= 8 ? 1.6 : 1;
        const intensity = Math.min(1, v * peak);
        return <div key={i} style={{ height: 22, background: 'var(--accent-cyan)', opacity: 0.12 + intensity * 0.75, borderRadius: 2 }} title={`Vol ${(intensity * 100).toFixed(0)}`} />;
      })}
    </div>
  );
}

Object.assign(window, { Cases, Campaigns, Workflows, Reports });
