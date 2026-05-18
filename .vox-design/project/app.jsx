/* global React, ReactDOM, Icon, Sidebar, Topbar, Dashboard, ActiveCall, IncomingCallOverlay, WrapUp, Contacts, ContactDetail, Supervision, Cases, Campaigns, Workflows, Reports, useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor, TweakButton, TweakToggle */
const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "role": "agent",
  "callState": "idle",
  "accent": "#F5A524"
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { theme, role, callState, accent } = tweaks;

  const [route, setRoute] = useState('home');
  const [status, setStatus] = useState('available');
  const [activeContact, setActiveContact] = useState(null);

  // theme application
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // accent override
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-amber', accent);
  }, [accent]);

  // route switcher
  useEffect(() => {
    if (callState !== 'idle' && route === 'home') setRoute('call');
  }, [callState]);

  const handleAcceptCall = () => {
    setTweak('callState', 'active');
    setRoute('call');
  };
  const handleHangup = () => {
    setTweak('callState', 'wrap');
  };
  const handleFinishWrap = () => {
    setTweak('callState', 'idle');
    setRoute('home');
  };
  const handleSimulateCall = () => {
    setTweak('callState', 'incoming');
  };

  const openContact = (c) => {
    setActiveContact(c);
    setRoute('contact-detail');
  };

  // Pick view
  let view;
  if (route === 'home')        view = <Dashboard role={role} setRoute={setRoute} callState={callState} onSimulateCall={handleSimulateCall} />;
  else if (route === 'call')   view = callState === 'wrap' ? <WrapUp onFinish={handleFinishWrap} /> : <ActiveCall callState={callState} setCallState={(s) => setTweak('callState', s)} onHangup={handleHangup} />;
  else if (route === 'queue')  view = <Supervision />;
  else if (route === 'contacts') view = <Contacts setRoute={setRoute} onOpenContact={openContact} />;
  else if (route === 'contact-detail') view = <ContactDetail contact={activeContact} onBack={() => setRoute('contacts')} />;
  else if (route === 'cases')  view = <Cases />;
  else if (route === 'campaigns') view = <Campaigns />;
  else if (route === 'workflows') view = <Workflows />;
  else if (route === 'reports') view = <Reports />;
  else if (route === 'knowledge') view = <Knowledge />;
  else if (route === 'settings') view = <Settings />;
  else view = <Placeholder route={route} setRoute={setRoute} />;

  return (
    <div className="app" data-density="cozy">
      <Sidebar route={route} setRoute={setRoute} role={role} callState={callState} />
      <Topbar
        status={status} setStatus={setStatus}
        callState={callState}
        onAnswer={handleAcceptCall}
        theme={theme} setTheme={(t) => setTweak('theme', t)}
      />
      <main className="app__main">
        {view}
        {callState === 'incoming' && <IncomingCallOverlay onAccept={handleAcceptCall} onReject={() => setTweak('callState', 'idle')} />}
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Apariencia">
          <TweakRadio label="Tema" value={theme} onChange={(v) => setTweak('theme', v)} options={[
            { value: 'dark', label: 'Oscuro' },
            { value: 'light', label: 'Claro' },
          ]} />
          <TweakColor label="Acento" value={accent} onChange={(v) => setTweak('accent', v)} options={['#F5A524', '#22B8D9', '#8B7EE8', '#1FAE6C', '#E879A6']} />
        </TweakSection>

        <TweakSection label="Rol">
          <TweakRadio label="Usuario" value={role} onChange={(v) => setTweak('role', v)} options={[
            { value: 'agent', label: 'Agente' },
            { value: 'supervisor', label: 'Supervisor' },
            { value: 'manager', label: 'Manager' },
          ]} />
        </TweakSection>

        <TweakSection label="Llamada">
          <TweakRadio label="Estado" value={callState} onChange={(v) => { setTweak('callState', v); if (v !== 'idle') setRoute('call'); }} options={[
            { value: 'idle', label: 'Idle' },
            { value: 'incoming', label: 'Entrante' },
            { value: 'active', label: 'Activa' },
            { value: 'wrap', label: 'Wrap' },
          ]} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function Placeholder({ route, setRoute }) {
  const titles = { knowledge: 'Knowledge · Amazon Q', settings: 'Configuración' };
  return (
    <div className="view">
      <div className="view__head">
        <div>
          <h1 className="view__title">{titles[route] || route}</h1>
          <div className="view__sub">Sección en construcción para esta exploración.</div>
        </div>
        <button className="btn" onClick={() => setRoute('home')}>Volver al inicio</button>
      </div>
      <div className="card">
        <div className="card__body" style={{ padding: 48, textAlign: 'center', color: 'var(--text-3)' }}>
          <Icon.Sparkles style={{ width: 32, height: 32, opacity: 0.5 }} />
          <div style={{ marginTop: 12, fontSize: 14 }}>Esta vista está disponible en la versión completa del prototipo.</div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
