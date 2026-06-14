/* ============================================================
   AIRA · 3 conceptos de layout (frames estáticos hi-fi)
   Reusa tokens de styles.css + primitivos de ui.jsx + DATA
   Monta un DesignCanvas con 3 artboards.
   ============================================================ */

/* ---- Chrome compartido (compacto) ---- */
function NavMini({active="Grabaciones"}){
  const {Icon}=window;
  const groups=[
    {title:'Operación', items:[['Inicio','home'],['Agent Desktop','headset'],['Cola en vivo','live']]},
    {title:'Crecimiento', items:[['Leads','users'],['Campañas','megaphone'],['Bots','bot'],['Automatizaciones','zap'],['Agente IA','sparkles'],['Citas','calendar'],['Reportes','chart'],['Grabaciones','mic']]},
    {title:'Sistema', items:[['Configuración','settings']]},
  ];
  const integ=[['WhatsApp','--verde'],['Salesforce','--cian'],['Amazon Connect','--ambar']];
  return (
    <div style={{width:212,flex:'0 0 212px',height:'100%',background:'var(--bg-1)',borderRight:'1px solid var(--border-1)',display:'flex',flexDirection:'column'}}>
      <div className="nav-brand" style={{height:56}}>
        <div className="nav-logo"><Icon name="layers" size={16} stroke={2.4}/></div>
        <span className="nav-brandname">AIRA</span>
      </div>
      <div className="nav-scroll" style={{padding:'4px 12px'}}>
        {groups.map(g=>(
          <div key={g.title}>
            <div className="nav-section" style={{padding:'10px 10px 4px'}}>{g.title}</div>
            {g.items.map(([label,icon])=>(
              <div key={label} className={"nav-item"+(label===active?' active':'')} style={{padding:'6px 10px',fontSize:13}}>
                <Icon name={icon} size={17}/> {label}
              </div>
            ))}
          </div>
        ))}
        <div className="nav-section" style={{padding:'10px 10px 4px'}}>Integraciones</div>
        {integ.map(([label,color])=>(
          <div key={label} className="nav-item" style={{padding:'6px 10px',fontSize:13}}><span style={{width:7,height:7,borderRadius:99,background:`var(${color})`,marginRight:4}}/> {label}</div>
        ))}
      </div>
      <div className="nav-user" style={{padding:'10px 14px'}}>
        <div className="av">A</div>
        <div><div style={{fontWeight:700,fontSize:12.5}}>anedre12345</div><small>Admin</small></div>
        <span style={{marginLeft:'auto',width:8,height:8,borderRadius:99,background:'var(--verde)'}}/>
      </div>
    </div>
  );
}
function TopbarMini(){
  const {Icon}=window;
  return (
    <div className="topbar" style={{height:56,flex:'0 0 56px',padding:'0 18px'}}>
      <div className="search-global" style={{flex:'0 0 360px',padding:'7px 11px',fontSize:12.5}}>
        <Icon name="search" size={15}/>
        <span style={{flex:1}}>Buscar contactos, agentes, transcripciones…</span>
        <span className="kbd">Ctrl K</span>
      </div>
      <div className="topbar-right">
        <div className="status-pill" style={{padding:'5px 11px',fontSize:12}}><span className="pulse-dot" style={{width:7,height:7,borderRadius:99,background:'var(--ambar)'}}/> Conectando…</div>
        <button className="ico-btn" style={{width:32,height:32}}><Icon name="moon" size={17}/></button>
        <button className="ico-btn" style={{width:32,height:32}}><Icon name="bell" size={17}/></button>
        <button className="ico-btn" style={{width:32,height:32}}><Icon name="user" size={17}/></button>
      </div>
    </div>
  );
}

/* ============================================================
   CONCEPTO A — "Una sola historia" (el flagship)
   hero + tabs horizontales + Resumen
   ============================================================ */
function ConceptA(){
  const D=window.DATA;
  const {Icon,Chip,Dot,Sparkline,Heatmap,StackedBar}=window;
  const TABS=[['Resumen','gauge',null,'--cian',true],['Llamadas','phone',118,'--cian'],['WhatsApp','chat',80,'--verde'],['Emails','mail',2,'--ambar'],['Archivos','paperclip',3,'--violeta'],['Actividad','history',7,'--violeta']];
  const pulses=[['Llamadas',118,'--cian','phone'],['WhatsApp',80,'--verde','chat'],['Emails',2,'--ambar','mail'],['Archivos',3,'--violeta','paperclip'],['Actividad',7,'--violeta','history']];
  return (
    <div style={{width:'100%',height:'100%',display:'flex',background:'var(--bg-0)'}}>
      <NavMini/>
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        <TopbarMini/>
        <div style={{flex:1,overflow:'hidden',padding:'18px 26px'}}>
          <div className="crumb" style={{fontSize:12}}>Crecimiento</div>
          <h1 style={{fontSize:22,fontWeight:800,letterSpacing:'-.02em',margin:'4px 0 0'}}>Historial y Grabaciones</h1>
          {/* hero */}
          <div className="card" style={{display:'flex',alignItems:'center',gap:16,padding:'16px 20px',marginTop:14}}>
            <div style={{width:52,height:52,borderRadius:15,background:'linear-gradient(140deg,var(--cian),#0a6c84)',color:'#fff',display:'grid',placeItems:'center',fontWeight:800,fontSize:19}}>AE</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:7}}><span style={{fontSize:20,fontWeight:800,letterSpacing:'-.02em'}}>Andre Elian Alata Calle</span><Icon name="chevD" size={18} style={{color:'var(--text-3)'}}/></div>
              <div style={{display:'flex',gap:7,marginTop:7,alignItems:'center'}}>
                <Chip color="--cian"><Icon name="phone" size={12}/> Teléfono</Chip><Chip>No contactado</Chip>
                <span className="mono" style={{fontSize:12.5,color:'var(--text-2)',fontWeight:700}}>70498978</span>
              </div>
            </div>
            <div style={{display:'flex',gap:7}}>
              {['phone','chat','mail'].map((ic,i)=><div key={ic} className="act-btn" style={{width:36,height:36,color:`var(${['--cian','--verde','--ambar'][i]})`}}><Icon name={ic} size={17}/></div>)}
              <button className="btn btn-primary" style={{marginLeft:2}}><Icon name="sparkles" size={14}/> Resumen IA</button>
            </div>
          </div>
          {/* pulse cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:11,marginTop:14}}>
            {pulses.map(([l,n,c,ic])=>(
              <div key={l} className="card" style={{padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontSize:23,fontWeight:800,letterSpacing:'-.03em',color:`var(${c})`}}>{n}</div>
                  <div style={{width:27,height:27,borderRadius:8,background:`var(${c}-soft)`,color:`var(${c})`,display:'grid',placeItems:'center'}}><Icon name={ic} size={14}/></div>
                </div>
                <div style={{color:'var(--text-2)',fontWeight:700,fontSize:12,marginTop:7}}>{l}</div>
              </div>
            ))}
          </div>
          {/* tabs */}
          <div className="tabs" style={{marginTop:14,display:'inline-flex'}}>
            {TABS.map(([l,ic,n,c,on])=>(
              <button key={l} className={"tab"+(on?' active':'')} style={on?{background:`var(${c})`,boxShadow:'var(--sh-2)'}:undefined}>
                <Icon name={ic} size={15}/> {l}{n!=null&&<span className="badge">{n}</span>}
              </button>
            ))}
          </div>
          {/* resumen content */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:14,marginTop:14}}>
            <div className="card" style={{padding:'16px 18px'}}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:12}}>Mapa de actividad</div>
              <div style={{transform:'scale(.92)',transformOrigin:'top left'}}><Heatmap porDia={D.porDia} selKey={null} sentColor={D.sentColor} weeks={26} onSelect={()=>{}}/></div>
            </div>
            <div className="card" style={{padding:'16px 18px'}}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:12}}>Resumen del cliente</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12.5,padding:'5px 0'}}><span style={{color:'var(--text-3)'}}>Canal principal</span><b>Llamadas</b></div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12.5,padding:'5px 0'}}><span style={{color:'var(--text-3)'}}>Total</span><b className="mono">200</b></div>
              <div style={{margin:'10px 0 6px',fontSize:11.5,fontWeight:700,color:'var(--text-3)'}}>Mezcla de canales</div>
              <StackedBar segments={[{label:'Ll',v:118,color:'--cian'},{label:'WA',v:80,color:'--verde'},{label:'Em',v:2,color:'--ambar'}]} h={9}/>
              <div style={{marginTop:12,padding:'10px 12px',borderRadius:9,background:'var(--cian-soft)',color:'var(--cian-2)',fontSize:12,fontWeight:600,display:'flex',gap:8}}><Icon name="sparkles" size={14}/> Buen momento para un seguimiento.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CONCEPTO B — "Cockpit"
   nav + riel vertical de canales + centro Llamadas + dock IA fijo
   ============================================================ */
function ConceptB(){
  const D=window.DATA;
  const {Icon,Chip,Dot,Waveform,Heatmap,StackedBar,fmtDur}=window;
  const channels=[['Llamadas','phone',118,'--cian',true],['WhatsApp','chat',80,'--verde'],['Emails','mail',2,'--ambar'],['Archivos','paperclip',3,'--violeta'],['Actividad','history',7,'--violeta']];
  const call=D.ejemploCall;
  return (
    <div style={{width:'100%',height:'100%',display:'flex',background:'var(--bg-0)'}}>
      <NavMini/>
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        <TopbarMini/>
        {/* contact strip */}
        <div style={{display:'flex',alignItems:'center',gap:13,padding:'12px 22px',background:'var(--bg-1)',borderBottom:'1px solid var(--border-1)'}}>
          <div style={{width:40,height:40,borderRadius:12,background:'linear-gradient(140deg,var(--cian),#0a6c84)',color:'#fff',display:'grid',placeItems:'center',fontWeight:800,fontSize:15}}>AE</div>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:7}}><span style={{fontSize:16,fontWeight:800}}>Andre Elian Alata Calle</span><Icon name="chevD" size={15} style={{color:'var(--text-3)'}}/></div>
            <div style={{fontSize:11.5,color:'var(--text-3)',display:'flex',gap:8,alignItems:'center'}}><Chip color="--cian" style={{fontSize:10,padding:'2px 7px'}}>Teléfono</Chip> 70498978 · 200 interacciones</div>
          </div>
          <div style={{marginLeft:'auto',display:'flex',gap:7}}>
            {['phone','chat','mail'].map((ic,i)=><div key={ic} className="act-btn" style={{width:34,height:34,color:`var(${['--cian','--verde','--ambar'][i]})`}}><Icon name={ic} size={16}/></div>)}
          </div>
        </div>
        <div style={{flex:1,display:'flex',minHeight:0}}>
          {/* vertical channel rail */}
          <div style={{width:96,flex:'0 0 96px',background:'var(--bg-1)',borderRight:'1px solid var(--border-1)',padding:'12px 10px',display:'flex',flexDirection:'column',gap:7}}>
            {channels.map(([l,ic,n,c,on])=>(
              <div key={l} style={{borderRadius:12,padding:'11px 4px',textAlign:'center',cursor:'pointer',position:'relative',
                background:on?`var(${c}-soft)`:'transparent',color:on?`var(${c})`:'var(--text-3)'}}>
                {on&&<span style={{position:'absolute',left:0,top:10,bottom:10,width:3,borderRadius:'0 3px 3px 0',background:`var(${c})`}}/>}
                <Icon name={ic} size={19}/>
                <div style={{fontSize:10.5,fontWeight:700,marginTop:4,color:on?`var(${c})`:'var(--text-2)'}}>{l}</div>
                <div style={{fontSize:13,fontWeight:800,marginTop:1,color:on?`var(${c})`:'var(--text-2)'}}>{n}</div>
              </div>
            ))}
          </div>
          {/* center work area */}
          <div style={{flex:1,minWidth:0,padding:'16px 18px',overflow:'hidden'}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14}}>
              {[['Total',118,'--cian'],['Contestadas','86%','--verde'],['Dur. prom','5:21','--violeta'],['Perdidas',17,'--rojo']].map(([l,v,c])=>(
                <div key={l} className="card" style={{padding:'11px 13px'}}>
                  <div style={{fontSize:21,fontWeight:800,letterSpacing:'-.03em',color:`var(${c})`}}>{v}</div>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--text-2)',marginTop:4}}>{l}</div>
                </div>
              ))}
            </div>
            <div className="card" style={{padding:'14px 16px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>Actividad · 6 meses</div>
              <div style={{transform:'scale(.84)',transformOrigin:'top left',height:96}}><Heatmap porDia={D.porDia} selKey={D.key(call.date)} sentColor={D.sentColor} weeks={24} onSelect={()=>{}}/></div>
            </div>
            {/* mini player */}
            <div className="card" style={{padding:'14px 16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                <div style={{width:34,height:34,borderRadius:10,background:'var(--cian-soft)',color:'var(--cian)',display:'grid',placeItems:'center'}}><Icon name="arrowIn" size={16}/></div>
                <div><div style={{fontWeight:800,fontSize:13.5}}>Llamada · Promesa de pago</div><div style={{fontSize:11.5,color:'var(--text-3)'}}>Camila Rojas · 6 jun · 5:27</div></div>
                <Chip color="--ambar" style={{marginLeft:'auto'}}>mixto</Chip>
              </div>
              <div style={{transform:'scaleY(.7)',transformOrigin:'center'}}><Waveform call={call} progress={0.38} onSeek={()=>{}} sentColor={D.sentColor}/></div>
              <div style={{display:'flex',alignItems:'center',gap:12,marginTop:6}}>
                <div style={{width:42,height:42,borderRadius:13,background:'var(--cian)',color:'#fff',display:'grid',placeItems:'center'}}><Icon name="play" size={18} fill="#fff" stroke={0}/></div>
                <span className="mono" style={{fontSize:12,fontWeight:700,color:'var(--text-2)'}}>2:05 / 5:27</span>
              </div>
            </div>
          </div>
          {/* right AI dock (persistente) */}
          <div style={{width:282,flex:'0 0 282px',background:'var(--bg-1)',borderLeft:'1px solid var(--border-1)',padding:'16px 16px',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
              <div style={{width:26,height:26,borderRadius:8,background:'var(--violeta)',color:'#fff',display:'grid',placeItems:'center'}}><Icon name="sparkles" size={15}/></div>
              <span style={{fontWeight:800,fontSize:14}}>Inteligencia</span>
            </div>
            <div style={{padding:'12px 13px',borderRadius:12,background:'linear-gradient(135deg,var(--violeta-soft),#f5f3fd)',border:'1px solid #e1ddf6',marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:800,color:'var(--violeta-2)',marginBottom:6}}>RESUMEN IA</div>
              <div style={{fontSize:12,color:'var(--text-2)',lineHeight:1.5,display:'-webkit-box',WebkitLineClamp:5,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{call.resumenIA}</div>
            </div>
            <div style={{fontSize:11,fontWeight:800,color:'var(--text-3)',margin:'4px 0 8px'}}>SENTIMIENTO</div>
            <StackedBar segments={[{label:'pos',v:46,color:'--verde'},{label:'neu',v:34,color:'--text-3'},{label:'mix',v:13,color:'--ambar'},{label:'neg',v:7,color:'--rojo'}]} h={9}/>
            <div style={{fontSize:11,fontWeight:800,color:'var(--text-3)',margin:'16px 0 8px'}}>MOMENTOS CLAVE</div>
            {call.momentos.slice(0,3).map((m,i)=>(
              <div key={i} className="card-2" style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',marginBottom:6}}>
                <span className="mono" style={{fontSize:11,color:'var(--text-3)',fontWeight:700}}>{fmtDur(m.t)}</span>
                <Dot color={m.tone==='positivo'?'--verde':m.tone==='negativo'?'--rojo':'--ambar'}/>
                <span style={{fontSize:12,fontWeight:600}}>{m.label}</span>
              </div>
            ))}
            <button className="btn btn-primary" style={{width:'100%',justifyContent:'center',marginTop:8}}><Icon name="zap" size={14}/> Crear seguimiento</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CONCEPTO C — "Stream"
   feed omnicanal vertical, filtro segmentado, expand inline
   ============================================================ */
function ConceptC(){
  const D=window.DATA;
  const {Icon,Chip,Dot,Waveform,fmtDur,Avatar}=window;
  const call=D.ejemploCall;
  const feed=[
    {ch:'cian',icon:'arrowOut',title:'Llamada saliente',meta:'Camila Rojas · hace 5 d · 5:27',sent:'mixto',expanded:true},
    {ch:'verde',icon:'chat',title:'WhatsApp · 12 mensajes',meta:'Andre · hace 6 d',body:'“Listo, ya pagué la mitad” · adjuntó captura_yape.jpg'},
    {ch:'cian',icon:'missed',title:'Llamada perdida',meta:'Cola: Cobranzas · hace 8 d',sent:'negativo',body:'No contestada · 0:00'},
    {ch:'ambar',icon:'mail',title:'Email · Consulta admisión 2027',meta:'Andre · hace 22 d',body:'Solicita información sobre Ingeniería de Sistemas.'},
  ];
  return (
    <div style={{width:'100%',height:'100%',display:'flex',background:'var(--bg-0)'}}>
      <NavMini/>
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        <TopbarMini/>
        <div style={{flex:1,overflow:'hidden',display:'flex',justifyContent:'center'}}>
          <div style={{width:'100%',maxWidth:760,padding:'18px 20px'}}>
            {/* contact + segmented filter */}
            <div style={{display:'flex',alignItems:'center',gap:13,marginBottom:14}}>
              <div style={{width:46,height:46,borderRadius:14,background:'linear-gradient(140deg,var(--cian),#0a6c84)',color:'#fff',display:'grid',placeItems:'center',fontWeight:800,fontSize:17}}>AE</div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:7}}><span style={{fontSize:19,fontWeight:800,letterSpacing:'-.02em'}}>Andre Elian Alata Calle</span><Icon name="chevD" size={16} style={{color:'var(--text-3)'}}/></div>
                <div style={{fontSize:12,color:'var(--text-3)'}}>Teléfono · 70498978 · 200 interacciones</div>
              </div>
              {['phone','chat','mail'].map((ic,i)=><div key={ic} className="act-btn" style={{width:36,height:36,color:`var(${['--cian','--verde','--ambar'][i]})`}}><Icon name={ic} size={16}/></div>)}
            </div>
            {/* segmented filter (floating) */}
            <div style={{display:'flex',gap:6,marginBottom:16,position:'sticky',top:0}}>
              {[['Todo',null,true],['Llamadas','--cian'],['WhatsApp','--verde'],['Emails','--ambar'],['Archivos','--violeta'],['Actividad','--violeta']].map(([l,c,on])=>(
                <button key={l} className={"fchip"+(on?' on':'')} style={{fontSize:12}}>{l}</button>
              ))}
            </div>
            {/* feed */}
            <div style={{position:'relative'}}>
              <div style={{position:'absolute',left:17,top:8,bottom:8,width:2,background:'var(--border-2)'}}/>
              {feed.map((f,i)=>(
                <div key={i} style={{display:'flex',gap:14,marginBottom:14,position:'relative'}}>
                  <div style={{width:36,height:36,flex:'0 0 36px',borderRadius:11,background:`var(--${f.ch}-soft)`,color:`var(--${f.ch})`,display:'grid',placeItems:'center',zIndex:1,boxShadow:'0 0 0 4px var(--bg-0)'}}><Icon name={f.icon} size={17}/></div>
                  <div className="card" style={{flex:1,borderLeft:`3px solid var(--${f.ch})`,padding:f.expanded?'0':'13px 16px',overflow:'hidden'}}>
                    {f.expanded? (
                      <>
                        <div style={{padding:'13px 16px',display:'flex',alignItems:'center',gap:9}}>
                          <span style={{fontWeight:800,fontSize:14}}>{f.title}</span>
                          <Chip color={D.sentColor[f.sent]}>{f.sent}</Chip>
                          <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-3)'}}>{f.meta}</span>
                        </div>
                        <div style={{padding:'4px 16px 14px',background:'var(--bg-2)',borderTop:'1px solid var(--border-1)'}}>
                          <div style={{transform:'scaleY(.66)',transformOrigin:'center',marginTop:6}}><Waveform call={call} progress={0.4} onSeek={()=>{}} sentColor={D.sentColor}/></div>
                          <div style={{display:'flex',alignItems:'center',gap:11,marginTop:4}}>
                            <div style={{width:38,height:38,borderRadius:12,background:'var(--cian)',color:'#fff',display:'grid',placeItems:'center'}}><Icon name="play" size={16} fill="#fff" stroke={0}/></div>
                            <span className="mono" style={{fontSize:11.5,fontWeight:700,color:'var(--text-2)'}}>2:11 / 5:27</span>
                            <span style={{fontSize:11.5,color:'var(--text-3)',marginLeft:'auto'}}>“…dame hasta el 28 y la pago completa”</span>
                          </div>
                        </div>
                      </>
                    ):(
                      <>
                        <div style={{display:'flex',alignItems:'center',gap:9}}>
                          <span style={{fontWeight:700,fontSize:14}}>{f.title}</span>
                          {f.sent&&<Dot color={D.sentColor[f.sent]} size={7}/>}
                          <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-3)'}}>{f.meta}</span>
                        </div>
                        {f.body&&<div style={{fontSize:12.5,color:'var(--text-2)',marginTop:5}}>{f.body}</div>}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Montaje del canvas ---- */
function ConceptsApp(){
  const {useFloatingTip}=window; useFloatingTip&&useFloatingTip();
  const W=1340, H=864;
  return (
    <window.DesignCanvas>
      <window.DCSection id="layouts" title="Historial y Grabaciones — 3 direcciones de layout"
        subtitle="Mismo sistema visual y data densa real. Comparalas, mezclá lo que te guste, o pedime más.">
        <window.DCArtboard id="A" label="A · Una sola historia (actual)" width={W} height={H}><ConceptA/></window.DCArtboard>
        <window.DCArtboard id="B" label="B · Cockpit — riel de canales + dock IA" width={W} height={H}><ConceptB/></window.DCArtboard>
        <window.DCArtboard id="C" label="C · Stream — feed omnicanal" width={W} height={H}><ConceptC/></window.DCArtboard>
      </window.DCSection>
    </window.DesignCanvas>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<ConceptsApp/>);
