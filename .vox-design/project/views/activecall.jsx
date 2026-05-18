/* global React, Icon, Avatar, ChannelChip, StatusPill, DATA */
const { useState, useEffect, useRef } = React;

function ActiveCall({ callState, setCallState, onHangup }) {
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [recording, setRecording] = useState(true);
  const [lines, setLines] = useState([]);
  const [typing, setTyping] = useState(false);
  const transcriptRef = useRef(null);

  // Timer
  useEffect(() => {
    if (callState !== 'active') return;
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [callState]);

  // Streaming transcript
  useEffect(() => {
    if (callState !== 'active') return;
    setLines([]);
    let i = 0;
    const advance = () => {
      const next = DATA.TRANSCRIPT_SCRIPT[i];
      if (!next) return;
      setTyping(true);
      const t1 = setTimeout(() => {
        setTyping(false);
        setLines(curr => [...curr, next]);
        i++;
      }, 800 + Math.random() * 400);
      return () => clearTimeout(t1);
    };
    advance();
    const id = setInterval(() => advance(), 3800);
    return () => clearInterval(id);
  }, [callState]);

  // Auto-scroll
  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [lines, typing]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // Sentiment evolution from lines so far
  const counts = lines.reduce((acc, l) => { acc[l.sent] = (acc[l.sent] || 0) + 1; return acc; }, { pos: 1, neu: 1, neg: 0 });
  const total = counts.pos + counts.neu + counts.neg;

  if (callState === 'idle') {
    return (
      <div className="view" style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100vh - var(--header-h))' }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'var(--bg-2)', display: 'grid', placeItems: 'center', margin: '0 auto 18px', color: 'var(--text-3)' }}>
            <Icon.Phone style={{ width: 38, height: 38 }} />
          </div>
          <h2 style={{ margin: '0 0 6px', letterSpacing: '-0.01em' }}>No hay llamada activa</h2>
          <div className="muted" style={{ fontSize: 13 }}>Cuando una llamada entrante sea ruteada a tu cola, aparecerá aquí con transcripción en vivo, sentiment y sugerencias de Q.</div>
          <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center', gap: 8 }}>
            <button className="btn btn--primary" onClick={() => setCallState('incoming')}><Icon.PhoneIn style={{ width: 14, height: 14 }} /> Simular llamada entrante</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="call">
      {/* LEFT — Softphone */}
      <div className="call__panel">
        <div className="softphone__caller">
          <Avatar name="Ariadna Ferré" size="lg" color="#22B8D9" />
          <div className="softphone__name">Ariadna Ferré</div>
          <div className="softphone__num mono">+34 612 884 122 · Nordal Logistics</div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <span className="chip chip--violet">Enterprise</span>
            <span className="chip chip--cyan">Cliente desde 2019</span>
          </div>
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <div className="softphone__timer">{fmt(elapsed)}</div>
            <div className="lbl">Duración · {recording && <span style={{ color: 'var(--accent-red)' }}>● Grabando</span>}</div>
          </div>
        </div>

        <div className="softphone__controls">
          <button className={`softphone__btn ${muted ? 'softphone__btn--on' : ''}`} onClick={() => setMuted(m => !m)}>
            {muted ? <Icon.MicOff /> : <Icon.Mic />}
            <span>{muted ? 'Mute on' : 'Mute'}</span>
          </button>
          <button className={`softphone__btn ${held ? 'softphone__btn--on' : ''}`} onClick={() => setHeld(h => !h)}>
            <Icon.Pause />
            <span>{held ? 'En espera' : 'Espera'}</span>
          </button>
          <button className="softphone__btn">
            <Icon.Pad />
            <span>Teclado</span>
          </button>
          <button className="softphone__btn">
            <Icon.Transfer />
            <span>Transferir</span>
          </button>
          <button className="softphone__btn">
            <Icon.Users />
            <span>Conferencia</span>
          </button>
          <button className="softphone__btn">
            <Icon.Note />
            <span>Notas</span>
          </button>
        </div>

        <div style={{ padding: 14, borderTop: '1px solid var(--border-1)' }}>
          <div className="section-title">Sentiment en vivo</div>
          <div className="sentiment-bar">
            <div className="pos" style={{ width: `${(counts.pos / total) * 100}%` }} />
            <div className="neu" style={{ width: `${(counts.neu / total) * 100}%` }} />
            <div className="neg" style={{ width: `${(counts.neg / total) * 100}%` }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className="mono" style={{ fontSize: 11 }}><span style={{ color: 'var(--accent-green)' }}>● Pos {counts.pos}</span></span>
            <span className="mono" style={{ fontSize: 11 }}><span className="muted">● Neu {counts.neu}</span></span>
            <span className="mono" style={{ fontSize: 11 }}><span style={{ color: 'var(--accent-red)' }}>● Neg {counts.neg}</span></span>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            Score actual: <span className="mono" style={{ color: 'var(--accent-green)' }}>+0.34</span> · tendencia mejorando
          </div>
        </div>

        <div style={{ marginTop: 'auto', padding: 14, borderTop: '1px solid var(--border-1)' }}>
          <button className="btn btn--danger" style={{ width: '100%', height: 44 }} onClick={onHangup}>
            <Icon.Phone style={{ transform: 'rotate(135deg)' }} /> Colgar llamada
          </button>
        </div>
      </div>

      {/* CENTER — Transcript + Q */}
      <div className="call__panel">
        <div className="call__panel-head">
          <Icon.Activity style={{ width: 16, height: 16, color: 'var(--accent-cyan)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Transcripción en vivo · Contact Lens</div>
            <div className="muted" style={{ fontSize: 11 }}>Español (ES) · Latencia 320ms</div>
          </div>
          <span className="chip chip--cyan"><span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} /> Stream</span>
          <button className="btn btn--ghost btn--sm"><Icon.Send style={{ width: 12, height: 12 }} /> Resumen</button>
        </div>
        <div className="call__panel-body" ref={transcriptRef}>
          <div className="transcript">
            {lines.map((l, i) => (
              <div key={i} className={`transcript__row transcript__row--${l.who}`}>
                <Avatar name={l.who === 'agent' ? 'Camila Reyes' : 'Ariadna Ferré'} color={l.who === 'agent' ? '#8B7EE8' : '#22B8D9'} size="sm" />
                <div>
                  <div className="transcript__bubble">{l.text}</div>
                  <div className="transcript__meta">
                    <span>{l.who === 'agent' ? 'Camila' : 'Ariadna'}</span>
                    <span>{l.t}</span>
                    <span className={`transcript__sent transcript__sent--${l.sent}`}>{l.sent === 'pos' ? 'Positivo' : l.sent === 'neg' ? 'Negativo' : 'Neutro'}</span>
                  </div>
                </div>
              </div>
            ))}
            {typing && lines.length < DATA.TRANSCRIPT_SCRIPT.length && (
              <div className={`transcript__row transcript__row--${DATA.TRANSCRIPT_SCRIPT[lines.length].who}`}>
                <Avatar name={DATA.TRANSCRIPT_SCRIPT[lines.length].who === 'agent' ? 'Camila Reyes' : 'Ariadna Ferré'} color={DATA.TRANSCRIPT_SCRIPT[lines.length].who === 'agent' ? '#8B7EE8' : '#22B8D9'} size="sm" />
                <div className="transcript__typing"><span /><span /><span /></div>
              </div>
            )}
          </div>
        </div>

        {/* Q Coach */}
        <div style={{ borderTop: '1px solid var(--border-1)', padding: 14 }}>
          <div className="q-card">
            <div className="q-card__head">
              <Icon.Sparkles style={{ width: 14, height: 14 }} />
              Sugerencia de Q · próxima mejor acción
            </div>
            <div className="q-card__body">
              {DATA.Q_SUGGESTIONS[0].body}
            </div>
            <div className="q-card__actions">
              {DATA.Q_SUGGESTIONS[0].actions.map(a => (
                <button key={a} className="btn btn--sm">{a}</button>
              ))}
              <button className="btn btn--ghost btn--sm">Descartar</button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT — Customer 360 */}
      <div className="call__panel">
        <div className="call__panel-head">
          <Icon.User style={{ width: 16, height: 16 }} />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Cliente 360°</div>
          <button className="btn btn--ghost btn--sm"><Icon.More style={{ width: 14, height: 14 }} /></button>
        </div>
        <div className="call__panel-body">
          <div className="c360">
            <div className="c360__hero">
              <Avatar name="Ariadna Ferré" size="lg" color="#22B8D9" />
              <div>
                <div className="c360__name">Ariadna Ferré</div>
                <div className="c360__sub">Head of Operations · Nordal Logistics</div>
                <div className="row" style={{ gap: 4, marginTop: 4 }}>
                  <span className="chip chip--violet">Enterprise</span>
                  <span className="chip chip--green">NPS 9</span>
                </div>
              </div>
            </div>

            <div className="c360__stats">
              <div className="c360__stat">
                <div className="c360__stat-label">ARR</div>
                <div className="c360__stat-value">$184.5k</div>
              </div>
              <div className="c360__stat">
                <div className="c360__stat-label">Casos abiertos</div>
                <div className="c360__stat-value">2</div>
              </div>
              <div className="c360__stat">
                <div className="c360__stat-label">Última interacción</div>
                <div className="c360__stat-value">2h</div>
              </div>
              <div className="c360__stat">
                <div className="c360__stat-label">CSAT promedio</div>
                <div className="c360__stat-value">92%</div>
              </div>
            </div>

            <div>
              <div className="section-title">Caso activo</div>
              <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: 12, border: '1px solid var(--border-1)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono muted" style={{ fontSize: 11 }}>VX-4812</span>
                  <StatusPill status="Abierto" />
                </div>
                <div style={{ fontSize: 13, marginTop: 4, fontWeight: 500 }}>Reclamo por demora en envío internacional</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Abierto hace 38m · prioridad alta</div>
              </div>
            </div>

            <div>
              <div className="section-title">Productos contratados</div>
              <div className="col" style={{ gap: 6 }}>
                {[
                  { name: 'Logistics Suite · Enterprise', val: '$148k / año' },
                  { name: 'API Integrations · Premium',  val: '$24k / año' },
                  { name: 'Priority Support 24/7',       val: '$12.5k / año' },
                ].map(p => (
                  <div key={p.name} className="spread" style={{ padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 6 }}>
                    <span style={{ fontSize: 12.5 }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 11.5 }}>{p.val}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="section-title">Interacciones recientes</div>
              <div className="tl">
                {[
                  { t: 'Hoy 11:48', title: 'Llamada con Camila R.', body: 'Reportó demora · sentiment neutro', icon: Icon.Phone, c: 'var(--accent-green)' },
                  { t: 'Ayer',       title: 'Email a soporte', body: 'Re: trazabilidad envío #INT-44812', icon: Icon.Mail, c: 'var(--accent-amber)' },
                  { t: 'Lun 14/05',  title: 'WhatsApp',         body: 'Confirmación de orden', icon: Icon.WhatsApp, c: '#1FAE6C' },
                  { t: '08/05',     title: 'QBR ejecutivo',    body: 'Reunión con CSM · roadmap Q3', icon: Icon.Calendar, c: 'var(--accent-violet)' },
                ].map((it, i) => {
                  const Icn = it.icon;
                  return (
                    <div key={i} className="tl__item">
                      <div className="tl__dot" style={{ color: it.c, borderColor: it.c }}><Icn style={{ width: 11, height: 11 }} /></div>
                      <div style={{ flex: 1 }}>
                        <div className="tl__time">{it.t}</div>
                        <div className="tl__body">
                          <div className="tl__title" style={{ fontSize: 12.5 }}>{it.title}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{it.body}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Incoming overlay & wrap-up screen
function IncomingCallOverlay({ onAccept, onReject }) {
  return (
    <div className="incoming-overlay">
      <div className="incoming">
        <div className="incoming__ring">
          <Icon.PhoneIn style={{ width: 32, height: 32 }} />
        </div>
        <div className="muted mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Llamada entrante · Cola Retención</div>
        <div className="incoming__name">Ariadna Ferré</div>
        <div className="incoming__sub">+34 612 884 122 · Nordal Logistics</div>
        <div className="row" style={{ justifyContent: 'center', gap: 6, marginTop: 8 }}>
          <span className="chip chip--violet">Enterprise</span>
          <span className="chip chip--amber">Caso abierto VX-4812</span>
        </div>
        <div className="incoming__actions">
          <button className="incoming__btn incoming__btn--reject" onClick={onReject}>
            <Icon.Phone style={{ transform: 'rotate(135deg)', width: 22, height: 22 }} />
          </button>
          <button className="incoming__btn incoming__btn--accept" onClick={onAccept}>
            <Icon.PhoneIn style={{ width: 22, height: 22 }} />
          </button>
        </div>
      </div>
    </div>
  );
}

function WrapUp({ onFinish }) {
  const [dispo, setDispo] = useState('Resuelto');
  const [tags, setTags] = useState(['Reclamo', 'Logística']);
  const [notes, setNotes] = useState('Cliente reportó demora en envío internacional INT-44812. Verifiqué con carrier; entrega revisada para mañana antes de 14:00. Apliqué crédito de compensación CRED-LATE-08. Programé follow-up.');
  const dispOpts = ['Resuelto', 'Escalado', 'Pendiente cliente', 'Re-agendado'];
  return (
    <div className="view" style={{ maxWidth: 1100 }}>
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Wrap-up</span> · <span>VX-4812</span></div>
          <h1 className="view__title">Cierre de llamada</h1>
          <div className="view__sub">04:38 con Ariadna Ferré · Q ya generó un borrador del resumen</div>
        </div>
        <div className="view__actions">
          <button className="btn">Guardar borrador</button>
          <button className="btn btn--primary" onClick={onFinish}><Icon.Check style={{ width: 14, height: 14 }} /> Enviar resumen</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head"><div className="card__title">Resumen generado por Q</div><span className="chip chip--violet"><Icon.Sparkles style={{ width: 11, height: 11 }} /> Contact Lens</span></div>
            <div className="card__body">
              <div style={{ background: 'var(--accent-violet-soft)', padding: 14, borderRadius: 8, fontSize: 13, lineHeight: 1.6 }}>
                La cliente Ariadna Ferré (Nordal Logistics, cuenta Enterprise) reportó retraso en el envío internacional <span className="mono">#INT-44812</span>. Tras revisar trazabilidad con el carrier, se confirmó nueva entrega para mañana antes de las 14:00. Se aplicó crédito de compensación <span className="mono">CRED-LATE-08</span> (8% sobre el envío) y se acordó follow-up por correo. <strong>Sentiment final: positivo (+0.34).</strong>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn btn--sm">Regenerar</button>
                <button className="btn btn--sm">Editar</button>
                <button className="btn btn--sm btn--ghost">Copiar</button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><div className="card__title">Notas del agente</div></div>
            <div className="card__body">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                style={{ width: '100%', minHeight: 120, background: 'var(--bg-2)', border: '1px solid var(--border-1)', borderRadius: 6, padding: 12, color: 'var(--text-1)', resize: 'vertical', outline: 'none', fontFamily: 'var(--font-ui)', fontSize: 13 }} />
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head"><div className="card__title">Disposición</div></div>
            <div className="card__body">
              <div className="col" style={{ gap: 6 }}>
                {dispOpts.map(o => (
                  <label key={o} className="row" style={{ padding: '8px 10px', borderRadius: 6, background: dispo === o ? 'var(--bg-active)' : 'transparent', cursor: 'pointer', border: '1px solid var(--border-1)' }}>
                    <input type="radio" checked={dispo === o} onChange={() => setDispo(o)} style={{ accentColor: 'var(--accent-amber)' }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{o}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card__head"><div className="card__title">Tags · Q sugiere</div></div>
            <div className="card__body">
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {tags.map(t => (
                  <span key={t} className="chip chip--cyan">{t} <Icon.Close style={{ width: 11, height: 11, opacity: 0.6, cursor: 'pointer' }} onClick={() => setTags(tt => tt.filter(x => x !== t))} /></span>
                ))}
                <button className="btn btn--ghost btn--sm"><Icon.Plus style={{ width: 11, height: 11 }} /> añadir</button>
              </div>
              <div className="divider" />
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Sugerencias:</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {['Envío', 'Crédito aplicado', 'Carrier delay', 'Enterprise'].map(t => (
                  <button key={t} className="chip" onClick={() => !tags.includes(t) && setTags(tt => [...tt, t])}><Icon.Plus style={{ width: 10, height: 10 }} /> {t}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card__head"><div className="card__title">Follow-ups</div></div>
            <div className="card__body">
              <label className="row" style={{ padding: '8px 0' }}><input type="checkbox" defaultChecked style={{ accentColor: 'var(--accent-amber)' }} /><span style={{ fontSize: 13 }}>Crear tarea de follow-up en 24h</span></label>
              <label className="row" style={{ padding: '8px 0' }}><input type="checkbox" defaultChecked style={{ accentColor: 'var(--accent-amber)' }} /><span style={{ fontSize: 13 }}>Enviar email con confirmación</span></label>
              <label className="row" style={{ padding: '8px 0' }}><input type="checkbox" style={{ accentColor: 'var(--accent-amber)' }} /><span style={{ fontSize: 13 }}>Programar encuesta NPS</span></label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ActiveCall, IncomingCallOverlay, WrapUp });
