/* ============================================================
   AIRA · Vistas Resumen/WhatsApp/Emails/Archivos/Actividad
   + Lightbox + Resumen IA slide-over
   ============================================================ */

/* ---------------- RESUMEN (vista por defecto) ---------------- */
function OverviewView({onGoto, onOpenSummary}){
  const D=window.DATA;
  const {Heatmap, Sparkline, StackedBar, Dot, Icon, Avatar, Chip, fmtDur}=window;
  const ej=D.ejemploCall;
  const timeline=[
    {ch:'cian', icon:'phone', title:'Llamada saliente · Promesa de pago', who:'Camila Rojas', time:'hace 5 días', sent:'mixto', body:'Reverso de cobro duplicado + promesa de pago para el 28.'},
    {ch:'verde', icon:'chat', title:'WhatsApp · 12 mensajes', who:'Andre', time:'hace 6 días', body:'Compartió captura de Yape y confirmó pago parcial.'},
    {ch:'cian', icon:'phone', title:'Llamada perdida', who:'Cola: Cobranzas', time:'hace 8 días', sent:'negativo', body:'No contestada · 0:00'},
    {ch:'ambar', icon:'mail', title:'Email · Consulta admisión 2027', who:'Andre', time:'hace 22 días', body:'Solicita información sobre Ingeniería de Sistemas.'},
  ];
  return (
    <div className="view-enter" style={{display:'grid',gridTemplateColumns:'1fr 360px',gap:18,alignItems:'start'}}>
      {/* col izquierda */}
      <div style={{display:'flex',flexDirection:'column',gap:18}}>
        {/* heatmap resumen */}
        <div className="card" style={{padding:'20px 22px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{fontWeight:800,fontSize:15}}>Mapa de actividad</div>
            <button className="fchip" onClick={()=>onGoto('llamadas')}>Ver llamadas <Icon name="arrowRight" size={13}/></button>
          </div>
          <div style={{overflowX:'auto'}}>
            <Heatmap porDia={D.porDia} selKey={null} sentColor={D.sentColor} weeks={30} onSelect={()=>onGoto('llamadas')}/>
          </div>
        </div>

        {/* timeline omnicanal */}
        <div className="card" style={{padding:'20px 22px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <div style={{fontWeight:800,fontSize:15}}>Línea de tiempo · todos los canales</div>
            <span style={{fontSize:12,color:'var(--text-3)',fontWeight:700}}>200 interacciones</span>
          </div>
          <div style={{paddingTop:10}}>
            {timeline.map((t,i)=>(
              <div className="tl-item" key={i}>
                <div className="tl-rail">
                  <div className="tl-node" style={{background:`var(--${t.ch}-soft)`,color:`var(--${t.ch})`}}><Icon name={t.icon} size={16}/></div>
                  {i<timeline.length-1 && <div className="tl-line"/>}
                </div>
                <div style={{paddingBottom:i<timeline.length-1?20:0,paddingLeft:4}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    <span style={{fontWeight:700,fontSize:14}}>{t.title}</span>
                    {t.sent && <Dot color={D.sentColor[t.sent]} size={7}/>}
                  </div>
                  <div style={{fontSize:12.5,color:'var(--text-3)',margin:'2px 0 6px'}}>{t.who} · {t.time}</div>
                  <div style={{fontSize:13,color:'var(--text-2)'}}>{t.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* col derecha: inteligencia */}
      <div style={{display:'flex',flexDirection:'column',gap:16}}>
        {/* resumen relación */}
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:14}}>Resumen del cliente</div>
          <Row label="Última interacción" value={<><Dot color="--cian"/> Llamada · hace 5 d</>}/>
          <Row label="Canal principal" value={<b>Llamadas</b>}/>
          <Row label="Total interacciones" value={<b className="mono">200</b>}/>
          <div style={{margin:'14px 0 8px',fontSize:12,fontWeight:700,color:'var(--text-3)'}}>Mezcla de canales</div>
          <StackedBar segments={[
            {label:'Llamadas',v:118,color:'--cian'},{label:'WhatsApp',v:80,color:'--verde'},
            {label:'Emails',v:2,color:'--ambar'},{label:'Archivos',v:3,color:'--violeta'}]} h={10}/>
          <div style={{display:'flex',gap:14,marginTop:10,fontSize:11.5,color:'var(--text-3)',fontWeight:700,flexWrap:'wrap'}}>
            <span style={{display:'flex',gap:5,alignItems:'center'}}><Dot color="--cian"/>118</span>
            <span style={{display:'flex',gap:5,alignItems:'center'}}><Dot color="--verde"/>80</span>
            <span style={{display:'flex',gap:5,alignItems:'center'}}><Dot color="--ambar"/>2</span>
          </div>
          <div style={{marginTop:14,padding:'11px 13px',borderRadius:10,background:'var(--cian-soft)',color:'var(--cian-2)',fontSize:12.5,fontWeight:600,display:'flex',gap:9}}>
            <Icon name="sparkles" size={16} style={{flex:'0 0 16px',marginTop:1}}/>
            Última actividad hace 5 días — buen momento para un seguimiento.
          </div>
        </div>

        {/* sentimiento */}
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{fontWeight:800,fontSize:14}}>Sentimiento global</div>
            <Chip color="--verde">+12% vs mes ant.</Chip>
          </div>
          <SentimentBar mix={D.sentMix}/>
        </div>

        {/* sugerencia next-best-action */}
        <button onClick={()=>onOpenSummary(ej)} className="card lift" style={{padding:'18px 20px',textAlign:'left',
          background:'linear-gradient(135deg,var(--violeta-soft),#f5f3fd)',border:'1px solid #e1ddf6'}}>
          <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:8}}>
            <div style={{width:28,height:28,borderRadius:9,background:'var(--violeta)',color:'#fff',display:'grid',placeItems:'center'}}><Icon name="sparkles" size={16}/></div>
            <span style={{fontWeight:800,fontSize:14,color:'var(--violeta-2)'}}>Sugerencia IA</span>
          </div>
          <div style={{fontSize:13,color:'var(--text-2)',lineHeight:1.55}}>El cliente tiene una promesa de pago para el <b>28</b>. Programa un recordatorio por WhatsApp 2 días antes.</div>
          <div style={{marginTop:10,fontSize:12.5,fontWeight:800,color:'var(--violeta)',display:'flex',gap:5,alignItems:'center'}}>Crear recordatorio <Icon name="arrowRight" size={14}/></div>
        </button>
      </div>
    </div>
  );
}
function Row({label,value}){
  return <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',fontSize:13}}>
    <span style={{color:'var(--text-3)',fontWeight:600}}>{label}</span>
    <span style={{display:'flex',alignItems:'center',gap:6}}>{value}</span>
  </div>;
}
function SentimentBar({mix}){
  const {Dot}=window;
  const segs=[['positivo','--verde'],['neutral','--text-3'],['mixto','--ambar'],['negativo','--rojo']];
  return <div>
    <window.StackedBar segments={segs.map(([k,c])=>({label:k,v:mix[k],color:c}))} h={10}/>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px 14px',marginTop:12}}>
      {segs.map(([k,c])=><div key={k} style={{display:'flex',alignItems:'center',gap:7,fontSize:12.5,fontWeight:600,color:'var(--text-2)'}}>
        <Dot color={c}/> <span style={{textTransform:'capitalize'}}>{k}</span>
        <span className="mono" style={{marginLeft:'auto',color:'var(--text-3)'}}>{mix[k]}%</span>
      </div>)}
    </div>
  </div>;
}

/* ---------------- WHATSAPP ---------------- */
function WhatsAppView({onOpenFile}){
  const D=window.DATA; const {Icon,Avatar,Dot}=window;
  const dayFmt=(d)=>d.toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long'});
  let lastDay=null;
  return (
    <div className="view-enter" style={{display:'grid',gridTemplateColumns:'1fr',gap:0,maxWidth:760,margin:'0 auto'}}>
      <div className="card" style={{overflow:'hidden'}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border-1)',display:'flex',alignItems:'center',gap:10,position:'sticky',top:0,background:'var(--bg-1)',zIndex:2}}>
          <Avatar name="Andre" size={36} color="--verde"/>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:14}}>Hilo unificado de WhatsApp</div>
            <div style={{fontSize:12,color:'var(--text-3)'}}>80 mensajes · varias conversaciones</div>
          </div>
          <button className="fchip"><Icon name="calendar" size={14}/> Saltar a fecha</button>
        </div>
        <div className="scrollarea" style={{maxHeight:600,padding:'8px 18px 20px',display:'flex',flexDirection:'column',overflowX:'hidden'}}>
          {D.waMsgs.map((m,i)=>{
            const day=dayFmt(m.date);
            const showDay=day!==lastDay; lastDay=day;
            return (
              <React.Fragment key={i}>
                {showDay && <div className="wa-day"><span style={{textTransform:'capitalize'}}>{day}</span></div>}
                {m.newConv && <div className="wa-day"><span style={{background:'var(--verde-soft)',color:'var(--verde-2)'}}>● nueva conversación</span></div>}
                <div className={"bubble "+(m.dir==='out'?'b-out':'b-in')} style={{marginBottom:6}}>
                  {m.file? <button onClick={()=>onOpenFile({nombre:m.text,tipo:m.text.endsWith('.pdf')?'pdf':'img',canal:'WhatsApp',quien:m.dir==='in'?'Cliente':'Agente',size:'248 KB',color:'--verde'})}
                    style={{display:'flex',alignItems:'center',gap:9,textAlign:'left'}}>
                    <div style={{width:34,height:34,borderRadius:8,background:m.dir==='out'?'#fff':'var(--bg-3)',display:'grid',placeItems:'center',color:'var(--verde)'}}>
                      <Icon name={m.text.endsWith('.pdf')?'fileText':'image'} size={17}/></div>
                    <span style={{fontWeight:700,fontSize:13,color:'var(--text-1)'}}>{m.text}</span>
                  </button>
                  : m.text}
                  <div className="bt mono">{String(m.date.getHours()).padStart(2,'0')}:{String(m.date.getMinutes()).padStart(2,'0')}</div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- EMAILS ---------------- */
function EmailsView({onOpenFile}){
  const D=window.DATA; const {Icon,Avatar}=window;
  const [open,setOpen]=useState(0);
  return (
    <div className="view-enter" style={{maxWidth:820,margin:'0 auto',display:'flex',flexDirection:'column',gap:12}}>
      {D.emails.map((th,i)=>(
        <div key={i} className="card lift" style={{overflow:'hidden'}}>
          <button onClick={()=>setOpen(open===i?-1:i)} style={{display:'flex',width:'100%',textAlign:'left',gap:14,padding:'16px 20px',alignItems:'center'}}>
            <div style={{width:38,height:38,borderRadius:11,background:'var(--ambar-soft)',color:'var(--ambar)',display:'grid',placeItems:'center'}}><Icon name="mail" size={18}/></div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:14.5}}>{th.asunto}</div>
              <div style={{fontSize:12.5,color:'var(--text-3)',marginTop:2}}>{th.from} · {th.msgs.length} mensaje · último hace 22 días</div>
            </div>
            <Icon name="chevD" size={18} style={{color:'var(--text-3)',transform:open===i?'rotate(180deg)':'none',transition:'.2s'}}/>
          </button>
          {open===i && <div style={{borderTop:'1px solid var(--border-1)',padding:'16px 20px',background:'var(--bg-2)'}} className="fade-up">
            {th.msgs.map((m,j)=>(
              <div key={j} style={{display:'flex',gap:12}}>
                <Avatar name={m.who} size={34} color="--ambar"/>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13.5}}>{m.who} <span style={{fontWeight:500,color:'var(--text-3)',fontSize:12}}>· {m.date}</span></div>
                  <div style={{fontSize:13.5,color:'var(--text-2)',marginTop:6,lineHeight:1.6}}>{m.text}</div>
                  {m.file && <button onClick={()=>onOpenFile({nombre:m.file,tipo:'pdf',canal:'Email',quien:'Cliente',size:'1.2 MB',color:'--ambar'})}
                    className="fchip" style={{marginTop:10}}><Icon name="paperclip" size={13}/> {m.file}</button>}
                </div>
              </div>
            ))}
          </div>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- ARCHIVOS ---------------- */
function FilesView({onOpenFile}){
  const D=window.DATA; const {Icon}=window;
  const [f,setF]=useState("Todos");
  const items=D.archivos.filter(a=> f==="Todos" || (f==="Imágenes"&&a.tipo==='img') || (f==="PDFs"&&a.tipo==='pdf'));
  return (
    <div className="view-enter" style={{maxWidth:900,margin:'0 auto'}}>
      <div style={{display:'flex',gap:7,marginBottom:18}}>
        {["Todos","Imágenes","PDFs","Documentos"].map(x=>(
          <button key={x} className={"fchip"+(f===x?' on':'')} onClick={()=>setF(x)}>{x}</button>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:16}}>
        {items.map((a,i)=>(
          <button key={i} className="file-tile lift" onClick={()=>onOpenFile(a)} style={{animationDelay:`${i*70}ms`}}>
            <div className="ph" style={{background: a.tipo==='img'
              ? 'repeating-linear-gradient(135deg,#e8f1ee,#e8f1ee 9px,#dfeae6 9px,#dfeae6 18px)'
              : 'var(--bg-3)', color:`var(${a.color})`}}>
              <Icon name={a.tipo==='img'?'image':'fileText'} size={40} stroke={1.4}/>
            </div>
            <div className="file-meta">
              <div style={{fontWeight:700,fontSize:12.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.nombre}</div>
              <div style={{fontSize:11,opacity:.85,marginTop:2}}>{a.canal} · {a.size}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- ACTIVIDAD (historial) ---------------- */
function HistoryView(){
  const D=window.DATA; const {Icon}=window;
  return (
    <div className="view-enter" style={{maxWidth:680,margin:'0 auto'}}>
      <div className="card" style={{padding:'22px 26px'}}>
        <div style={{fontWeight:800,fontSize:15,marginBottom:6}}>Eventos de ciclo de vida</div>
        <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:18}}>Cambios de etapa, sincronizaciones y tipificaciones — no conversaciones.</div>
        {D.historial.map((e,i)=>(
          <div className="tl-item" key={i}>
            <div className="tl-rail">
              <div className="tl-node" style={{background:`var(${e.color}-soft)`,color:`var(${e.color})`}}>
                <Icon name={e.icon==='trending'?'trending':e.icon==='tag'?'tag':'refresh'} size={15}/></div>
              {i<D.historial.length-1 && <div className="tl-line"/>}
            </div>
            <div style={{paddingBottom:i<D.historial.length-1?18:0,paddingLeft:4}}>
              <div style={{fontWeight:700,fontSize:14}}>{e.title}</div>
              <div style={{fontSize:12.5,color:'var(--text-3)',marginTop:2}}>{e.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- LIGHTBOX ---------------- */
function Lightbox({file, onClose}){
  const {Icon}=window;
  useEffect(()=>{
    const k=(e)=>{ if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown',k); return ()=>window.removeEventListener('keydown',k);
  },[]);
  if(!file) return null;
  return (
    <div className="lb-scrim" onClick={onClose}>
      <div className="lb-head" onClick={e=>e.stopPropagation()}>
        <div style={{width:38,height:38,borderRadius:11,background:'rgba(255,255,255,.12)',display:'grid',placeItems:'center'}}>
          <Icon name={file.tipo==='img'?'image':'fileText'} size={19}/></div>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:14.5}}>{file.nombre}</div>
          <div style={{fontSize:12,opacity:.7}}>{file.canal} · {file.quien} · {file.size}</div>
        </div>
        <button className="ico-btn" style={{color:'#fff'}}><Icon name="external" size={18}/></button>
        <button className="ico-btn" style={{color:'#fff'}}><Icon name="download" size={18}/></button>
        <button className="ico-btn" style={{color:'#fff'}} onClick={onClose}><Icon name="x" size={20}/></button>
      </div>
      <div className="lb-body" onClick={onClose}>
        <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:14,maxWidth:'min(720px,90vw)',width:'100%',aspectRatio: file.tipo==='img'?'4/3':'3/4',
          display:'grid',placeItems:'center',boxShadow:'var(--sh-4)',overflow:'hidden'}}>
          <div style={{textAlign:'center',color:'var(--text-3)'}}>
            <div style={{background: file.tipo==='img'
              ? 'repeating-linear-gradient(135deg,#eef3f1,#eef3f1 12px,#e4ece9 12px,#e4ece9 24px)':'var(--bg-2)',
              width:'100%',aspectRatio:file.tipo==='img'?'4/3':'3/4',display:'grid',placeItems:'center'}}>
              <div>
                <Icon name={file.tipo==='img'?'image':'fileText'} size={60} stroke={1.2} style={{color:`var(${file.color})`}}/>
                <div className="mono" style={{marginTop:14,fontSize:12.5,color:'var(--text-3)'}}>{file.tipo==='img'?'vista previa de imagen':'documento PDF'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- RESUMEN IA slide-over ---------------- */
function AISummary({call, onClose}){
  const D=window.DATA; const {Icon,Chip,Dot}=window;
  useEffect(()=>{ const k=(e)=>{if(e.key==='Escape')onClose();}; window.addEventListener('keydown',k); return ()=>window.removeEventListener('keydown',k); },[]);
  if(!call) return null;
  const mix=D.sentMix;
  return (
    <>
      <div className="cmd-scrim" style={{zIndex:70}} onClick={onClose}/>
      <div style={{position:'fixed',top:0,right:0,bottom:0,width:'min(440px,92vw)',zIndex:71,background:'var(--bg-1)',
        boxShadow:'var(--sh-4)',animation:'slideIn .34s var(--ease) both',overflowY:'auto'}}>
        <style>{`@keyframes slideIn{from{transform:translateY(16px);}to{transform:translateY(0);}}`}</style>
        <div style={{padding:'20px 22px',borderBottom:'1px solid var(--border-1)',display:'flex',alignItems:'center',gap:11,position:'sticky',top:0,background:'var(--bg-1)',zIndex:2}}>
          <div style={{width:34,height:34,borderRadius:10,background:'var(--violeta)',color:'#fff',display:'grid',placeItems:'center'}}><Icon name="sparkles" size={18}/></div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:15}}>Resumen IA</div>
            <div style={{fontSize:11.5,color:'var(--text-3)'}}>Generado · Amazon Bedrock</div>
          </div>
          <button className="ico-btn" onClick={onClose}><Icon name="x" size={19}/></button>
        </div>
        <div style={{padding:22,display:'flex',flexDirection:'column',gap:20}}>
          <div>
            <div style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-3)',marginBottom:10}}>Resumen de la llamada</div>
            <div style={{fontSize:14,color:'var(--text-1)',lineHeight:1.65}}>{call.resumenIA||"Sin resumen para esta llamada."}</div>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-3)',marginBottom:10}}>Sentimiento (Contact Lens)</div>
            <SentimentBar mix={mix}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-3)',marginBottom:10}}>Momentos clave</div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {(call.momentos||[]).map((m,i)=>(
                <div key={i} className="card-2" style={{display:'flex',alignItems:'center',gap:11,padding:'10px 13px'}}>
                  <span className="mono" style={{fontSize:12,fontWeight:700,color:'var(--text-3)'}}>{window.fmtDur(m.t)}</span>
                  <Dot color={m.tone==='positivo'?'--verde':m.tone==='negativo'?'--rojo':'--ambar'}/>
                  <span style={{fontSize:13,fontWeight:600}}>{m.label}</span>
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" style={{justifyContent:'center'}}><Icon name="share" size={15}/> Compartir resumen</button>
        </div>
      </div>
    </>
  );
}

Object.assign(window,{OverviewView,WhatsAppView,EmailsView,FilesView,HistoryView,Lightbox,AISummary,SentimentBar});
