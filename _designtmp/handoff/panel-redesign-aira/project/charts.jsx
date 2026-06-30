/* ============================================================
   AIRA · Charts  ·  window.{AreaChart, Donut, Gauge, BarList}
   SVG limpios, sin librerías. Reusa tokens + ui.jsx helpers.
   ============================================================ */
const {useState:_uS, useEffect:_uE, useRef:_uR, useMemo:_uM} = React;

/* mide ancho del contenedor para dibujar en px reales (texto nítido) */
function useWidth(initial=720){
  const ref=_uR(); const [w,setW]=_uS(initial);
  _uE(()=>{
    if(!ref.current) return;
    const set=()=>setW(ref.current.clientWidth);
    set();
    const ro=new ResizeObserver(set); ro.observe(ref.current);
    return ()=>ro.disconnect();
  },[]);
  return [ref,w];
}

function _smooth(pts){
  if(pts.length<2) return pts.length?`M ${pts[0][0]} ${pts[0][1]}`:'';
  let d=`M ${pts[0][0]} ${pts[0][1]}`;
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||p2;
    const c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
    d+=` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
function _niceMax(v){
  if(v<=0) return 4;
  const pow=Math.pow(10,Math.floor(Math.log10(v)));
  const n=v/pow;
  const step = n<=1?1:n<=2?2:n<=5?5:10;
  return step*pow;
}

/* ---------------- AREA CHART ---------------- */
function AreaChart({labels, series, height=270}){
  const {cssv,mix}=window;
  const [ref,w]=useWidth(720);
  const padL=38, padR=14, padT=14, padB=28;
  const iw=Math.max(60,w-padL-padR), ih=height-padT-padB;
  const allVals=series.flatMap(s=>s.data);
  const max=_niceMax(Math.max(...allVals,1));
  const x=i=> padL + (series[0].data.length<=1?iw/2:i/(series[0].data.length-1)*iw);
  const y=v=> padT + ih - (v/max)*ih;
  const ticks=[0,.25,.5,.75,1].map(f=>Math.round(max*f));
  const [hover,setHover]=_uS(null);
  return (
    <div ref={ref} style={{width:'100%',position:'relative'}}>
      <svg width={w} height={height} style={{display:'block',overflow:'visible'}}
        onMouseLeave={()=>setHover(null)}
        onMouseMove={(e)=>{const r=e.currentTarget.getBoundingClientRect();const px=e.clientX-r.left;
          const i=Math.round(Math.max(0,Math.min(1,(px-padL)/iw))*(series[0].data.length-1));setHover(i);}}>
        <defs>
          {series.map((s,si)=>(
            <linearGradient key={si} id={"ac"+si} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={`var(${s.color})`} stopOpacity={s.fill===false?0:.18}/>
              <stop offset="1" stopColor={`var(${s.color})`} stopOpacity="0"/>
            </linearGradient>
          ))}
        </defs>
        {/* gridlines + y labels */}
        {ticks.map((t,i)=>(
          <g key={i}>
            <line x1={padL} x2={w-padR} y1={y(t)} y2={y(t)} stroke="var(--border-1)" strokeWidth="1"/>
            <text x={padL-9} y={y(t)+3.5} textAnchor="end" fontSize="10.5" fill="var(--text-3)" fontWeight="600">{t}</text>
          </g>
        ))}
        {/* x labels */}
        {labels.map((l,i)=>(
          <text key={i} x={x(i)} y={height-9} textAnchor="middle" fontSize="10.5" fill="var(--text-3)" fontWeight="600">{l}</text>
        ))}
        {/* series */}
        {series.map((s,si)=>{
          const pts=s.data.map((v,i)=>[x(i),y(v)]);
          const line=_smooth(pts);
          const area=line+` L ${x(s.data.length-1)} ${padT+ih} L ${x(0)} ${padT+ih} Z`;
          return (
            <g key={si}>
              {s.fill!==false && <path d={area} fill={`url(#ac${si})`}/>}
              <path d={line} fill="none" stroke={`var(${s.color})`} strokeWidth={s.dash?2:2.4}
                strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.dash?"5 5":"0"} opacity={s.dash?.55:1}/>
            </g>
          );
        })}
        {/* hover */}
        {hover!=null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT+ih} stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 3"/>
            {series.map((s,si)=>(
              <circle key={si} cx={x(hover)} cy={y(s.data[hover])} r="4.5" fill="var(--bg-1)" stroke={`var(${s.color})`} strokeWidth="2.5"/>
            ))}
          </g>
        )}
      </svg>
      {hover!=null && (
        <div style={{position:'absolute',left:Math.min(w-150,Math.max(0,x(hover)-70)),top:6,
          background:'var(--text-1)',color:'#fff',borderRadius:9,padding:'8px 11px',fontSize:11.5,fontWeight:600,
          boxShadow:'var(--sh-3)',pointerEvents:'none',minWidth:120}}>
          <div style={{opacity:.7,fontSize:10.5,marginBottom:4}}>{labels[hover]}</div>
          {series.map((s,si)=>(
            <div key={si} style={{display:'flex',alignItems:'center',gap:7,marginTop:2}}>
              <span style={{width:7,height:7,borderRadius:99,background:`var(${s.color})`}}/>
              <span style={{opacity:.8}}>{s.name}</span>
              <b className="mono" style={{marginLeft:'auto'}}>{s.data[hover]}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- DONUT ---------------- */
function Donut({segments, size=176, thickness=22, centerValue, centerLabel}){
  const total=segments.reduce((s,x)=>s+x.value,0)||1;
  const r=(size-thickness)/2, c=2*Math.PI*r, cx=size/2, cy=size/2;
  let acc=0;
  return (
    <div style={{position:'relative',width:size,height:size,flex:`0 0 ${size}px`}}>
      <svg width={size} height={size} style={{transform:'rotate(-90deg)'}}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={thickness}/>
        {segments.map((s,i)=>{
          const len=s.value/total*c; const gap=segments.length>1?2.5:0;
          const el=<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={`var(${s.color})`}
            strokeWidth={thickness} strokeDasharray={`${Math.max(0,len-gap)} ${c-Math.max(0,len-gap)}`}
            strokeDashoffset={-acc} strokeLinecap="round"/>;
          acc+=len; return el;
        })}
      </svg>
      <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',textAlign:'center'}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:'-.03em',lineHeight:1}}>{centerValue}</div>
          <div style={{fontSize:11.5,color:'var(--text-3)',fontWeight:600,marginTop:3}}>{centerLabel}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- GAUGE (semicírculo) ---------------- */
function _polar(cx,cy,r,deg){const a=(deg-180)*Math.PI/180;return [cx+r*Math.cos(a),cy+r*Math.sin(a)];}
function _arc(cx,cy,r,start,end){const s=_polar(cx,cy,r,start),e=_polar(cx,cy,r,end);const large=end-start>180?1:0;
  return `M ${s[0].toFixed(1)} ${s[1].toFixed(1)} A ${r} ${r} 0 ${large} 1 ${e[0].toFixed(1)} ${e[1].toFixed(1)}`;}
function Gauge({value, color="--verde", size=190, label}){
  const cx=size/2, cy=size/2, r=size/2-14, th=14;
  const pct=Math.max(0,Math.min(100,value));
  return (
    <div style={{position:'relative',width:size,height:size/2+18,margin:'0 auto'}}>
      <svg width={size} height={size/2+18} style={{overflow:'visible'}}>
        <path d={_arc(cx,cy,r,0,180)} fill="none" stroke="var(--bg-3)" strokeWidth={th} strokeLinecap="round"/>
        <path d={_arc(cx,cy,r,0,180*pct/100)} fill="none" stroke={`var(${color})`} strokeWidth={th} strokeLinecap="round"/>
      </svg>
      <div style={{position:'absolute',left:0,right:0,top:size/2-30,textAlign:'center'}}>
        <div style={{fontSize:32,fontWeight:800,letterSpacing:'-.03em',lineHeight:1}}>{value}<span style={{fontSize:18}}>%</span></div>
        {label && <div style={{fontSize:12,color:'var(--text-3)',fontWeight:600,marginTop:4}}>{label}</div>}
      </div>
    </div>
  );
}

/* ---------------- BAR LIST (ranking / colas) ---------------- */
function BarList({items, color, showAvatar}){
  const {Avatar}=window;
  const max=Math.max(...items.map(i=>i.value),1);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {items.map((it,i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:12}}>
          {showAvatar && <Avatar name={it.label} size={32} color={it.color||color}/>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
              <span style={{fontWeight:700,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.label}</span>
              {it.sub && <span style={{fontSize:11.5,color:'var(--text-3)'}}>{it.sub}</span>}
              <span className="mono" style={{marginLeft:'auto',fontWeight:800,fontSize:13.5,color:`var(${it.color||color})`}}>{it.value}</span>
            </div>
            <div style={{height:7,borderRadius:99,background:'var(--bg-3)',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${it.value/max*100}%`,borderRadius:99,background:`var(${it.color||color})`}}/>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- FUNNEL (embudo de leads, minimalista) ---------------- */
function Funnel({stages}){
  const max=stages[0].value||1;
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {stages.map((s,i)=>{
        const conv = i>0 ? Math.round(s.value/stages[i-1].value*100) : null;
        return (
          <div key={i} style={{display:'flex',alignItems:'center',gap:16}}>
            <div style={{flex:'0 0 132px',display:'flex',alignItems:'center',gap:9,fontWeight:700,fontSize:13.5}}>
              <span style={{width:8,height:8,borderRadius:99,background:`var(${s.color})`,flex:'0 0 8px'}}/>
              {s.label}
            </div>
            <div style={{flex:1,height:30,background:'var(--bg-3)',borderRadius:8,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${s.value/max*100}%`,background:`var(${s.color})`,borderRadius:8,
                opacity:.92,transition:'width .5s var(--ease)'}}/>
            </div>
            <div style={{flex:'0 0 132px',display:'flex',alignItems:'center',justifyContent:'flex-end',gap:10}}>
              <span className="mono" style={{fontWeight:800,fontSize:15}}>{s.value}</span>
              {conv!=null
                ? <span style={{fontSize:11.5,fontWeight:700,color:'var(--text-3)',background:'var(--bg-3)',borderRadius:99,padding:'3px 8px',minWidth:42,textAlign:'center'}}>{conv}%</span>
                : <span style={{minWidth:42}}></span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window,{AreaChart,Donut,Gauge,BarList,useWidth,Funnel});
