/* ============================================================
   AIRA · App shell  ·  nav + topbar + hero + switcher + routing
   ============================================================ */
function App(){
  const D=window.DATA;
  const {Icon,Avatar,Chip,Dot,Sparkline,useFloatingTip}=window;
  useFloatingTip();
  const [tab,setTab]=useState('resumen');
  const [contact,setContact]=useState(D.contactos[0]);
  const [cmdOpen,setCmdOpen]=useState(false);
  const [lightbox,setLightbox]=useState(null);
  const [aiCall,setAiCall]=useState(null);

  // Ctrl+K
  useEffect(()=>{
    const k=(e)=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setCmdOpen(o=>!o);} };
    window.addEventListener('keydown',k); return ()=>window.removeEventListener('keydown',k);
  },[]);

  const TABS=[
    {id:'resumen', label:'Resumen', icon:'gauge', n:null, color:'--cian'},
    {id:'llamadas', label:'Llamadas', icon:'phone', n:D.counts.llamadas, color:'--cian'},
    {id:'whatsapp', label:'WhatsApp', icon:'chat', n:D.counts.whatsapp, color:'--verde'},
    {id:'emails', label:'Emails', icon:'mail', n:D.counts.emails, color:'--ambar'},
    {id:'archivos', label:'Archivos', icon:'paperclip', n:D.counts.archivos, color:'--violeta'},
    {id:'actividad', label:'Actividad', icon:'history', n:D.counts.historial, color:'--violeta'},
  ];

  return (
    <div className="app">
      <Nav onSearch={()=>setCmdOpen(true)}/>
      <div className="main">
        <Topbar/>
        <div className="content">
          <div className="content-inner">
            {/* HERO cliente */}
            <Hero contact={contact} onSwitch={()=>setCmdOpen(true)} counts={D.counts} onGoto={setTab}/>

            {/* NAVEGADOR DE CANALES (conteos + navegación unificados) */}
            <div style={{marginTop:18,marginBottom:20}}>
              <ChannelNav tabs={TABS} active={tab} onChange={setTab}/>
            </div>

            {/* VISTA ACTIVA */}
            <div key={tab}>
              {tab==='resumen' && <window.OverviewView onGoto={setTab} onOpenSummary={setAiCall}/>}
              {tab==='llamadas' && <window.CallsView onOpenSummary={setAiCall}/>}
              {tab==='whatsapp' && <window.WhatsAppView onOpenFile={setLightbox}/>}
              {tab==='emails' && <window.EmailsView onOpenFile={setLightbox}/>}
              {tab==='archivos' && <window.FilesView onOpenFile={setLightbox}/>}
              {tab==='actividad' && <window.HistoryView/>}
            </div>
          </div>
        </div>
      </div>

      {cmdOpen && <CommandSwitcher contacts={D.contactos} current={contact}
        onPick={(c)=>{setContact(c);setCmdOpen(false);}} onClose={()=>setCmdOpen(false)}/>}
      {lightbox && <window.Lightbox file={lightbox} onClose={()=>setLightbox(null)}/>}
      {aiCall && <window.AISummary call={aiCall} onClose={()=>setAiCall(null)}/>}
    </div>
  );
}

/* ---------------- NAV ---------------- */
function Nav({onSearch}){
  const {Icon}=window;
  const groups=[
    {title:'Operación', items:[['Inicio','home','Inicio.html'],['Agent Desktop','headset'],['Cola en vivo','live']]},
    {title:'Crecimiento', items:[['Leads','users'],['Campañas','megaphone'],['Bots','bot'],['Automatizaciones','zap'],['Agente IA','sparkles'],['Citas','calendar'],['Reportes','chart'],['Grabaciones','mic',"Historial y Grabaciones.html",true]]},
    {title:'Sistema', items:[['Configuración','settings']]},
  ];
  const integ=[['WhatsApp','--verde'],['Salesforce','--cian'],['Amazon Connect','--ambar']];
  return (
    <nav className="nav">
      <div className="nav-brand">
        <div className="nav-logo"><Icon name="layers" size={17} stroke={2.4}/></div>
        <span className="nav-brandname">AIRA</span>
      </div>
      <button className="nav-search" onClick={onSearch}>
        <Icon name="search" size={16}/>
        <span style={{flex:1,textAlign:'left'}}>Buscar…</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <div className="nav-scroll">
        {groups.map(g=>(
          <div key={g.title}>
            <div className="nav-section">{g.title}</div>
            {g.items.map(([label,icon,href,active])=>(
              <a key={label} href={typeof href==='string'?href:undefined} className={"nav-item"+(active?' active':'')}
                 style={{textDecoration:'none'}}>
                <Icon name={icon} size={18}/> {label}
              </a>
            ))}
          </div>
        ))}
        <div className="nav-section">Integraciones</div>
        {integ.map(([label,color])=>(
          <div key={label} className="nav-item"><span className="nav-dot" style={{background:`var(${color})`,marginLeft:0,marginRight:3}}/> {label}</div>
        ))}
      </div>
      <div className="nav-tools">
        <button className="ico-btn" data-tooltip="Modo noche"><Icon name="moon" size={18}/></button>
        <button className="ico-btn" data-tooltip="Notificaciones"><Icon name="bell" size={18}/><span className="notif-dot"></span></button>
        <button className="ico-btn" data-tooltip="Cuenta"><Icon name="user" size={18}/></button>
      </div>
      <div className="nav-user">
        <div className="av">A</div>
        <div><div style={{fontWeight:700,fontSize:13}}>anedre12345</div><small>Admin</small></div>
        <Dot2/>
      </div>
    </nav>
  );
}
function Dot2(){ return <span style={{marginLeft:'auto',width:8,height:8,borderRadius:99,background:'var(--verde)'}}/>; }

/* ---------------- SECTION HEADER (premium, reutilizable) ---------------- */
function SectionHeader({title, eyebrow, children}){
  return (
    <div className="sec-head">
      <div style={{minWidth:0}}>
        {eyebrow && <div className="sec-eyebrow">{eyebrow}</div>}
        <h1 className="sec-title">{title}</h1>
      </div>
      <div className="sec-tools">{children}</div>
    </div>
  );
}

/* ---------------- SECTION TOOLBAR (estilo CRM compacto, reutilizable) ---------------- */
function SectionToolbar({name, count, onSearch}){
  const {Icon}=window;
  const [view,setView]=useState('comoda');
  const [seg,setSeg]=useState('actividad');
  return (
    <div className="sectb">
      <div className="sectb-left">
        <span className="sectb-name">{name}</span>
        <div className="sectb-vdiv"></div>
        <div style={{display:'flex',gap:2}}>
          <button className={"sectb-icon"+(view==='comoda'?' on':'')} onClick={()=>setView('comoda')} data-tooltip="Vista cómoda"><Icon name="panel" size={16}/></button>
          <button className={"sectb-icon"+(view==='compacta'?' on':'')} onClick={()=>setView('compacta')} data-tooltip="Vista compacta"><Icon name="live" size={16}/></button>
        </div>
        <div className="sectb-seg">
          <button className={"sectb-seg-btn"+(seg==='actividad'?' on':'')} onClick={()=>setSeg('actividad')}>Toda la actividad</button>
          <button className={"sectb-seg-btn"+(seg==='buscar'?' on':'')} onClick={()=>{setSeg('buscar');onSearch&&onSearch();}}>Búsqueda y filtro</button>
        </div>
      </div>
      <div className="sectb-right">
        <span className="sectb-count">{count} · <b>hace 5 d</b></span>
        <div className="sectb-vdiv"></div>
        <button className="sectb-icon" data-tooltip="Más opciones"><Icon name="more" size={18}/></button>
        <button className="sectb-cta accent" data-tooltip="Compartir este historial"><Icon name="share" size={15}/> Compartir</button>
        <button className="sectb-cta primary"><Icon name="download" size={15}/> Exportar</button>
      </div>
    </div>
  );
}

/* ---------------- TOPBAR (header al tope de la página · con funciones) ---------------- */
function Topbar(){
  const {Icon}=window;
  return (
    <div className="topbar">
      <div className="topbar-title">
        <div className="tb-crumb"><span>Crecimiento</span><Icon name="chevR" size={13}/><span className="tb-here">Grabaciones</span></div>
      </div>
      <div className="topbar-right">
        <div className="status-pill"><span className="pulse-dot" style={{width:7,height:7,borderRadius:99,background:'var(--ambar)'}}/> Conectando…</div>
        <div className="sectb-vdiv"></div>
        <button className="sectb-icon" data-tooltip="Más opciones"><Icon name="more" size={18}/></button>
        <button className="sectb-cta accent"><Icon name="share" size={15}/> Compartir</button>
        <button className="sectb-cta primary"><Icon name="download" size={15}/> Exportar</button>
      </div>
    </div>
  );
}

/* ---------------- HERO ---------------- */
function Hero({contact,onSwitch,counts,onGoto}){
  const D=window.DATA; const {Icon,Chip,Dot}=window;
  return (
    <>
      <div className="card hero fade-up">
        <div className="hero-av" style={{background:'linear-gradient(140deg,var(--cian),#0a6c84)'}}>{window.initials(contact.nombre)}</div>
        <div style={{flex:1,minWidth:0}}>
          <button className="hero-switch" onClick={onSwitch}>
            <span className="hero-name">{contact.nombre}</span>
            <Icon name="chevD" size={20} style={{color:'var(--text-3)'}}/>
          </button>
          <div style={{display:'flex',gap:8,marginTop:9,flexWrap:'wrap',alignItems:'center'}}>
            <Chip color="--cian"><Icon name="phone" size={13}/> {contact.origen}</Chip>
            <Chip>No contactado</Chip>
            <span className="mono" style={{fontSize:13,color:'var(--text-2)',fontWeight:700,display:'flex',alignItems:'center',gap:6}}><Icon name="phone" size={13} style={{color:'var(--text-3)'}}/> {contact.tel}</span>
            <span style={{fontSize:12.5,color:'var(--text-3)',display:'flex',alignItems:'center',gap:6}}><Dot color="--cian" size={7}/> Última: llamada · hace 5 d</span>
          </div>
        </div>
        <div className="hero-actions">
          <button className="act-btn" data-tooltip="Llamar" style={{color:'var(--cian)'}}><Icon name="phone" size={18}/></button>
          <button className="act-btn" data-tooltip="WhatsApp" style={{color:'var(--verde)'}}><Icon name="chat" size={18}/></button>
          <button className="act-btn" data-tooltip="Email" style={{color:'var(--ambar)'}}><Icon name="mail" size={18}/></button>
          <button className="btn btn-primary" style={{marginLeft:4}}><Icon name="sparkles" size={15}/> Resumen IA</button>
        </div>
      </div>
    </>
  );
}

/* ---------------- CHANNEL NAV (conteos + navegación unificados) ---------------- */
function ChannelNav({tabs,active,onChange}){
  const {Icon}=window;
  const resumen=tabs[0];
  const channels=tabs.slice(1);
  const rOn=active===resumen.id;
  return (
    <div className="chnav">
      {/* Resumen — vista general, separada de los canales */}
      <button data-tab={resumen.id} className={"chnav-btn"+(rOn?' active':'')} onClick={()=>onChange(resumen.id)}
        style={rOn?{background:'var(--text-1)',boxShadow:'var(--sh-2)'}:undefined}>
        <span className="chnav-chip" style={{background:rOn?'rgba(255,255,255,.16)':'var(--bg-3)',color:rOn?'#fff':'var(--text-2)'}}><Icon name={resumen.icon} size={17}/></span>
        <span style={{display:'flex',flexDirection:'column',lineHeight:1.15}}>
          <span className="chnav-label" style={{color:rOn?'#fff':'var(--text-1)',fontSize:14}}>{resumen.label}</span>
          <span style={{fontSize:11.5,color:rOn?'rgba(255,255,255,.7)':'var(--text-3)',fontWeight:600}}>Vista general</span>
        </span>
      </button>
      <div className="chnav-div"/>
      {channels.map(t=>{
        const on=active===t.id;
        return (
          <button key={t.id} data-tab={t.id} className={"chnav-btn flex"+(on?' active':'')} onClick={()=>onChange(t.id)}
            style={on?{background:`var(${t.color})`,boxShadow:'var(--sh-2)'}:undefined}>
            <span className="chnav-chip" style={{background:on?'rgba(255,255,255,.2)':`var(${t.color}-soft)`,color:on?'#fff':`var(${t.color})`}}><Icon name={t.icon} size={17}/></span>
            <span style={{display:'flex',flexDirection:'column',lineHeight:1.1,minWidth:0}}>
              <span className="chnav-label" style={{color:on?'rgba(255,255,255,.85)':'var(--text-2)'}}>{t.label}</span>
              <span className="chnav-count mono" style={{color:on?'#fff':`var(${t.color})`}}>{t.n}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- COMMAND SWITCHER ---------------- */
function CommandSwitcher({contacts,current,onPick,onClose}){
  const {Icon,Avatar,Dot}=window;
  const [q,setQ]=useState("");
  const [chan,setChan]=useState("Todos");
  const [cursor,setCursor]=useState(0);
  const inputRef=useRef();
  useEffect(()=>{ inputRef.current?.focus(); },[]);
  const filtered=contacts.filter(c=>{
    const okq=c.nombre.toLowerCase().includes(q.toLowerCase())||c.tel.includes(q);
    const okc=chan==="Todos"||c.origen===chan;
    return okq&&okc;
  });
  useEffect(()=>{
    const k=(e)=>{
      if(e.key==='Escape')onClose();
      if(e.key==='ArrowDown'){e.preventDefault();setCursor(c=>Math.min(filtered.length-1,c+1));}
      if(e.key==='ArrowUp'){e.preventDefault();setCursor(c=>Math.max(0,c-1));}
      if(e.key==='Enter'&&filtered[cursor])onPick(filtered[cursor]);
    };
    window.addEventListener('keydown',k); return ()=>window.removeEventListener('keydown',k);
  },[filtered,cursor]);
  return (
    <div className="cmd-scrim" onClick={onClose}>
      <div className="cmd" onClick={e=>e.stopPropagation()}>
        <div className="cmd-search">
          <Icon name="search" size={20} style={{color:'var(--text-3)'}}/>
          <input ref={inputRef} value={q} onChange={e=>{setQ(e.target.value);setCursor(0);}} placeholder="Buscar contacto por nombre o teléfono…"/>
          <span className="kbd">Esc</span>
        </div>
        <div className="cmd-filters">
          {["Todos","Teléfono","WhatsApp","Correo","Salesforce"].map(c=>(
            <button key={c} className={"fchip"+(chan===c?' on':'')} onClick={()=>{setChan(c);setCursor(0);}}>{c}</button>
          ))}
        </div>
        <div className="cmd-list">
          {filtered.length===0 && <div style={{padding:'30px',textAlign:'center',color:'var(--text-3)'}}>Sin resultados</div>}
          {filtered.map((c,i)=>(
            <div key={c.id} className={"cmd-row"+(i===cursor?' cursor':'')+(c.id===current.id?' sel':'')}
              onMouseEnter={()=>setCursor(i)} onClick={()=>onPick(c)}>
              <Avatar name={c.nombre} size={38} color={c.dot}/>
              <div style={{flex:1,minWidth:0}}>
                <div className="rname">{c.nombre}</div>
                <div className="rsub">{c.sub}</div>
              </div>
              <Dot color={c.dot}/>
              {c.id===current.id && <Icon name="check" size={17} style={{color:'var(--cian)'}}/>}
            </div>
          ))}
        </div>
        <div style={{padding:'10px 18px',borderTop:'1px solid var(--border-1)',display:'flex',gap:16,fontSize:11.5,color:'var(--text-3)',fontWeight:600}}>
          <span>↑↓ navegar</span><span>↵ seleccionar</span><span style={{marginLeft:'auto'}}>{filtered.length} contactos</span>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
