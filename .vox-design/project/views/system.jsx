/* global React, Icon, Avatar, ChannelChip, StatusPill */
const { useState, useEffect, useRef } = React;

/* ============================================================
   Knowledge · Q
   ============================================================ */

const KB_ARTICLES = [
  { id: 'kb-101', cat: 'Facturación', title: 'Política de compensación por demoras', updated: 'Hace 4d', views: 1284, helpful: 92, owner: 'CR' },
  { id: 'kb-87',  cat: 'Logística',   title: 'Trazabilidad para envíos internacionales', updated: 'Hace 1d', views: 940, helpful: 88, owner: 'SA' },
  { id: 'kb-72',  cat: 'Soporte',     title: 'Escalado prioritario para clientes Enterprise', updated: 'Hace 2sem', views: 612, helpful: 95, owner: 'LO' },
  { id: 'kb-65',  cat: 'API',         title: 'Integración API v3 — guía de migración', updated: 'Hace 3d', views: 2480, helpful: 90, owner: 'TH' },
  { id: 'kb-44',  cat: 'Cobranza',    title: 'Procedimiento de reactivación tras impago', updated: 'Hace 1sem', views: 412, helpful: 78, owner: 'IB' },
  { id: 'kb-38',  cat: 'Facturación', title: 'Cómo aplicar créditos manuales en cuenta', updated: 'Hace 6d', views: 884, helpful: 87, owner: 'CR' },
  { id: 'kb-22',  cat: 'Soporte',     title: 'Restablecimiento de OTP en clientes B2B', updated: 'Hace 1d', views: 1480, helpful: 91, owner: 'MS' },
  { id: 'kb-11',  cat: 'Producto',    title: 'Activación del módulo de reportes avanzados', updated: 'Hace 5d', views: 720, helpful: 89, owner: 'LO' },
];

const Q_THREAD_SCRIPT = [
  { who: 'agent', text: '¿Cuál es la política para clientes Enterprise que reportan demoras en envíos internacionales?' },
  { who: 'q', text: 'Para clientes Enterprise con retrasos en envíos internacionales superiores a 48 horas, se aplica el crédito automático **CRED-LATE-08** (8% sobre el valor del envío). Si el retraso supera 5 días, escala al equipo de Customer Success con prioridad alta.', sources: ['kb-101', 'kb-72'] },
  { who: 'agent', text: '¿Y si el cliente ya recibió compensación en los últimos 60 días?' },
  { who: 'q', text: 'En ese caso, el crédito requiere aprobación manual del CSM asignado. El sistema bloquea aplicaciones duplicadas automáticas dentro de 60 días, pero puedes registrar la solicitud y notificar al CSM por correo o WhatsApp.', sources: ['kb-101'] },
];

function Knowledge() {
  const [tab, setTab] = useState('q');
  const [search, setSearch] = useState('');
  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Sistema</span></div>
          <h1 className="view__title">Knowledge · Q</h1>
          <div className="view__sub">Base de conocimiento entrenada · 248 artículos · IA generativa contextual</div>
        </div>
        <div className="view__actions">
          <button className="btn"><Icon.Refresh style={{ width: 14, height: 14 }} /> Re-indexar</button>
          <button className="btn"><Icon.Sparkles style={{ width: 14, height: 14 }} /> Entrenar con datos</button>
          <button className="btn btn--primary"><Icon.Plus style={{ width: 14, height: 14 }} /> Nuevo artículo</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi__label">Consultas a Q hoy</div><div className="kpi__value">3,284</div><div className="kpi__delta kpi__delta--up">+18% vs ayer</div></div>
        <div className="kpi"><div className="kpi__label">Respuestas útiles</div><div className="kpi__value">91%</div><div className="kpi__delta kpi__delta--up">+2 pts</div></div>
        <div className="kpi"><div className="kpi__label">Tiempo ahorrado / agente</div><div className="kpi__value">38m</div><div className="kpi__delta kpi__delta--up">por turno</div></div>
        <div className="kpi"><div className="kpi__label">Artículos vigentes</div><div className="kpi__value">248</div><div className="kpi__delta kpi__delta--flat">12 sin revisar</div></div>
      </div>

      <div style={{ height: 16 }} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="tabs" style={{ padding: '0 18px' }}>
          {[
            { id: 'q', label: 'Pregúntale a Q' },
            { id: 'kb', label: 'Artículos', n: KB_ARTICLES.length },
            { id: 'training', label: 'Entrenamiento' },
            { id: 'usage', label: 'Uso de IA' },
          ].map(t => (
            <div key={t.id} className={`tabs__tab ${tab === t.id ? 'tabs__tab--active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}{t.n != null && <span className="count">{t.n}</span>}
            </div>
          ))}
        </div>
        <div style={{ padding: 0 }}>
          {tab === 'q' && <QChat />}
          {tab === 'kb' && <KbList search={search} setSearch={setSearch} />}
          {tab === 'training' && <Training />}
          {tab === 'usage' && <Usage />}
        </div>
      </div>
    </div>
  );
}

function QChat() {
  const [thread, setThread] = useState(Q_THREAD_SCRIPT.slice(0, 2));
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [thread, thinking]);

  const send = () => {
    if (!input.trim()) return;
    const next = thread.length;
    setThread(t => [...t, { who: 'agent', text: input }]);
    setInput('');
    setThinking(true);
    setTimeout(() => {
      const scripted = Q_THREAD_SCRIPT[next + 1];
      setThread(t => [...t, scripted || { who: 'q', text: 'Encontré 3 artículos relacionados. ¿Quieres que te muestre el resumen del más relevante?', sources: ['kb-101'] }]);
      setThinking(false);
    }, 1400);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', minHeight: 520 }}>
      <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-1)' }}>
        <div ref={bodyRef} style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {thread.map((m, i) => (
            <div key={i} className={`transcript__row transcript__row--${m.who === 'q' ? 'customer' : 'agent'}`}>
              {m.who === 'q' && (
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent-violet), var(--accent-pink))', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Icon.Sparkles style={{ width: 14, height: 14, color: 'white' }} />
                </div>
              )}
              {m.who === 'agent' && <Avatar name="Camila Reyes" color="#8B7EE8" size="sm" />}
              <div style={{ maxWidth: '78%' }}>
                <div className="transcript__bubble" style={m.who === 'q' ? { background: 'var(--accent-violet-soft)', color: 'var(--text-1)' } : null}>
                  <span dangerouslySetInnerHTML={{ __html: m.text.replace(/\*\*(.+?)\*\*/g, '<strong style="font-family:var(--font-mono);font-size:12px;background:var(--bg-3);padding:1px 5px;border-radius:3px;">$1</strong>') }} />
                </div>
                {m.sources && (
                  <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                    {m.sources.map(s => {
                      const a = KB_ARTICLES.find(x => x.id === s);
                      return a ? <span key={s} className="chip chip--violet" style={{ fontSize: 10.5 }}><Icon.Knowledge style={{ width: 10, height: 10 }} /> {a.id} · {a.title}</span> : null;
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="transcript__row transcript__row--customer">
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent-violet), var(--accent-pink))', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon.Sparkles style={{ width: 14, height: 14, color: 'white' }} />
              </div>
              <div className="transcript__typing"><span /><span /><span /></div>
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--border-1)', padding: 14 }}>
          <div className="row" style={{ background: 'var(--bg-2)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '8px 10px' }}>
            <Icon.Sparkles style={{ width: 14, height: 14, color: 'var(--accent-violet)' }} />
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Pregúntale a Q sobre cualquier proceso, política, o cliente…"
              style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', fontSize: 13, color: 'var(--text-1)' }} />
            <button className="btn btn--primary btn--sm" onClick={send}><Icon.Send style={{ width: 12, height: 12 }} /> Enviar</button>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {[
              '¿Cómo activo el módulo de reportes?',
              'Política de cancelación premium',
              'Pasos para resetear OTP',
              'Diferencias entre planes Enterprise vs Mid-Market',
            ].map(s => (
              <button key={s} className="chip" onClick={() => setInput(s)}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <div className="section-title">Contexto activo</div>
        <div className="col" style={{ gap: 8 }}>
          <div style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8 }}>
            <div className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cliente</div>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <Avatar name="Ariadna Ferré" color="#22B8D9" size="sm" />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Ariadna Ferré</div>
                <div className="muted" style={{ fontSize: 11 }}>Nordal Logistics · Enterprise</div>
              </div>
            </div>
          </div>
          <div style={{ padding: 10, background: 'var(--bg-2)', borderRadius: 8 }}>
            <div className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Caso activo</div>
            <div style={{ fontSize: 12, marginTop: 6 }}><span className="mono muted">VX-4812</span> Reclamo por demora en envío internacional</div>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 18 }}>Artículos sugeridos</div>
        <div className="col" style={{ gap: 6 }}>
          {KB_ARTICLES.slice(0, 4).map(a => (
            <div key={a.id} style={{ padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 6, fontSize: 12 }}>
              <div className="muted mono" style={{ fontSize: 10.5 }}>{a.id}</div>
              <div className="truncate" style={{ marginTop: 2 }}>{a.title}</div>
            </div>
          ))}
        </div>

        <div className="section-title" style={{ marginTop: 18 }}>Ajustes de Q</div>
        <div className="col" style={{ gap: 8, fontSize: 12 }}>
          <label className="row"><input type="checkbox" defaultChecked /> <span>Incluir contexto del cliente</span></label>
          <label className="row"><input type="checkbox" defaultChecked /> <span>Citar fuentes en respuestas</span></label>
          <label className="row"><input type="checkbox" /> <span>Modo borrador (más creativo)</span></label>
        </div>
      </div>
    </div>
  );
}

function KbList({ search, setSearch }) {
  const filtered = KB_ARTICLES.filter(a => !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.cat.toLowerCase().includes(search.toLowerCase()));
  return (
    <div style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14, gap: 10 }}>
        <div className="tb__search" style={{ maxWidth: 360, height: 30 }}>
          <Icon.Search style={{ width: 13, height: 13 }} />
          <input placeholder="Buscar artículos…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="row" style={{ gap: 6 }}>
          {['Todos', 'Facturación', 'Logística', 'Soporte', 'API', 'Cobranza', 'Producto'].map(c => (
            <span key={c} className={`chip ${c === 'Todos' ? 'chip--cyan' : ''}`}>{c}</span>
          ))}
        </div>
      </div>
      <table className="t">
        <thead><tr><th>ID</th><th>Categoría</th><th>Título</th><th>Última actualización</th><th>Vistas</th><th>Útil</th><th>Owner</th><th></th></tr></thead>
        <tbody>
          {filtered.map(a => (
            <tr key={a.id}>
              <td className="mono col-muted">{a.id}</td>
              <td><span className="chip">{a.cat}</span></td>
              <td style={{ fontWeight: 500 }}>{a.title}</td>
              <td className="col-muted">{a.updated}</td>
              <td className="col-num mono">{a.views.toLocaleString()}</td>
              <td>
                <div className="row" style={{ gap: 6 }}>
                  <div style={{ width: 36, height: 5, background: 'var(--bg-3)', borderRadius: 999 }}>
                    <div style={{ width: `${a.helpful}%`, height: '100%', background: 'var(--accent-green)', borderRadius: 999 }} />
                  </div>
                  <span className="mono" style={{ fontSize: 11.5 }}>{a.helpful}%</span>
                </div>
              </td>
              <td><Avatar name={a.owner} size="sm" /></td>
              <td><button className="btn btn--ghost btn--sm btn--icon"><Icon.More style={{ width: 14, height: 14 }} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Training() {
  return (
    <div style={{ padding: 18 }}>
      <div className="grid-2">
        <div className="card">
          <div className="card__head"><div className="card__title">Fuentes conectadas</div><span className="chip chip--green">7 activas</span></div>
          <div className="card__body card__body--flush">
            {[
              { name: 'Confluence · Operaciones', size: '1,240 páginas', status: 'Sincronizado', sub: 'Hace 14m' },
              { name: 'Salesforce Knowledge',     size: '380 artículos',  status: 'Sincronizado', sub: 'Hace 2h' },
              { name: 'Zendesk Help Center',      size: '124 macros',     status: 'Sincronizando', sub: '38% — 4m restantes' },
              { name: 'Notion · Wiki Producto',   size: '512 docs',       status: 'Sincronizado', sub: 'Hace 1d' },
              { name: 'Drive · Procedimientos',   size: '88 archivos',    status: 'Sincronizado', sub: 'Hace 3d' },
              { name: 'S3 · Transcripciones',     size: '14k archivos',   status: 'Continuo',     sub: 'Stream activo' },
              { name: 'API · CRM datos',          size: 'Tiempo real',    status: 'Continuo',     sub: 'Stream activo' },
            ].map(s => (
              <div key={s.name} className="spread" style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-1)' }}>
                <div className="row" style={{ gap: 10 }}>
                  <Icon.Knowledge style={{ width: 18, height: 18, color: 'var(--accent-cyan)' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{s.size} · {s.sub}</div>
                  </div>
                </div>
                <StatusPill status={s.status === 'Sincronizado' ? 'OK' : s.status === 'Continuo' ? 'En curso' : 'En proceso'} />
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card__head"><div className="card__title">Calidad del modelo</div></div>
          <div className="card__body">
            <div className="col" style={{ gap: 14 }}>
              {[
                { label: 'Precisión de respuesta',   v: 92, c: 'var(--accent-green)' },
                { label: 'Citación correcta',        v: 88, c: 'var(--accent-cyan)' },
                { label: 'Confianza promedio',       v: 84, c: 'var(--accent-violet)' },
                { label: 'Alucinaciones detectadas', v: 4,  c: 'var(--accent-red)' },
              ].map(m => (
                <div key={m.label}>
                  <div className="spread"><span style={{ fontSize: 12.5 }}>{m.label}</span><span className="mono">{m.v}%</span></div>
                  <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${m.v}%`, background: m.c }} /></div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <div style={{ padding: 12, background: 'var(--accent-violet-soft)', borderRadius: 8 }}>
              <div className="row" style={{ gap: 8, color: 'var(--accent-violet)', fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>
                <Icon.Sparkles style={{ width: 14, height: 14 }} /> Próxima sesión de entrenamiento
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>El modelo se re-entrena automáticamente cada domingo a las 02:00 con las transcripciones revisadas de la semana.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Usage() {
  return (
    <div style={{ padding: 18 }}>
      <div className="kpi-grid">
        <div className="kpi"><div className="kpi__label">Consultas mes</div><div className="kpi__value">84,212</div><div className="kpi__delta kpi__delta--up">+22% vs mes anterior</div></div>
        <div className="kpi"><div className="kpi__label">Tokens consumidos</div><div className="kpi__value">12.4M</div><div className="kpi__delta kpi__delta--up">+18%</div></div>
        <div className="kpi"><div className="kpi__label">Latencia p50</div><div className="kpi__value">680ms</div><div className="kpi__delta kpi__delta--down">−40ms</div></div>
        <div className="kpi"><div className="kpi__label">Costo por consulta</div><div className="kpi__value">$0.004</div><div className="kpi__delta kpi__delta--flat">Estable</div></div>
      </div>
      <div style={{ height: 16 }} />
      <div className="grid-2">
        <div className="card">
          <div className="card__head"><div className="card__title">Top temas consultados</div></div>
          <div className="card__body">
            <div className="col" style={{ gap: 10 }}>
              {[
                { t: 'Política de compensación',          n: 1842, pct: 84 },
                { t: 'Trazabilidad de envíos',            n: 1284, pct: 62 },
                { t: 'Activación de módulos',              n: 940,  pct: 48 },
                { t: 'Integración API',                    n: 712,  pct: 36 },
                { t: 'Procesos de cancelación',            n: 488,  pct: 24 },
              ].map(r => (
                <div key={r.t}>
                  <div className="spread"><span style={{ fontSize: 12.5 }}>{r.t}</span><span className="mono">{r.n.toLocaleString()}</span></div>
                  <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${r.pct}%`, background: 'var(--accent-violet)' }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><div className="card__title">Agentes que más usan Q</div></div>
          <div className="card__body">
            <div className="col" style={{ gap: 8 }}>
              {[
                { name: 'Sofía Aguilar', n: 482, color: '#22B8D9' },
                { name: 'Lucía Ortega',  n: 418, color: '#E879A6' },
                { name: 'Camila Reyes',  n: 392, color: '#8B7EE8' },
                { name: 'Diego Paredes', n: 348, color: '#F5A524' },
                { name: 'Mateo Silva',   n: 312, color: '#22B8D9' },
                { name: 'Iván Beltrán',  n: 284, color: '#E5484D' },
              ].map((a, i) => (
                <div key={a.name} className="row" style={{ padding: '4px 0' }}>
                  <span className="muted mono" style={{ width: 16 }}>{i + 1}</span>
                  <Avatar name={a.name} color={a.color} size="sm" />
                  <span style={{ flex: 1, fontSize: 12.5 }}>{a.name}</span>
                  <span className="mono">{a.n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Configuración (Settings)
   ============================================================ */

function Settings() {
  const [section, setSection] = useState('flows');
  const sections = [
    { id: 'profile',  label: 'Perfil',         icon: Icon.User },
    { id: 'flows',    label: 'Flujos IVR',     icon: Icon.Workflow },
    { id: 'channels', label: 'Canales',        icon: Icon.Globe },
    { id: 'queues',   label: 'Colas',          icon: Icon.Queue },
    { id: 'users',    label: 'Usuarios y roles', icon: Icon.Users },
    { id: 'integrations', label: 'Integraciones', icon: Icon.Lightning },
    { id: 'ai',       label: 'IA y Contact Lens', icon: Icon.Sparkles },
    { id: 'security', label: 'Seguridad',      icon: Icon.Shield },
    { id: 'billing',  label: 'Facturación',    icon: Icon.Tag },
  ];

  return (
    <div className="view" style={{ maxWidth: 1500 }}>
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Sistema</span></div>
          <h1 className="view__title">Configuración</h1>
          <div className="view__sub">Workspace: Vox CRM · Tenant: nordal-prod · Región: us-east-1</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18 }}>
        <div className="card" style={{ height: 'fit-content' }}>
          <div className="card__body" style={{ padding: 8 }}>
            {sections.map(s => {
              const Icn = s.icon;
              return (
                <div key={s.id} className={`sb__item ${section === s.id ? 'sb__item--active' : ''}`} onClick={() => setSection(s.id)} style={{ margin: 0 }}>
                  <Icn className="sb__icon" />
                  <div className="sb__label">{s.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          {section === 'flows' && <IVRFlows />}
          {section === 'channels' && <Channels />}
          {section === 'queues' && <QueuesConfig />}
          {section === 'users' && <UsersRoles />}
          {section === 'integrations' && <Integrations />}
          {section === 'ai' && <AISettings />}
          {section === 'security' && <Security />}
          {section === 'billing' && <Billing />}
          {section === 'profile' && <Profile />}
        </div>
      </div>
    </div>
  );
}

function IVRFlows() {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="card__head">
          <div className="card__title">Editor de flujo · "Routing de soporte L1"</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--sm">Versiones</button>
            <button className="btn btn--sm">Probar</button>
            <button className="btn btn--primary btn--sm">Publicar</button>
          </div>
        </div>
        <div className="card__body card__body--flush">
          <IVRCanvas />
        </div>
      </div>

      <div className="card">
        <div className="card__head"><div className="card__title">Todos los flujos IVR</div><button className="btn btn--primary btn--sm"><Icon.Plus style={{ width: 12, height: 12 }} /> Nuevo flujo</button></div>
        <div className="card__body card__body--flush">
          <table className="t">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Versión</th><th>Última edición</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {[
                { name: 'Routing de soporte L1', type: 'Contact Flow', ver: 'v12', last: 'Hoy 11:42', st: 'Activo' },
                { name: 'Menú principal IVR', type: 'Contact Flow', ver: 'v34', last: 'Ayer', st: 'Activo' },
                { name: 'Customer queue · Retención', type: 'Customer Queue', ver: 'v8', last: 'Hace 3d', st: 'Activo' },
                { name: 'Whisper · Identificación VIP', type: 'Agent Whisper', ver: 'v4', last: 'Hace 6d', st: 'Activo' },
                { name: 'Hold flow · música corporativa', type: 'Customer Hold', ver: 'v2', last: 'Hace 2sem', st: 'Activo' },
                { name: 'Transfer · Cobranza', type: 'Transfer', ver: 'v3', last: 'Hace 3sem', st: 'Pausado' },
              ].map((f, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{f.name}</td>
                  <td><span className="chip">{f.type}</span></td>
                  <td className="mono col-muted">{f.ver}</td>
                  <td className="col-muted">{f.last}</td>
                  <td><StatusPill status={f.st} /></td>
                  <td><button className="btn btn--ghost btn--sm">Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function IVRCanvas() {
  const nodes = [
    { x: 30,  y: 110, w: 130, h: 56, kind: 'entry',    title: 'Entrada',           sub: '+1 800 232 4848',     icon: Icon.PhoneIn, color: 'var(--accent-green)' },
    { x: 200, y: 110, w: 160, h: 56, kind: 'prompt',   title: 'Saludo de bienvenida', sub: 'TTS · ES Polly',    icon: Icon.Send,    color: 'var(--accent-cyan)' },
    { x: 400, y: 50,  w: 180, h: 64, kind: 'logic',    title: 'Lookup contacto',    sub: 'Por CLID → CRM',     icon: Icon.Search,  color: 'var(--accent-cyan)' },
    { x: 400, y: 160, w: 180, h: 64, kind: 'logic',    title: 'Menú IVR',           sub: 'Opciones 1, 2, 3',   icon: Icon.Pad,     color: 'var(--accent-cyan)' },
    { x: 620, y: 20,  w: 170, h: 56, kind: 'branch',   title: 'Cliente VIP',        sub: 'Si ARR > $100k',     icon: Icon.Star,    color: 'var(--accent-violet)' },
    { x: 620, y: 100, w: 170, h: 56, kind: 'branch',   title: 'Caso abierto',       sub: 'Si tiene activo',    icon: Icon.Ticket,  color: 'var(--accent-amber)' },
    { x: 620, y: 180, w: 170, h: 56, kind: 'branch',   title: 'Cliente nuevo',      sub: 'Sin historial',      icon: Icon.User,    color: 'var(--accent-pink)' },
    { x: 820, y: 20,  w: 160, h: 56, kind: 'action',   title: 'Cola VIP',           sub: 'Skill: enterprise',  icon: Icon.Flag,    color: 'var(--accent-violet)' },
    { x: 820, y: 100, w: 160, h: 56, kind: 'action',   title: 'Routing por skill',  sub: 'Por tipo de caso',   icon: Icon.Filter,  color: 'var(--accent-amber)' },
    { x: 820, y: 180, w: 160, h: 56, kind: 'action',   title: 'Cola Soporte L1',    sub: 'Round-robin',        icon: Icon.Users,   color: 'var(--accent-pink)' },
    { x: 1010, y: 100, w: 160, h: 56, kind: 'end',     title: 'Conectar agente',    sub: 'CTL + recording on', icon: Icon.Check,   color: 'var(--accent-green)' },
  ];
  const links = [
    [0, 1], [1, 2], [1, 3], [2, 4], [2, 5], [3, 6], [4, 7], [5, 8], [6, 9], [7, 10], [8, 10], [9, 10],
  ];
  return (
    <div style={{ background: 'var(--bg-2)', padding: 20, overflowX: 'auto' }}>
      <svg width="1200" height="280" style={{ display: 'block' }}>
        <defs>
          <pattern id="ivrgrid" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--border-1)" />
          </pattern>
        </defs>
        <rect width="1200" height="280" fill="url(#ivrgrid)" />
        {links.map(([a, b], i) => {
          const A = nodes[a], B = nodes[b];
          const x1 = A.x + A.w, y1 = A.y + A.h / 2;
          const x2 = B.x,        y2 = B.y + B.h / 2;
          const mx = (x1 + x2) / 2;
          return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} stroke="var(--border-strong)" strokeWidth="1.5" fill="none" />;
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

function Channels() {
  const channels = [
    { type: 'voice', name: 'Voz · Amazon Connect', status: 'Conectado', detail: '+1 800 232 4848 · 4 números DID activos', meta: '12,840 minutos hoy' },
    { type: 'wa',    name: 'WhatsApp Business',     status: 'Conectado', detail: '+1 800 232 4848 · Verified business', meta: '4,212 mensajes hoy' },
    { type: 'chat',  name: 'Chat web',              status: 'Conectado', detail: 'Widget desplegado en 12 dominios', meta: '1,884 sesiones hoy' },
    { type: 'sms',   name: 'SMS · Pinpoint',         status: 'Conectado', detail: '+1 415 555 0188 · Short code 78229', meta: '480 mensajes hoy' },
    { type: 'email', name: 'Email · SES',           status: 'Conectado', detail: 'support@vox.com · cases@vox.com', meta: '288 emails hoy' },
  ];
  return (
    <div className="card">
      <div className="card__head"><div className="card__title">Canales conectados</div><button className="btn btn--sm"><Icon.Plus style={{ width: 12, height: 12 }} /> Conectar canal</button></div>
      <div className="card__body card__body--flush">
        {channels.map(c => (
          <div key={c.type} style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-1)', display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 16, alignItems: 'center' }}>
            <ChannelChip type={c.type} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{c.detail}</div>
            </div>
            <span className="mono muted" style={{ fontSize: 11 }}>{c.meta}</span>
            <div className="row" style={{ gap: 6 }}>
              <StatusPill status="Activo" />
              <button className="btn btn--ghost btn--sm">Configurar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QueuesConfig() {
  return (
    <div className="card">
      <div className="card__head"><div className="card__title">Configuración de colas</div><button className="btn btn--sm"><Icon.Plus style={{ width: 12, height: 12 }} /> Nueva cola</button></div>
      <div className="card__body card__body--flush">
        <table className="t">
          <thead><tr><th>Cola</th><th>Canal</th><th>Skill requerido</th><th>SLA target</th><th>Max wait</th><th>Agentes</th><th></th></tr></thead>
          <tbody>
            {[
              { name: 'Retención · Enterprise', ch: 'voice', skill: 'Spanish · Tier-2', sla: '80% / 20s', wait: '180s', agents: 12 },
              { name: 'Soporte L1', ch: 'voice', skill: 'Spanish · Tier-1', sla: '75% / 30s', wait: '300s', agents: 42 },
              { name: 'Soporte L2', ch: 'voice', skill: 'Spanish · Tier-2', sla: '85% / 30s', wait: '420s', agents: 18 },
              { name: 'Ventas · WhatsApp', ch: 'wa', skill: 'Sales · WA', sla: '90% / 60s', wait: 'N/A', agents: 14 },
              { name: 'Soporte · Chat', ch: 'chat', skill: 'Multi-language', sla: '85% / 45s', wait: '600s', agents: 22 },
              { name: 'Facturación · Email', ch: 'email', skill: 'Billing', sla: '95% / 2h', wait: 'N/A', agents: 8 },
              { name: 'Cobranza · SMS', ch: 'sms', skill: 'Spanish · Collections', sla: '90% / 5m', wait: 'N/A', agents: 6 },
            ].map((q, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{q.name}</td>
                <td><ChannelChip type={q.ch} /></td>
                <td className="col-muted">{q.skill}</td>
                <td className="mono">{q.sla}</td>
                <td className="mono col-muted">{q.wait}</td>
                <td className="mono col-num">{q.agents}</td>
                <td><button className="btn btn--ghost btn--sm">Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersRoles() {
  const users = [
    { name: 'Camila Reyes',   role: 'Sr. Agent',  team: 'Retención',   email: 'camila@nordal.co',  mfa: true,  active: true },
    { name: 'Mateo Silva',    role: 'Agent',      team: 'Retención',   email: 'mateo@nordal.co',   mfa: true,  active: true },
    { name: 'Lucía Ortega',   role: 'Agent',      team: 'Ventas',      email: 'lucia@nordal.co',   mfa: true,  active: true },
    { name: 'Diego Paredes',  role: 'Agent',      team: 'Soporte L1',  email: 'diego@nordal.co',   mfa: false, active: true },
    { name: 'Renata Castro',  role: 'Agent',      team: 'Soporte L1',  email: 'renata@nordal.co',  mfa: true,  active: true },
    { name: 'Sofía Aguilar',  role: 'Sr. Agent',  team: 'Soporte L2',  email: 'sofia@nordal.co',   mfa: true,  active: true },
    { name: 'Marisa Beltrán', role: 'Supervisor', team: 'Retención',   email: 'marisa@nordal.co',  mfa: true,  active: true },
    { name: 'Andrés Pulido',  role: 'Manager',    team: 'Operaciones', email: 'andres@nordal.co',  mfa: true,  active: true },
  ];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="kpi-grid">
        <div className="kpi"><div className="kpi__label">Usuarios totales</div><div className="kpi__value">168</div></div>
        <div className="kpi"><div className="kpi__label">Activos hoy</div><div className="kpi__value">142</div></div>
        <div className="kpi"><div className="kpi__label">Pendientes invitación</div><div className="kpi__value">4</div></div>
        <div className="kpi"><div className="kpi__label">Roles personalizados</div><div className="kpi__value">7</div></div>
      </div>
      <div className="card">
        <div className="card__head"><div className="card__title">Usuarios</div><button className="btn btn--primary btn--sm"><Icon.Plus style={{ width: 12, height: 12 }} /> Invitar usuario</button></div>
        <div className="card__body card__body--flush">
          <table className="t">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Equipo</th><th>Email</th><th>MFA</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.email}>
                  <td>
                    <div className="row"><Avatar name={u.name} /><span style={{ fontWeight: 500 }}>{u.name}</span></div>
                  </td>
                  <td><span className="chip">{u.role}</span></td>
                  <td className="col-muted">{u.team}</td>
                  <td className="col-muted mono" style={{ fontSize: 11.5 }}>{u.email}</td>
                  <td>{u.mfa ? <span className="chip chip--green"><Icon.Shield style={{ width: 10, height: 10 }} /> Activo</span> : <span className="chip chip--red">Pendiente</span>}</td>
                  <td><StatusPill status="Activo" /></td>
                  <td><button className="btn btn--ghost btn--sm">Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Integrations() {
  const ints = [
    { name: 'Amazon S3',          desc: 'Almacenamiento de grabaciones y transcripciones', status: 'Conectado', color: '#F5A524', letter: 'S3' },
    { name: 'Kinesis Data Streams', desc: 'Streaming de eventos de contacto', status: 'Conectado', color: '#22B8D9', letter: 'KS' },
    { name: 'Lex · Bots',         desc: 'Chatbots conversacionales para self-service', status: 'Conectado', color: '#8B7EE8', letter: 'LX' },
    { name: 'Lambda',             desc: 'Funciones serverless en flujos IVR', status: 'Conectado', color: '#1FAE6C', letter: 'λ' },
    { name: 'Salesforce',         desc: 'Sync bidireccional de cuentas y oportunidades', status: 'Conectado', color: '#22B8D9', letter: 'SF' },
    { name: 'Slack',              desc: 'Notificaciones de SLA y alertas', status: 'Conectado', color: '#E879A6', letter: 'SL' },
    { name: 'Zendesk',            desc: 'Import de macros y artículos', status: 'Conectado', color: '#1FAE6C', letter: 'ZD' },
    { name: 'Workday',            desc: 'Roster y schedules', status: 'Pendiente', color: '#E5484D', letter: 'WD' },
    { name: 'Webhook genérico',   desc: 'Eventos personalizados por HTTP', status: 'Conectado', color: '#5F6E8C', letter: 'WH' },
  ];
  return (
    <div className="card">
      <div className="card__head"><div className="card__title">Integraciones</div><button className="btn btn--sm">Marketplace</button></div>
      <div className="card__body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {ints.map(it => (
            <div key={it.name} style={{ background: 'var(--bg-2)', border: '1px solid var(--border-1)', borderRadius: 8, padding: 14 }}>
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: it.color, color: '#0B0F1A', display: 'grid', placeItems: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{it.letter}</div>
                <div className="grow">
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{it.desc}</div>
                </div>
              </div>
              <div className="spread" style={{ marginTop: 10 }}>
                <StatusPill status={it.status === 'Conectado' ? 'Activo' : 'En riesgo'} />
                <button className="btn btn--ghost btn--sm">{it.status === 'Conectado' ? 'Configurar' : 'Conectar'}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AISettings() {
  const [tCL, setTCL] = useState(true);
  const [tQ, setTQ] = useState(true);
  const [tCoach, setTCoach] = useState(true);
  const [tSent, setTSent] = useState(true);
  const [autoSum, setAutoSum] = useState(true);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="card__head"><div className="card__title">Capacidades de IA</div><span className="chip chip--violet"><Icon.Sparkles style={{ width: 11, height: 11 }} /> Contact Lens + Q</span></div>
        <div className="card__body card__body--flush">
          {[
            { key: 'cl',   on: tCL, set: setTCL, title: 'Contact Lens · Análisis de llamadas', desc: 'Transcripción, sentiment, detección de palabras clave y temas. Aplica a 100% de llamadas.' },
            { key: 'sent', on: tSent, set: setTSent, title: 'Sentiment en tiempo real', desc: 'Stream de sentiment a la consola del agente y supervisor. Latencia <500ms.' },
            { key: 'q',    on: tQ, set: setTQ, title: 'Amazon Q · Copiloto del agente', desc: 'Sugerencias contextuales durante la llamada y respuestas conversacionales basadas en KB.' },
            { key: 'coach',on: tCoach, set: setTCoach, title: 'Coaching automático', desc: 'Alertas al supervisor cuando se detecta sentiment negativo, silencios prolongados o palabras clave de riesgo.' },
            { key: 'sum',  on: autoSum, set: setAutoSum, title: 'Resumen automático post-llamada', desc: 'Genera resumen, disposición y tags al finalizar cada contacto. Reduce tiempo de wrap-up ~62%.' },
          ].map(c => (
            <div key={c.key} className="spread" style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-1)' }}>
              <div style={{ maxWidth: 600 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.title}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{c.desc}</div>
              </div>
              <Toggle on={c.on} onChange={c.set} />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__head"><div className="card__title">Palabras clave a monitorear</div></div>
        <div className="card__body">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {['cancelar', 'reembolso', 'demanda', 'competencia', 'queja formal', 'cancelación', 'demora', 'enojado', 'mentira', 'fraude', 'reclamo'].map(w => (
              <span key={w} className="chip chip--red">{w} <Icon.Close style={{ width: 10, height: 10, opacity: 0.6, cursor: 'pointer' }} /></span>
            ))}
            <button className="btn btn--ghost btn--sm"><Icon.Plus style={{ width: 11, height: 11 }} /> Agregar</button>
          </div>
          <div className="divider" />
          <div className="muted" style={{ fontSize: 12 }}>Cuando estas palabras se detecten en una transcripción, se genera una alerta en la consola del supervisor en tiempo real.</div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 38, height: 22, borderRadius: 999,
      background: on ? 'var(--accent-green)' : 'var(--bg-3)',
      position: 'relative', transition: 'background 0.15s',
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

function Security() {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="card__head"><div className="card__title">Autenticación</div></div>
        <div className="card__body">
          <div className="col" style={{ gap: 14 }}>
            <Setting label="SSO · SAML 2.0" desc="Conectado con Okta · 168 usuarios" enabled />
            <Setting label="MFA obligatoria" desc="Todos los usuarios deben tener 2FA activo" enabled />
            <Setting label="Restricción por IP" desc="Permitir acceso solo desde rangos corporativos" enabled={false} />
            <Setting label="Session timeout" desc="Cerrar sesión tras 30 min de inactividad" enabled />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card__head"><div className="card__title">Privacidad y compliance</div></div>
        <div className="card__body">
          <div className="col" style={{ gap: 14 }}>
            <Setting label="Encriptación at-rest (KMS)" desc="AES-256 · Customer-managed key" enabled />
            <Setting label="Encriptación in-transit" desc="TLS 1.3 forzado en todos los canales" enabled />
            <Setting label="Redacción de PII en transcripciones" desc="Tarjetas, DNIs y emails redactados" enabled />
            <Setting label="Retención de grabaciones" desc="180 días (GDPR + LFPDPPP)" enabled />
            <Setting label="Audit log" desc="Eventos exportados a CloudWatch" enabled />
          </div>
        </div>
      </div>
    </div>
  );
}

function Setting({ label, desc, enabled }) {
  return (
    <div className="spread">
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12 }}>{desc}</div>
      </div>
      <span className={`chip ${enabled ? 'chip--green' : ''}`}>{enabled ? <><Icon.Check style={{ width: 11, height: 11 }} /> Activo</> : 'Desactivado'}</span>
    </div>
  );
}

function Billing() {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="card__head"><div className="card__title">Plan actual</div></div>
        <div className="card__body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Plan</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>Enterprise</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Renovación 01/10/2026</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Asientos</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>168 / 200</div>
            <div className="bar" style={{ marginTop: 8 }}><div style={{ width: '84%' }} /></div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Uso mes actual</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>$48,240</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>+8% vs mes anterior</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card__head"><div className="card__title">Consumo de IA y minutaje</div></div>
        <div className="card__body card__body--flush">
          <table className="t">
            <thead><tr><th>Recurso</th><th>Uso</th><th>Cuota</th><th>Costo unitario</th><th>Costo mes</th></tr></thead>
            <tbody>
              {[
                { r: 'Minutos de voz inbound', u: '184,280', q: '250k', c: '$0.018 / min', t: '$3,317' },
                { r: 'Minutos de voz outbound', u: '42,180', q: '60k', c: '$0.022 / min', t: '$928' },
                { r: 'Contact Lens · análisis', u: '184,280', q: 'Ilimitado', c: '$0.015 / min', t: '$2,764' },
                { r: 'Consultas a Q', u: '84,212', q: '120k', c: '$0.004 / consulta', t: '$337' },
                { r: 'Mensajes WhatsApp / SMS', u: '64,840', q: '100k', c: '$0.012 / msg', t: '$778' },
              ].map((r, i) => (
                <tr key={i}>
                  <td>{r.r}</td>
                  <td className="mono col-num">{r.u}</td>
                  <td className="mono col-muted">{r.q}</td>
                  <td className="mono col-muted">{r.c}</td>
                  <td className="mono"><strong>{r.t}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Profile() {
  return (
    <div className="card">
      <div className="card__head"><div className="card__title">Perfil del usuario</div></div>
      <div className="card__body" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 28, alignItems: 'flex-start' }}>
        <div style={{ textAlign: 'center' }}>
          <Avatar name="Camila Reyes" size="xl" color="#8B7EE8" />
          <div style={{ marginTop: 10 }}><button className="btn btn--sm">Cambiar foto</button></div>
        </div>
        <div>
          <Field label="Nombre completo" value="Camila Reyes" />
          <Field label="Email" value="camila@nordal.co" />
          <Field label="Teléfono" value="+34 612 884 122" />
          <Field label="Equipo" value="Retención" />
          <Field label="Idioma" value="Español (ES)" />
          <Field label="Zona horaria" value="Europe/Madrid" />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <input defaultValue={value} style={{ width: '100%', maxWidth: 480, height: 34, background: 'var(--bg-2)', border: '1px solid var(--border-1)', borderRadius: 6, padding: '0 10px', color: 'var(--text-1)', outline: 'none' }} />
    </div>
  );
}

Object.assign(window, { Knowledge, Settings });
