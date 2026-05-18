/* global React, Icon, Avatar, ChannelChip, StatusPill, DATA */
const { useState } = React;

function Contacts({ setRoute, onOpenContact }) {
  const [q, setQ] = useState('');
  const filtered = DATA.CONTACTS.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || c.company.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Clientes</span></div>
          <h1 className="view__title">Contactos</h1>
          <div className="view__sub">8,412 contactos · 1,284 cuentas · Última sync hace 14m</div>
        </div>
        <div className="view__actions">
          <button className="btn"><Icon.Filter style={{ width: 14, height: 14 }} /> Filtros</button>
          <button className="btn"><Icon.Refresh style={{ width: 14, height: 14 }} /> Sync</button>
          <button className="btn btn--primary"><Icon.Plus style={{ width: 14, height: 14 }} /> Nuevo contacto</button>
        </div>
      </div>

      <div className="card">
        <div className="card__head" style={{ gap: 8 }}>
          <div className="tb__search" style={{ maxWidth: 360, height: 30 }}>
            <Icon.Search style={{ width: 13, height: 13 }} />
            <input placeholder="Filtrar contactos…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="chip">Todos</span>
            <span className="chip chip--green">Activos · 184</span>
            <span className="chip chip--amber">Casos abiertos · 24</span>
            <span className="chip chip--violet">Renovación · 12</span>
            <span className="chip chip--red">En riesgo · 6</span>
          </div>
          <div style={{ marginLeft: 'auto' }} className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{filtered.length} resultados</div>
        </div>
        <div className="card__body card__body--flush">
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 28 }}><input type="checkbox" /></th>
                <th>Contacto</th>
                <th>Cuenta</th>
                <th>Segmento</th>
                <th>Estado</th>
                <th>Canal preferido</th>
                <th>ARR</th>
                <th>CSAT</th>
                <th>Owner</th>
                <th>Última interacción</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} onClick={() => onOpenContact(c)} style={{ cursor: 'pointer' }}>
                  <td><input type="checkbox" onClick={e => e.stopPropagation()} /></td>
                  <td>
                    <div className="row">
                      <Avatar name={c.name} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{c.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><div className="row" style={{ gap: 6 }}><Icon.Building style={{ width: 13, height: 13, color: 'var(--text-3)' }} /> {c.company}</div></td>
                  <td><span className="chip">{c.segment}</span></td>
                  <td><StatusPill status={c.status} /></td>
                  <td><ChannelChip type={c.channel} /></td>
                  <td className="col-num">${(c.value / 1000).toFixed(1)}k</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <div style={{ width: 36, height: 5, background: 'var(--bg-3)', borderRadius: 999 }}>
                        <div style={{ width: `${c.satisfaction}%`, height: '100%', background: c.satisfaction > 80 ? 'var(--accent-green)' : c.satisfaction > 60 ? 'var(--accent-amber)' : 'var(--accent-red)', borderRadius: 999 }} />
                      </div>
                      <span className="mono" style={{ fontSize: 11.5 }}>{c.satisfaction}</span>
                    </div>
                  </td>
                  <td><Avatar name={c.owner} size="sm" /></td>
                  <td className="col-muted col-num" style={{ fontSize: 11.5 }}>{c.lastTouch}</td>
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

function ContactDetail({ contact, onBack }) {
  const [tab, setTab] = useState('overview');
  return (
    <div className="view">
      <div className="view__crumb">
        <span onClick={onBack} style={{ cursor: 'pointer' }}>Contactos</span>
        <Icon.ChevRight style={{ width: 11, height: 11 }} />
        <span>{contact.name}</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 24, alignItems: 'center' }}>
          <Avatar name={contact.name} size="xl" />
          <div>
            <h1 className="view__title" style={{ marginBottom: 4 }}>{contact.name}</h1>
            <div className="row" style={{ gap: 14, color: 'var(--text-2)', fontSize: 13 }}>
              <span><Icon.Building style={{ width: 12, height: 12, marginRight: 4, verticalAlign: -1 }} />{contact.company}</span>
              <span><Icon.Mail style={{ width: 12, height: 12, marginRight: 4, verticalAlign: -1 }} />{contact.email}</span>
              <span><Icon.Phone style={{ width: 12, height: 12, marginRight: 4, verticalAlign: -1 }} />{contact.phone}</span>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <span className="chip">{contact.segment}</span>
              <StatusPill status={contact.status} />
              <span className="chip chip--violet">Cliente desde 2019</span>
              <span className="chip chip--green">NPS 9</span>
              <span className="chip chip--cyan">CSM: María Echeverría</span>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--icon"><Icon.Phone style={{ width: 14, height: 14, color: 'var(--accent-green)' }} /></button>
            <button className="btn btn--icon"><Icon.WhatsApp style={{ width: 14, height: 14, color: '#1FAE6C' }} /></button>
            <button className="btn btn--icon"><Icon.Mail style={{ width: 14, height: 14, color: 'var(--accent-amber)' }} /></button>
            <button className="btn"><Icon.More style={{ width: 14, height: 14 }} /></button>
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        <Mini label="ARR" value={`$${(contact.value / 1000).toFixed(1)}k`} delta="+12% YoY" dir="up" />
        <Mini label="Interacciones (90d)" value="42" delta="+8 vs trim. anterior" dir="up" />
        <Mini label="CSAT promedio" value={`${contact.satisfaction}%`} delta="Estable" dir="flat" />
        <Mini label="Sentiment" value="+0.42" delta="Mejorando" dir="up" />
      </div>

      <div style={{ height: 16 }} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="tabs" style={{ padding: '0 18px' }}>
          {[
            { id: 'overview', label: 'Resumen' },
            { id: 'activity', label: 'Actividad', n: 42 },
            { id: 'cases',    label: 'Casos',     n: 2  },
            { id: 'orders',   label: 'Productos', n: 3  },
            { id: 'docs',     label: 'Documentos', n: 14 },
            { id: 'q',        label: 'Q · Insights' },
          ].map(t => (
            <div key={t.id} className={`tabs__tab ${tab === t.id ? 'tabs__tab--active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}{t.n != null && <span className="count">{t.n}</span>}
            </div>
          ))}
        </div>
        <div style={{ padding: 18 }}>
          {tab === 'overview' && <OverviewTab contact={contact} />}
          {tab === 'activity' && <ActivityTab />}
          {tab === 'cases' && <CasesTab />}
          {tab === 'orders' && <OrdersTab />}
          {tab === 'docs' && <DocsTab />}
          {tab === 'q' && <QInsightsTab />}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, delta, dir }) {
  const cls = dir === 'up' ? 'kpi__delta--up' : dir === 'down' ? 'kpi__delta--down' : 'kpi__delta--flat';
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      <div className={`kpi__delta ${cls}`}>{delta}</div>
    </div>
  );
}

function OverviewTab({ contact }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
      <div className="col" style={{ gap: 16 }}>
        <div>
          <div className="section-title">Línea de tiempo</div>
          <div className="tl">
            {[
              { t: 'Hoy 13:42', title: 'Llamada con Camila Reyes', body: 'Reclamo por demora · resuelto con crédito de compensación', icon: Icon.Phone, c: 'var(--accent-green)' },
              { t: 'Ayer',       title: 'Email enviado',            body: 'Re: trazabilidad envío #INT-44812 ', icon: Icon.Mail, c: 'var(--accent-amber)' },
              { t: '14/05',      title: 'WhatsApp recibido',        body: 'Cliente solicita estado de orden', icon: Icon.WhatsApp, c: '#1FAE6C' },
              { t: '08/05',      title: 'QBR ejecutivo',            body: 'Reunión con CSM · roadmap Q3', icon: Icon.Calendar, c: 'var(--accent-violet)' },
              { t: '02/05',      title: 'Llamada con Sofía A.',     body: 'AHT 12:47 · Sentiment positivo', icon: Icon.Phone, c: 'var(--accent-green)' },
              { t: '28/04',      title: 'Caso resuelto VX-4612',    body: 'Activación módulo de reportes', icon: Icon.Ticket, c: 'var(--accent-cyan)' },
            ].map((it, i) => {
              const Icn = it.icon;
              return (
                <div key={i} className="tl__item">
                  <div className="tl__dot" style={{ color: it.c, borderColor: it.c }}><Icn style={{ width: 12, height: 12 }} /></div>
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

        <div>
          <div className="section-title">Salud de la cuenta</div>
          <div className="grid-2">
            <div style={{ background: 'var(--bg-2)', padding: 14, borderRadius: 8 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Health score</div>
              <div className="mono" style={{ fontSize: 28, marginTop: 4 }}>78<span className="muted" style={{ fontSize: 14 }}> / 100</span></div>
              <div className="bar" style={{ marginTop: 8 }}><div style={{ width: '78%', background: 'var(--accent-green)' }} /></div>
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>+4 vs hace 30 días</div>
            </div>
            <div style={{ background: 'var(--bg-2)', padding: 14, borderRadius: 8 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Adopción</div>
              <div className="mono" style={{ fontSize: 28, marginTop: 4 }}>92%</div>
              <div className="bar" style={{ marginTop: 8 }}><div style={{ width: '92%' }} /></div>
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Top 8% de cuentas Enterprise</div>
            </div>
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <div className="q-card">
          <div className="q-card__head"><Icon.Sparkles style={{ width: 14, height: 14 }} /> Resumen Q</div>
          <div className="q-card__body" style={{ fontSize: 12.5 }}>
            Cuenta saludable con relación estable. La cliente prefiere comunicación por voz para temas operativos y email para confirmaciones. En las últimas 4 semanas, los temas recurrentes son <strong>logística de envíos internacionales</strong> y consultas de API. Sentiment promedio mejorando (+0.42). Riesgo de churn: <span style={{ color: 'var(--accent-green)' }}>bajo</span>.
          </div>
        </div>

        <div>
          <div className="section-title">Contactos relacionados</div>
          <div className="col" style={{ gap: 6 }}>
            {[
              { name: 'Diego Albornoz', role: 'CFO · Nordal Logistics', av: '#F5A524' },
              { name: 'Marta Restrepo', role: 'IT Director · Nordal', av: '#22B8D9' },
              { name: 'Pablo Ruiz', role: 'Procurement Lead', av: '#1FAE6C' },
            ].map(p => (
              <div key={p.name} className="row" style={{ padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 6 }}>
                <Avatar name={p.name} color={p.av} size="sm" />
                <div className="grow">
                  <div style={{ fontSize: 12.5 }}>{p.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{p.role}</div>
                </div>
                <button className="btn btn--ghost btn--sm btn--icon"><Icon.Phone style={{ width: 12, height: 12 }} /></button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="section-title">Notas internas</div>
          <div style={{ background: 'var(--bg-2)', padding: 12, borderRadius: 8, fontSize: 12.5, lineHeight: 1.55 }}>
            Cliente clave para la vertical de logística. Renovación programada para octubre. Han manifestado interés en módulo de analytics avanzado y en el plan de API tier-3.
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>— por María Echeverría, hace 5 días</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityTab() {
  const items = [
    { t: 'Hoy 13:42', icon: Icon.Phone, color: 'var(--accent-green)', kind: 'voice',
      title: 'Llamada con Camila Reyes', body: 'AHT 6:48 · Sentiment +0.34 · Caso VX-4812 escalado a logística.',
      meta: ['6:48', 'Grabada', 'Resumen Q disponible'] },
    { t: 'Hoy 11:18', icon: Icon.Mail, color: 'var(--accent-amber)', kind: 'email',
      title: 'Email enviado · "Trazabilidad envío INT-44812"', body: 'Confirmación de nueva fecha estimada y código de compensación.',
      meta: ['Abierto', 'Click en tracking link'] },
    { t: 'Ayer 17:02', icon: Icon.WhatsApp, color: '#1FAE6C', kind: 'wa',
      title: 'WhatsApp recibido', body: '"Hola, sigo sin recibir mi envío, ya van 4 días. Necesito una respuesta urgente."',
      meta: ['Auto-respondido por bot', 'Escalado a humano en 2m'] },
    { t: 'Ayer 09:30', icon: Icon.Calendar, color: 'var(--accent-violet)', kind: 'meet',
      title: 'Reunión · Roadmap Q3', body: 'Asistentes: Ariadna F., María E. (CSM), Pedro R. (Producto). 45 min.',
      meta: ['Notas en Notion', 'Próximo seguimiento: 22/05'] },
    { t: '14/05', icon: Icon.Chat, color: 'var(--accent-cyan)', kind: 'chat',
      title: 'Chat web · 3 sesiones', body: 'Consultas sobre integración API v3 y límites de rate-limit en plan Enterprise.',
      meta: ['Resuelto en sesión', 'KB-65 compartido'] },
    { t: '12/05', icon: Icon.Phone, color: 'var(--accent-green)', kind: 'voice',
      title: 'Llamada con Sofía Aguilar', body: 'AHT 12:47 · Sentiment positivo · Walkthrough de módulo de reportes.',
      meta: ['12:47', 'Grabada'] },
    { t: '08/05', icon: Icon.Ticket, color: 'var(--accent-amber)', kind: 'case',
      title: 'Caso VX-4612 resuelto', body: 'Activación de módulo de reportes avanzados completada.',
      meta: ['FCR', 'CSAT 5/5'] },
    { t: '02/05', icon: Icon.Sms, color: 'var(--accent-violet)', kind: 'sms',
      title: 'SMS · Recordatorio renovación', body: 'Tu contrato vence el 01/10/2025 — Vox renovación.',
      meta: ['Entregado', 'Sin respuesta'] },
  ];
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {['Todos', 'Voz', 'WhatsApp', 'Email', 'Chat', 'SMS', 'Casos', 'Reuniones'].map((f, i) => (
          <button key={f} className={`btn btn--sm ${i === 0 ? '' : 'btn--ghost'}`}>{f}</button>
        ))}
      </div>
      <div className="tl">
        {items.map((it, i) => {
          const Icn = it.icon;
          return (
            <div key={i} className="tl__item">
              <div className="tl__dot" style={{ color: it.color, borderColor: it.color }}><Icn style={{ width: 12, height: 12 }} /></div>
              <div style={{ flex: 1 }}>
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="tl__time">{it.t}</div>
                    <div className="tl__body">
                      <div className="tl__title">{it.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{it.body}</div>
                      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        {it.meta.map(m => <span key={m} className="chip" style={{ height: 18, fontSize: 10.5 }}>{m}</span>)}
                      </div>
                    </div>
                  </div>
                  <button className="btn btn--ghost btn--sm btn--icon"><Icon.More style={{ width: 13, height: 13 }} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function CasesTab() {
  return (
    <table className="t">
      <thead><tr><th>Caso</th><th>Asunto</th><th>Estado</th><th>Prioridad</th><th>Owner</th><th>Abierto</th></tr></thead>
      <tbody>
        {DATA.CASES.filter(c => c.contact.includes('Ariadna') || c.id === 'VX-4812').map(c => (
          <tr key={c.id}>
            <td className="mono col-muted">{c.id}</td>
            <td>{c.subject}</td>
            <td><StatusPill status={c.status} /></td>
            <td><StatusPill status={c.priority} /></td>
            <td><Avatar name={c.owner} size="sm" /></td>
            <td className="muted">{c.age}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function OrdersTab() {
  return (
    <div className="col" style={{ gap: 8 }}>
      {[
        { name: 'Logistics Suite · Enterprise', val: '$148,000 / año', start: '01/10/2019', renew: '01/10/2025' },
        { name: 'API Integrations · Premium',  val: '$24,000 / año',  start: '12/03/2022', renew: '12/03/2026' },
        { name: 'Priority Support 24/7',       val: '$12,500 / año',  start: '01/10/2019', renew: '01/10/2025' },
      ].map(p => (
        <div key={p.name} className="row" style={{ padding: 14, background: 'var(--bg-2)', borderRadius: 8 }}>
          <Icon.Tag style={{ width: 18, height: 18, color: 'var(--accent-violet)' }} />
          <div className="grow">
            <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>Inicio {p.start} · Renovación {p.renew}</div>
          </div>
          <div className="mono">{p.val}</div>
        </div>
      ))}
    </div>
  );
}
function DocsTab() {
  const docs = [
    { name: 'Master Services Agreement — Nordal Logistics.pdf', kind: 'PDF', size: '1.2 MB', owner: 'María Echeverría', date: '01/10/2024', tag: 'Contrato' },
    { name: 'NDA bilateral — firma electrónica.pdf', kind: 'PDF', size: '420 KB', owner: 'Legal',                date: '28/09/2024', tag: 'Legal' },
    { name: 'Propuesta comercial Q3 2026.pptx', kind: 'PPTX', size: '4.8 MB', owner: 'Camila Reyes', date: '14/05/2026', tag: 'Comercial' },
    { name: 'Diagrama de integración API v3.pdf', kind: 'PDF', size: '880 KB', owner: 'Pedro R.', date: '08/05/2026', tag: 'Técnico' },
    { name: 'Acta QBR — 08/05.docx', kind: 'DOCX', size: '142 KB', owner: 'María Echeverría', date: '08/05/2026', tag: 'Reunión' },
    { name: 'Reporte SLA Q2.xlsx', kind: 'XLSX', size: '2.1 MB', owner: 'Operaciones', date: '03/05/2026', tag: 'Reporte' },
    { name: 'Factura FAC-2026-0480.pdf', kind: 'PDF', size: '88 KB', owner: 'Facturación', date: '01/05/2026', tag: 'Factura' },
    { name: 'Grabación 13:42 — Camila Reyes.mp3', kind: 'MP3', size: '6.4 MB', owner: 'Contact Lens', date: 'Hoy', tag: 'Llamada' },
  ];
  const kindColor = { PDF: 'var(--accent-red)', PPTX: 'var(--accent-amber)', DOCX: 'var(--accent-cyan)', XLSX: 'var(--accent-green)', MP3: 'var(--accent-violet)' };
  return (
    <div>
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <button className="btn btn--sm"><Icon.Plus style={{ width: 12, height: 12 }} /> Subir archivo</button>
        <button className="btn btn--ghost btn--sm">Crear carpeta</button>
        <div className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{docs.length} documentos · 16.3 MB</div>
      </div>
      <table className="t">
        <thead><tr><th>Nombre</th><th>Tipo</th><th>Etiqueta</th><th>Owner</th><th>Tamaño</th><th>Fecha</th><th></th></tr></thead>
        <tbody>
          {docs.map(d => (
            <tr key={d.name}>
              <td>
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ width: 28, height: 32, borderRadius: 4, background: kindColor[d.kind], color: '#0B0F1A', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{d.kind}</div>
                  <span style={{ fontWeight: 500 }}>{d.name}</span>
                </div>
              </td>
              <td className="col-muted mono" style={{ fontSize: 11.5 }}>{d.kind}</td>
              <td><span className="chip">{d.tag}</span></td>
              <td className="col-muted">{d.owner}</td>
              <td className="col-num col-muted">{d.size}</td>
              <td className="col-muted">{d.date}</td>
              <td><button className="btn btn--ghost btn--sm btn--icon"><Icon.More style={{ width: 14, height: 14 }} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function QInsightsTab() {
  return (
    <div className="col" style={{ gap: 12 }}>
      {DATA.Q_SUGGESTIONS.map(s => (
        <div key={s.id} className="q-card">
          <div className="q-card__head"><Icon.Sparkles style={{ width: 14, height: 14 }} /> {s.title}</div>
          <div className="q-card__body">{s.body}</div>
          <div className="q-card__actions">{s.actions.map(a => <button key={a} className="btn btn--sm">{a}</button>)}</div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { Contacts, ContactDetail });
