/* global React, Icon */
const { useState } = React;

function Sidebar({ route, setRoute, role, callState }) {
  const NAV = [
    { section: 'Operación' },
    { id: 'home',        label: 'Inicio',          icon: Icon.Home },
    { id: 'call',        label: 'Llamada activa',  icon: Icon.Phone, count: callState !== 'idle' ? '●' : null, alert: callState !== 'idle' },
    { id: 'queue',       label: 'Cola en vivo',    icon: Icon.Queue, count: '63', alert: true },
    { section: 'Clientes' },
    { id: 'contacts',    label: 'Contactos',       icon: Icon.ContactCard, count: '8.4k' },
    { id: 'cases',       label: 'Casos',           icon: Icon.Ticket, count: '24' },
    { section: 'Crecimiento' },
    { id: 'campaigns',   label: 'Campañas',        icon: Icon.Megaphone, count: '5' },
    { id: 'workflows',   label: 'Workflows',       icon: Icon.Workflow },
    { id: 'reports',     label: 'Reportes',        icon: Icon.Chart },
    { section: 'Sistema' },
    { id: 'knowledge',   label: 'Knowledge · Q',   icon: Icon.Sparkles },
    { id: 'settings',    label: 'Configuración',   icon: Icon.Settings },
  ];

  const roleLabel = { agent: 'Agente', supervisor: 'Supervisor', manager: 'Manager' }[role] || 'Agente';

  return (
    <aside className="app__sidebar">
      <div className="sb__brand">
        <div className="sb__logo" />
        <div className="sb__name">Vox<span>CRM</span></div>
      </div>
      <nav className="sb__nav">
        {NAV.map((it, i) => {
          if (it.section) return <div key={`s${i}`} className="sb__section">{it.section}</div>;
          const Icn = it.icon;
          const active = route === it.id;
          return (
            <div key={it.id} className={`sb__item ${active ? 'sb__item--active' : ''}`} onClick={() => setRoute(it.id)}>
              <Icn className="sb__icon" />
              <div className="sb__label">{it.label}</div>
              {it.count && <div className={`sb__count ${it.alert ? 'sb__count--alert' : ''}`}>{it.count}</div>}
            </div>
          );
        })}
      </nav>
      <div className="sb__footer">
        <div className="sb__user-avatar" style={{ background: '#8B7EE8' }}>CR</div>
        <div className="sb__user-meta">
          <div className="sb__user-name">Camila Reyes</div>
          <div className="sb__user-role">{roleLabel} · Retención</div>
        </div>
        <div className="sb__presence" title="Disponible" />
      </div>
    </aside>
  );
}

function Topbar({ status, setStatus, callState, onAnswer, density, setDensity, theme, setTheme }) {
  const statusOpts = [
    { id: 'available', label: 'Disponible' },
    { id: 'break',     label: 'En break'   },
    { id: 'training',  label: 'Capacitación' },
  ];
  const [open, setOpen] = useState(false);

  return (
    <header className="app__topbar">
      <div className="tb__search">
        <Icon.Search style={{ width: 14, height: 14 }} />
        <input placeholder="Buscar contactos, cuentas, casos, transcripciones…" />
        <span className="tb__kbd">⌘K</span>
      </div>

      <div className="tb__actions">
        <button className={`tb__status ${status === 'break' ? 'tb__status--break' : ''}`} onClick={() => setOpen(o => !o)}>
          <span className="dot" />
          {statusOpts.find(s => s.id === status)?.label}
          <Icon.ChevDown style={{ width: 12, height: 12, opacity: 0.7 }} />
        </button>
        {open && (
          <div style={{ position: 'absolute', top: 50, right: 180, background: 'var(--bg-1)', border: '1px solid var(--border-2)', borderRadius: 8, boxShadow: 'var(--shadow-pop)', padding: 6, minWidth: 180, zIndex: 100 }}>
            {statusOpts.map(s => (
              <div key={s.id} onClick={() => { setStatus(s.id); setOpen(false); }} className="sb__item" style={{ margin: 0, padding: '8px 10px' }}>
                <span className="state-dot" style={{ background: s.id === 'available' ? 'var(--accent-green)' : s.id === 'break' ? 'var(--accent-amber)' : 'var(--text-3)' }} />
                <span className="sb__label">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="tb__divider" />

        {callState === 'incoming' && (
          <button className="btn btn--success btn--sm" onClick={onAnswer}>
            <Icon.PhoneIn style={{ width: 14, height: 14 }} />
            Atender llamada
          </button>
        )}
        {callState === 'active' && (
          <div className="chip chip--green">
            <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
            En llamada
          </div>
        )}
        {callState === 'wrap' && (
          <div className="chip chip--amber"><Icon.Note style={{ width: 12, height: 12 }} /> Wrap-up</div>
        )}

        <button className="tb__iconbtn" title="Tema" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Icon.Sun style={{ width: 16, height: 16 }} /> : <Icon.Moon style={{ width: 16, height: 16 }} />}
        </button>
        <button className="tb__iconbtn" title="Notificaciones">
          <Icon.Bell style={{ width: 16, height: 16 }} />
          <span className="badge">3</span>
        </button>
        <button className="tb__iconbtn" title="Ayuda">
          <Icon.Knowledge style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </header>
  );
}

Object.assign(window, { Sidebar, Topbar });
