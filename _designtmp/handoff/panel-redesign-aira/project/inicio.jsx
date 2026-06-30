/* ============================================================
   AIRA · Inicio (dashboard de operación)
   Reusa styles.css + icons.jsx + ui.jsx + charts.jsx
   ============================================================ */
const {useState, useEffect, useRef} = React;

/* ---------------- DATA (demo realista, operación chica) ---------------- */
const DASH = {
  ctx:{ agentes:4, colas:4 },
  ops:{ online:4, enCola:3, esperaMax:'2:14', sla:94 },
  insights:[
    {color:'--verde', icon:'sparkles', eyebrow:'Oportunidad · IA', title:'Pico de leads vía WhatsApp',
     desc:'+34% de leads entrantes por WhatsApp vs. la semana anterior. Buen momento para activar una plantilla de bienvenida.', cta:'Crear plantilla'},
    {color:'--cian', icon:'trending', eyebrow:'En máximo', title:'CSAT en su mejor nivel',
     desc:'86% de satisfacción · 24 promotores en 30 encuestas esta semana.', cta:'Ver detalle'},
  ],
  kpis:[
    {icon:'headset', color:'--cian',   label:'Contactos',     value:'342',  delta:'+12%', dir:'up',   foot:'vs periodo anterior'},
    {icon:'gauge',   color:'--verde',  label:'Sentiment +',   value:'68%',  delta:'+6%',  dir:'up',   foot:'del total analizado'},
    {icon:'clock',   color:'--violeta',label:'AHT promedio',  value:'4:12', delta:null,                foot:'meta 3:00 min'},
    {icon:'zap',     color:'--ambar',  label:'Leads',         value:'58',   delta:'-8%',  dir:'down', foot:'vs periodo anterior'},
    {icon:'calendar',color:'--cian',   label:'Citas próximas',value:'7',    delta:null,                foot:'de 9 agendadas'},
    {icon:'send',    color:'--verde',  label:'Plantillas WA', value:'13',   delta:null,                foot:'envíos aprobados'},
    {icon:'users',   color:'--violeta',label:'Agentes',       value:'4',    delta:null,                foot:'3 online'},
  ],
  volLabels:['9/6','10/6','11/6','12/6','13/6','14/6','15/6'],
  volThis:[42,58,35,61,78,96,54],
  volPrev:[38,45,40,52,60,70,48],
  byChannel:{
    Llamadas:[20,26,15,28,34,40,22],
    WhatsApp:[16,24,14,25,32,44,24],
    Email:[6,8,6,8,12,12,8],
  },
  sentiment:[
    {label:'Positivo', value:198, color:'--verde'},
    {label:'Neutral',  value:82,  color:'--text-3'},
    {label:'Mixto',    value:44,  color:'--ambar'},
    {label:'Negativo', value:18,  color:'--rojo'},
  ],
  csat:86,
  agents:[
    {label:'Camila Rojas', value:128, color:'--cian'},
    {label:'Diego Paredes', value:96, color:'--verde'},
    {label:'Valentina Núñez', value:74, color:'--violeta'},
    {label:'Mateo Salas', value:44, color:'--ambar'},
  ],
  queues:[
    {label:'Cobranzas', value:142, color:'--cian', sub:'· 38% del total'},
    {label:'Admisión',  value:98,  color:'--verde'},
    {label:'Soporte',   value:62,  color:'--violeta'},
    {label:'Ventas',    value:40,  color:'--ambar'},
  ],
  funnel:[
    {label:'Nuevos',      value:186, color:'--cian'},
    {label:'Contactados', value:124, color:'--cian'},
    {label:'Calificados', value:78,  color:'--verde'},
    {label:'Propuesta',   value:42,  color:'--verde'},
    {label:'Ganados',     value:23,  color:'--verde'},
  ],
};

/* ---------------- NAV (compartido, Inicio activo, cross-link) ---------------- */
function Nav(){
  const {Icon}=window;
  const groups=[
    {title:'Operación', items:[['Inicio','home','Inicio.html',true],['Agent Desktop','headset'],['Cola en vivo','live']]},
    {title:'Crecimiento', items:[['Leads','users'],['Campañas','megaphone'],['Bots','bot'],['Automatizaciones','zap'],['Agente IA','sparkles'],['Citas','calendar'],['Reportes','chart'],['Grabaciones','mic',"Historial y Grabaciones.html"]]},
    {title:'Sistema', items:[['Configuración','settings']]},
  ];
  const integ=[['WhatsApp','--verde'],['Salesforce','--cian'],['Amazon Connect','--ambar']];
  return (
    <nav className="nav">
      <div className="nav-brand">
        <div className="nav-logo"><Icon name="layers" size={17} stroke={2.4}/></div>
        <span className="nav-brandname">AIRA</span>
      </div>
      <button className="nav-search">
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
        <span style={{marginLeft:'auto',width:8,height:8,borderRadius:99,background:'var(--verde)'}}/>
      </div>
    </nav>
  );
}

/* ---------------- TOPBAR ---------------- */
function Topbar(){
  const {Icon}=window;
  const [now,setNow]=useState(new Date());
  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(id); },[]);
  const hh=now.getHours(), mm=String(now.getMinutes()).padStart(2,'0');
  const ap=hh<12?'a.m.':'p.m.'; const h12=((hh+11)%12)+1;
  return (
    <div className="topbar">
      <div className="topbar-title">
        <div className="tb-crumb"><span>Operación</span><Icon name="chevR" size={13}/><span className="tb-here">Inicio</span></div>
      </div>
      <div className="topbar-right">
        <button className="avail-pill"><span style={{width:7,height:7,borderRadius:99,background:'var(--verde)'}}/> Disponible <Icon name="chevD" size={13}/></button>
        <div className="live-pill"><span className="pulse-dot" style={{width:7,height:7,borderRadius:99,background:'var(--rojo)'}}/> Live · {h12}:{mm} {ap}</div>
        <div className="sectb-vdiv"></div>
        <button className="sectb-cta primary"><Icon name="refresh" size={15}/> Actualizar</button>
      </div>
    </div>
  );
}

/* ---------------- LIVE OPS (estado en vivo) ---------------- */
function LiveOps(){
  const {Icon,initials}=window;
  const stack=DASH.agents.slice(0,4);
  return (
    <div className="liveops">
      <div className="ops-live"><span className="pulse-dot" style={{width:7,height:7,borderRadius:99,background:'var(--verde)'}}/> En vivo</div>
      <div className="ops-sep"></div>
      <div className="ops-stack">
        <div className="stk">
          {stack.map((a,i)=>(
            <span key={i} className="av" style={{background:`var(${a.color})`,zIndex:stack.length-i}} data-tooltip={a.label}>{initials(a.label)}</span>
          ))}
        </div>
        <span className="ops-val"><b>{DASH.ops.online}</b> en línea</span>
      </div>
      <div className="ops-sep"></div>
      <div className={"ops-chip"+(DASH.ops.enCola>0?' warn':'')} data-tooltip="Contactos esperando">
        <Icon name="headset" size={15}/> <b>{DASH.ops.enCola}</b> en cola
      </div>
      <div className="ops-chip" data-tooltip="Espera máxima actual"><Icon name="clock" size={15}/> {DASH.ops.esperaMax} máx</div>
      <div className="ops-chip" data-tooltip="Nivel de servicio"><Icon name="check" size={15}/> SLA {DASH.ops.sla}%</div>
    </div>
  );
}

/* ---------------- KPI ---------------- */
function Kpi({icon,color,label,value,delta,dir,foot,spark}){
  const {Icon,Sparkline}=window;
  return (
    <div className="card kpi lift">
      <div className="kpi-top">
        <span className="kpi-ico" style={{background:`var(${color}-soft)`,color:`var(${color})`}}><Icon name={icon} size={15}/></span>
        {label}
      </div>
      <div className="kpi-val" style={{color:`var(${color})`}}>{value}</div>
      <div className="kpi-foot">
        {delta && <span className={"delta "+dir}><Icon name={dir==='up'?'arrowOut':'arrowIn'} size={12}/>{delta}</span>}
        {foot}
      </div>
    </div>
  );
}

/* ---------------- APP ---------------- */
function InicioApp(){
  const {Icon,Dot,AreaChart,Donut,Gauge,BarList,Funnel,useFloatingTip}=window;
  useFloatingTip();
  const [range,setRange]=useState('Semana');
  const [volMode,setVolMode]=useState('comparacion');

  const series = volMode==='comparacion'
    ? [{name:'Esta semana',data:DASH.volThis,color:'--violeta'},
       {name:'Semana anterior',data:DASH.volPrev,color:'--text-3',dash:true,fill:false}]
    : [{name:'Llamadas',data:DASH.byChannel.Llamadas,color:'--cian'},
       {name:'WhatsApp',data:DASH.byChannel.WhatsApp,color:'--verde',fill:false},
       {name:'Email',data:DASH.byChannel.Email,color:'--ambar',fill:false}];

  const sentTotal=DASH.sentiment.reduce((s,x)=>s+x.value,0);

  return (
    <div className="app">
      <Nav/>
      <div className="main">
        <Topbar/>
        <div className="content">
          <div className="content-inner view-enter">

            {/* filtro de tiempo + estado en vivo */}
            <div className="dash-filter">
              <div className="tseg">
                {['Hoy','Ayer','Semana','Mes'].map(t=>(
                  <button key={t} className={"tseg-btn"+(range===t?' on':'')} onClick={()=>setRange(t)}>{t}</button>
                ))}
              </div>
              <LiveOps/>
            </div>

            {/* insights */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
              {DASH.insights.map((it,i)=>(
                <div key={i} className="card insight lift">
                  <span style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:`var(${it.color})`}}/>
                  <div className="insight-ico" style={{background:`var(${it.color}-soft)`,color:`var(${it.color})`}}><Icon name={it.icon} size={20}/></div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="insight-eyebrow" style={{color:`var(${it.color}-2)`}}>{it.eyebrow}</div>
                    <div className="insight-title">{it.title}</div>
                    <div className="insight-desc">{it.desc}</div>
                    <button className="insight-cta" style={{color:`var(${it.color})`}}>{it.cta} <Icon name="arrowRight" size={14}/></button>
                  </div>
                </div>
              ))}
            </div>

            {/* KPIs */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:14,marginBottom:16}}>
              {DASH.kpis.map((k,i)=><Kpi key={i} {...k}/>)}
            </div>

            {/* charts */}
            <div style={{display:'grid',gridTemplateColumns:'1.7fr 1fr',gap:16,marginBottom:16}}>
              <div className="card ch-card">
                <div className="ch-head">
                  <div className="ch-title">Volumen de contactos</div>
                  <div className="miniseg">
                    <button className={"miniseg-btn"+(volMode==='comparacion'?' on':'')} onClick={()=>setVolMode('comparacion')}>Comparación</button>
                    <button className={"miniseg-btn"+(volMode==='canal'?' on':'')} onClick={()=>setVolMode('canal')}>Por canal</button>
                  </div>
                </div>
                <AreaChart labels={DASH.volLabels} series={series} height={280}/>
                <div style={{display:'flex',gap:18,marginTop:6,flexWrap:'wrap'}}>
                  {series.map((s,i)=>(
                    <span key={i} style={{display:'flex',alignItems:'center',gap:7,fontSize:12.5,fontWeight:600,color:'var(--text-2)'}}>
                      <span style={{width:10,height:3,borderRadius:99,background:`var(${s.color})`,opacity:s.dash?.6:1}}/>{s.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="card ch-card">
                <div className="ch-head"><div className="ch-title" style={{}}>Sentiment de contactos</div></div>
                <div style={{display:'flex',alignItems:'center',gap:22,padding:'8px 0'}}>
                  <Donut segments={DASH.sentiment} centerValue={sentTotal} centerLabel="contactos"/>
                  <div className="legend" style={{flex:1}}>
                    {DASH.sentiment.map((s,i)=>(
                      <div key={i} className="legend-row">
                        <Dot color={s.color}/> {s.label}
                        <span className="mono">{Math.round(s.value/sentTotal*100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* embudo de leads */}
            <div className="card ch-card" style={{marginBottom:16}}>
              <div className="ch-head">
                <div className="ch-title">Embudo de leads</div>
                <div style={{display:'flex',alignItems:'center',gap:14}}>
                  <span style={{fontSize:12.5,color:'var(--text-3)',fontWeight:600}}>Conversión total</span>
                  <span style={{fontSize:15,fontWeight:800,color:'var(--verde)'}}>{Math.round(DASH.funnel[DASH.funnel.length-1].value/DASH.funnel[0].value*100*10)/10}%</span>
                </div>
              </div>
              <Funnel stages={DASH.funnel}/>
            </div>

            {/* bottom row */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1.15fr 1.15fr',gap:16}}>
              <div className="card ch-card">
                <div className="ch-head"><div className="ch-title">Satisfacción (CSAT)</div></div>
                <Gauge value={DASH.csat} color="--verde" label="satisfacción promedio"/>
                <div style={{display:'flex',justifyContent:'space-around',marginTop:14,paddingTop:14,borderTop:'1px solid var(--border-1)'}}>
                  {[['Promotores','24','--verde'],['Pasivos','4','--text-3'],['Detractores','2','--rojo']].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:'center'}}>
                      <div style={{fontSize:19,fontWeight:800,color:`var(${c})`}}>{v}</div>
                      <div style={{fontSize:11.5,color:'var(--text-3)',fontWeight:600,marginTop:2}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card ch-card">
                <div className="ch-head">
                  <div className="ch-title">Ranking de agentes</div>
                  <span style={{fontSize:11,fontWeight:700,letterSpacing:'.05em',color:'var(--text-3)'}}>POR CONTACTOS</span>
                </div>
                <BarList items={DASH.agents} showAvatar/>
              </div>

              <div className="card ch-card">
                <div className="ch-head">
                  <div className="ch-title">Contactos por cola</div>
                  <span style={{fontSize:11,fontWeight:700,letterSpacing:'.05em',color:'var(--text-3)'}}>342 TOTAL</span>
                </div>
                <BarList items={DASH.queues}/>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* copilot tab */}
      <div className="copilot-tab" data-tooltip="Abrir Copilot"><Icon name="sparkles" size={16}/> Copilot</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<InicioApp/>);
