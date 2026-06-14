/* ============================================================
   AIRA · Vista Llamadas + Reproductor  ·  window.CallsView
   ============================================================ */
function CallsView({onOpenSummary}){
  const D = window.DATA;
  const {Heatmap, Waveform, Avatar, Chip, Dot, Icon, fmtDur, fmtDurLong, CountUp} = window;
  const [filter,setFilter]=useState("Todas");
  const [agent,setAgent]=useState("Todos");
  const dias = useMemo(()=> Object.keys(D.porDia).sort((a,b)=> new Date(b.split('-')).getTime()-0),[]);
  // día seleccionado: el del ejemplo
  const ejKey = D.key(D.ejemploCall.date);
  const [selKey,setSelKey]=useState(ejKey);
  const [selCall,setSelCall]=useState(D.ejemploCall);

  const dayCalls = useMemo(()=>{
    let arr = (D.porDia[selKey]||[]).slice().sort((a,b)=>b.date-a.date);
    if(filter==="Entrantes") arr=arr.filter(c=>c.dir==="entrante");
    else if(filter==="Salientes") arr=arr.filter(c=>c.dir==="saliente");
    else if(filter==="Perdidas") arr=arr.filter(c=>c.perdida);
    return arr;
  },[selKey,filter]);

  const selDate = selCall.date;
  const metricCards=[
    {k:"total", label:"Llamadas", val:D.metrics.total, color:"--cian", icon:"phone", spark:[8,12,6,14,9,18,11,16,13,20,15,22]},
    {k:"pct", label:"Contestadas", val:D.metrics.contestPct, suf:"%", color:"--verde", icon:"check", spark:[60,66,58,72,70,75,68,80,74,82,78,85]},
    {k:"dur", label:"Duración prom.", val:D.metrics.durProm, fmt:fmtDur, color:"--violeta", icon:"clock", spark:[120,140,110,160,150,170,145,180,165,190,175,200]},
    {k:"perd", label:"Perdidas", val:D.metrics.perdidas, color:"--rojo", icon:"missed", spark:[5,3,6,4,7,3,5,2,4,3,5,4]},
  ];

  return (
    <div className="view-enter" style={{display:'flex',flexDirection:'column',gap:18}}>
      {/* métricas */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14}}>
        {metricCards.map((m,i)=>(
          <div key={m.k} className="card metric lift" style={{animationDelay:`${i*60}ms`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div className="mv" style={{color:`var(${m.color})`}}>
                {m.fmt? m.fmt(m.val) : <CountUp to={m.val}/>}{m.suf||''}
              </div>
              <div style={{width:32,height:32,borderRadius:9,background:`var(${m.color}-soft)`,color:`var(${m.color})`,display:'grid',placeItems:'center'}}>
                <Icon name={m.icon} size={16}/>
              </div>
            </div>
            <div className="ml">{m.label}</div>
            <div style={{height:24,marginTop:10}}><window.Sparkline data={m.spark} color={m.color}/></div>
          </div>
        ))}
      </div>

      {/* filtros */}
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:7}}>
          {["Todas","Entrantes","Salientes","Perdidas"].map(f=>(
            <button key={f} className={"fchip"+(filter===f?' on':'')} onClick={()=>setFilter(f)}>{f}</button>
          ))}
        </div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,color:'var(--text-3)',fontSize:12.5,fontWeight:700}}>
          <Icon name="users" size={15}/> Agente
          <select value={agent} onChange={e=>setAgent(e.target.value)}
            style={{border:'1px solid var(--border-1)',background:'var(--bg-2)',borderRadius:8,padding:'6px 10px',fontWeight:700,color:'var(--text-2)',fontSize:12.5}}>
            <option>Todos</option><option>Camila Rojas</option><option>Diego Paredes</option><option>Cola: Cobranzas</option>
          </select>
        </div>
      </div>

      {/* heatmap anual */}
      <div className="card" style={{padding:'20px 22px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,letterSpacing:'-.01em'}}>Actividad de llamadas · últimos 7 meses</div>
            <div style={{color:'var(--text-3)',fontSize:12.5,marginTop:2}}>Cada celda es un día · color = sentimiento dominante · intensidad = volumen</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:14,fontSize:11.5,color:'var(--text-3)',fontWeight:700}}>
            <span style={{display:'flex',alignItems:'center',gap:5}}><Dot color="--verde"/>positivo</span>
            <span style={{display:'flex',alignItems:'center',gap:5}}><Dot color="--ambar"/>mixto</span>
            <span style={{display:'flex',alignItems:'center',gap:5}}><Dot color="--rojo"/>negativo</span>
            <span style={{display:'flex',alignItems:'center',gap:5}}><Dot color="--text-3"/>neutral</span>
          </div>
        </div>
        <div style={{overflowX:'auto',paddingBottom:4}}>
          <Heatmap porDia={D.porDia} selKey={selKey} sentColor={D.sentColor} weeks={30}
            onSelect={(k,date)=>{ setSelKey(k); const c=(D.porDia[k]||[])[0]; if(c) setSelCall(c.transcript?c:D.ejemploCall.date&&D.key(D.ejemploCall.date)===k?D.ejemploCall:c); }}/>
        </div>
      </div>

      {/* split: día + reproductor */}
      <div style={{display:'grid',gridTemplateColumns:'minmax(340px,420px) 1fr',gap:18,alignItems:'start'}}>
        {/* lista del día */}
        <div className="card" style={{overflow:'hidden'}}>
          <div style={{padding:'16px 18px',borderBottom:'1px solid var(--border-1)'}}>
            <div style={{fontWeight:800,fontSize:15,textTransform:'capitalize'}}>
              {D.DIA[selDate.getDay()]} {selDate.getDate()} {D.MES[selDate.getMonth()]}
            </div>
            <div style={{color:'var(--text-3)',fontSize:12.5,marginTop:2}}>{dayCalls.length} llamada{dayCalls.length!==1?'s':''} · toca una para reproducir</div>
          </div>
          <div className="scrollarea" style={{maxHeight:560}}>
            {dayCalls.map((c,i)=>{
              const active=c.id===selCall.id;
              const dirIcon=c.perdida?'missed':c.dir==='entrante'?'arrowIn':'arrowOut';
              const dirCol=c.perdida?'--rojo':c.dir==='entrante'?'--cian':'--verde';
              return (
                <button key={c.id} onClick={()=>setSelCall(c.transcript?c:c.id===D.ejemploCall.id?D.ejemploCall:c)}
                  style={{display:'flex',width:'100%',textAlign:'left',gap:12,padding:'13px 18px',
                    borderBottom:'1px solid var(--border-1)',alignItems:'center',
                    background:active?'var(--cian-soft)':'transparent',transition:'.15s',position:'relative'}}>
                  {active && <span style={{position:'absolute',left:0,top:8,bottom:8,width:3,background:'var(--cian)',borderRadius:'0 3px 3px 0'}}/>}
                  <div style={{width:34,height:34,borderRadius:10,flex:'0 0 34px',display:'grid',placeItems:'center',
                    background:`var(${dirCol}-soft)`,color:`var(${dirCol})`}}>
                    <Icon name={dirIcon} size={16}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span className="mono" style={{fontWeight:700,fontSize:13}}>{String(c.date.getHours()).padStart(2,'0')}:{String(c.date.getMinutes()).padStart(2,'0')}</span>
                      <Dot color={D.sentColor[c.sent]} size={7}/>
                      <span style={{fontSize:12,color:'var(--text-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.agente}</span>
                    </div>
                    <div style={{fontSize:12,color:'var(--text-3)',marginTop:3}}>{c.tipi}</div>
                  </div>
                  <div style={{textAlign:'right',flex:'0 0 auto'}}>
                    <Chip color={c.perdida?'--rojo':'--verde'}>{c.status}</Chip>
                    <div className="mono" style={{fontSize:11.5,color:'var(--text-3)',marginTop:5}}>{c.perdida?'—':fmtDur(c.dur)}</div>
                  </div>
                  {c.grab && <Icon name="mic" size={15} style={{color:'var(--violeta)',flex:'0 0 15px'}}/>}
                </button>
              );
            })}
          </div>
        </div>

        {/* reproductor */}
        <Player call={selCall} onOpenSummary={onOpenSummary}/>
      </div>
    </div>
  );
}

/* ================= Reproductor premium ================= */
function Player({call, onOpenSummary}){
  const D=window.DATA;
  const {Waveform, Icon, Chip, Dot, fmtDur, Avatar}=window;
  const [progress,setProgress]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [speed,setSpeed]=useState(1);
  const [q,setQ]=useState("");
  const dur=call.dur||1;
  const trRef=useRef();

  useEffect(()=>{ setProgress(0); setPlaying(false); },[call.id]);
  useEffect(()=>{
    if(!playing) return;
    const id=setInterval(()=> setProgress(p=>{ const n=p+ (1/dur)*0.4*speed; if(n>=1){setPlaying(false);return 1;} return n; }), 100);
    return ()=>clearInterval(id);
  },[playing,speed,dur]);

  const curT = progress*dur;
  const tr = call.transcript||[];
  const activeIdx = tr.reduce((acc,l,i)=> l.t<=curT? i:acc, -1);

  useEffect(()=>{
    if(activeIdx>=0 && trRef.current){
      const el=trRef.current.querySelector(`[data-i="${activeIdx}"]`);
      if(el){ const c=trRef.current; const top=el.offsetTop-c.offsetTop-c.clientHeight/2+el.clientHeight/2;
        c.scrollTo({top,behavior:'smooth'}); }
    }
  },[activeIdx]);

  const matches = q? tr.filter(l=>l.text.toLowerCase().includes(q.toLowerCase())).length:0;
  function hl(text){
    if(!q) return text;
    const parts=text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'ig'));
    return parts.map((p,i)=> p.toLowerCase()===q.toLowerCase()? <mark key={i}>{p}</mark>:p);
  }

  const dirCol=call.perdida?'--rojo':call.dir==='entrante'?'--cian':'--verde';

  if(call.perdida){
    return (
      <div className="card" style={{padding:40,display:'grid',placeItems:'center',minHeight:480,textAlign:'center'}}>
        <div>
          <div style={{width:64,height:64,borderRadius:20,background:'var(--rojo-soft)',color:'var(--rojo)',display:'grid',placeItems:'center',margin:'0 auto 16px'}}>
            <Icon name="missed" size={28}/>
          </div>
          <div style={{fontWeight:800,fontSize:17}}>Llamada perdida</div>
          <div style={{color:'var(--text-3)',marginTop:6,maxWidth:280}}>No hay grabación disponible. Esta llamada no fue contestada.</div>
          <button className="btn btn-primary" style={{marginTop:18}}><Icon name="phone" size={15}/> Devolver llamada</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{overflow:'hidden'}}>
      {/* header */}
      <div style={{padding:'18px 22px',borderBottom:'1px solid var(--border-1)',display:'flex',alignItems:'center',gap:14}}>
        <div style={{width:42,height:42,borderRadius:12,background:`var(${dirCol}-soft)`,color:`var(${dirCol})`,display:'grid',placeItems:'center'}}>
          <Icon name={call.dir==='entrante'?'arrowIn':'arrowOut'} size={19}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'nowrap'}}>
            <span style={{fontWeight:800,fontSize:15.5,whiteSpace:'nowrap',textTransform:'capitalize'}}>Llamada {call.dir}</span>
            <Chip color={D.sentColor[call.sent]}>{call.sent}</Chip>
          </div>
          <div style={{color:'var(--text-3)',fontSize:12.5,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {call.agente} · {call.date.toLocaleDateString('es',{day:'numeric',month:'long'})} · {fmtDur(call.dur)}
          </div>
        </div>
        <div style={{display:'flex',gap:7}}>
          <button className="ico-btn" data-tooltip="Compartir" style={{border:'1px solid var(--border-1)'}}><Icon name="share" size={16}/></button>
          <button className="ico-btn" data-tooltip="Descargar audio" style={{border:'1px solid var(--border-1)'}}><Icon name="download" size={16}/></button>
        </div>
      </div>

      {/* onda */}
      <div style={{padding:'22px 22px 16px'}}>
        <Waveform call={call} progress={progress} onSeek={setProgress} sentColor={D.sentColor}/>
        {/* transporte */}
        <div style={{display:'flex',alignItems:'center',gap:16,marginTop:18}}>
          <button className="ico-btn" onClick={()=>setProgress(p=>Math.max(0,p-10/dur))}><Icon name="rewind" size={18}/></button>
          <button onClick={()=>setPlaying(p=>!p)} style={{width:52,height:52,borderRadius:16,background:'var(--cian)',color:'#fff',
            display:'grid',placeItems:'center',boxShadow:'var(--sh-3)',transition:'.16s'}}>
            <Icon name={playing?'pause':'play'} size={22} fill="#fff" stroke={0}/>
          </button>
          <button className="ico-btn" onClick={()=>setProgress(p=>Math.min(1,p+10/dur))}><Icon name="forward" size={18}/></button>
          <span className="mono" style={{fontSize:12.5,color:'var(--text-2)',fontWeight:700}}>{fmtDur(Math.round(curT))} / {fmtDur(dur)}</span>
          <div style={{marginLeft:'auto',display:'flex',gap:5}}>
            {[1,1.5,2].map(s=>(
              <button key={s} onClick={()=>setSpeed(s)} className="mono"
                style={{fontSize:12,fontWeight:700,padding:'5px 9px',borderRadius:8,
                  background:speed===s?'var(--cian-soft)':'var(--bg-2)',color:speed===s?'var(--cian-2)':'var(--text-3)',
                  border:'1px solid '+(speed===s?'transparent':'var(--border-1)')}}>{s}×</button>
            ))}
          </div>
        </div>
      </div>

      <div className="divider"/>

      {/* transcripción + búsqueda */}
      <div style={{padding:'14px 22px 8px',display:'flex',alignItems:'center',gap:10}}>
        <div style={{fontWeight:800,fontSize:13.5,display:'flex',alignItems:'center',gap:7}}><Icon name="layers" size={15} style={{color:'var(--text-3)'}}/> Transcripción</div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,background:'var(--bg-2)',border:'1px solid var(--border-1)',borderRadius:9,padding:'6px 11px',width:230}}>
          <Icon name="search" size={14} style={{color:'var(--text-3)'}}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar en transcripción…"
            style={{border:'none',outline:'none',background:'transparent',fontSize:12.5,width:'100%',color:'var(--text-1)'}}/>
          {q && <span className="mono" style={{fontSize:11,color:'var(--text-3)'}}>{matches}</span>}
        </div>
      </div>
      <div ref={trRef} className="scrollarea" style={{maxHeight:300,padding:'4px 14px 14px'}}>
        {tr.map((l,i)=>{
          const isAg=l.who==='Agente';
          return (
            <div key={i} data-i={i} className={"tr-line"+(i===activeIdx?' active':'')}
              onClick={()=>setProgress(l.t/dur)} style={{cursor:'pointer'}}>
              <span className="tr-t mono">{fmtDur(l.t)}</span>
              <span className="who" style={{color:isAg?'var(--cian)':'var(--text-3)'}}>{l.who}</span>
              <span style={{flex:1,color:i===activeIdx?'var(--text-1)':'var(--text-2)',fontWeight:i===activeIdx?600:400}}>{hl(l.text)}</span>
            </div>
          );
        })}
      </div>

      <div className="divider"/>
      {/* tipificación + notas + IA */}
      <div style={{padding:'16px 22px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <div>
          <div style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-3)',marginBottom:8}}>Tipificación</div>
          <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
            <Chip color="--cian"><Icon name="tag" size={13}/> {call.tipi}</Chip>
            <button className="fchip"><Icon name="plus" size={13}/> Editar</button>
          </div>
          <div style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-3)',margin:'16px 0 8px'}}>Notas del agente</div>
          <div className="card-2" style={{padding:'11px 13px',fontSize:13,color:'var(--text-2)',minHeight:54}}>
            {call.nota || "Sin notas. Haz clic para agregar una nota…"}
          </div>
        </div>
        <button onClick={()=>onOpenSummary && onOpenSummary(call)} className="lift" style={{textAlign:'left',padding:'16px 18px',borderRadius:14,
          background:'linear-gradient(135deg, var(--violeta-soft), #f4f2fd)',border:'1px solid #e1ddf6',cursor:'pointer'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:9}}>
            <div style={{width:26,height:26,borderRadius:8,background:'var(--violeta)',color:'#fff',display:'grid',placeItems:'center'}}><Icon name="sparkles" size={15}/></div>
            <span style={{fontWeight:800,fontSize:13.5,color:'var(--violeta-2)'}}>Resumen IA</span>
          </div>
          <div style={{fontSize:12.5,color:'var(--text-2)',lineHeight:1.55,display:'-webkit-box',WebkitLineClamp:4,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
            {call.resumenIA || "Genera un resumen de esta llamada con IA…"}
          </div>
          <div style={{marginTop:10,fontSize:12,fontWeight:800,color:'var(--violeta)',display:'flex',alignItems:'center',gap:5}}>Ver análisis completo <Icon name="arrowRight" size={14}/></div>
        </button>
      </div>
    </div>
  );
}

window.CallsView = CallsView;
