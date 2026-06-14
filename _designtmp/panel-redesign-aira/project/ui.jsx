/* ============================================================
   AIRA · Primitivos UI  ·  window.{Avatar, Chip, Sparkline, ...}
   ============================================================ */
const {useState, useEffect, useRef, useMemo} = React;

const cssv = (n)=> getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function initials(name){
  const p = name.replace(/^\+?\d.*$/,'').trim().split(/\s+/).filter(Boolean);
  if(!p.length) return name.replace(/\D/g,'').slice(-2) || "··";
  return (p[0][0]+(p[1]?p[1][0]:'')).toUpperCase();
}
function fmtDur(s){ if(!s) return "0:00"; const m=Math.floor(s/60), ss=s%60; return m+":"+String(ss).padStart(2,'0'); }
function fmtDurLong(s){ const m=Math.floor(s/60), ss=s%60; return m+"m "+ss+"s"; }

/* avatar con tono por canal */
function Avatar({name, size=44, color="--cian", radius=14, soft=true}){
  return (
    <div style={{width:size,height:size,flex:`0 0 ${size}px`,borderRadius:radius,
      background:soft?`var(${color}-soft)`:`var(${color})`,
      color:soft?`var(${color})`:'#fff',
      display:'grid',placeItems:'center',fontWeight:800,fontSize:size*0.34,letterSpacing:'-.02em'}}>
      {initials(name)}
    </div>
  );
}

function Chip({children, color, soft=true, style}){
  const c = color ? (soft?{background:`var(${color}-soft)`,color:`var(${color}-2)`}:{background:`var(${color})`,color:'#fff'})
                  : {background:'var(--bg-3)', color:'var(--text-2)'};
  return <span className="chip" style={{...c,...style}}>{children}</span>;
}

/* sparkline suave (area) */
function Sparkline({data, color="--cian", h=26, fill=true}){
  const w=100, max=Math.max(...data,1), min=Math.min(...data,0);
  const pts = data.map((v,i)=>[ i/(data.length-1)*w, h-2-((v-min)/(max-min||1))*(h-4) ]);
  const line = pts.map((p,i)=> (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const area = line+` L${w} ${h} L0 ${h} Z`;
  const gid = 'sg'+color.replace(/\W/g,'');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{width:'100%',height:h,display:'block'}}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={`var(${color})`} stopOpacity=".22"/>
        <stop offset="1" stopColor={`var(${color})`} stopOpacity="0"/>
      </linearGradient></defs>
      {fill && <path d={area} fill={`url(#${gid})`}/>}
      <path d={line} fill="none" stroke={`var(${color})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

/* barra apilada de mezcla de canales / sentimiento */
function StackedBar({segments, h=8, radius=99, gap=2}){
  const total = segments.reduce((s,x)=>s+x.v,0)||1;
  return (
    <div style={{display:'flex',gap,height:h,width:'100%'}}>
      {segments.filter(s=>s.v>0).map((s,i)=>(
        <div key={i} title={`${s.label}: ${s.v}`} style={{flex:s.v/total, background:`var(${s.color})`,
          borderRadius:radius, transition:'flex .5s var(--ease)'}}/>
      ))}
    </div>
  );
}

/* dot punto de color */
function Dot({color, size=8, pulse}){
  return <span className={pulse?'pulse-dot':''} style={{width:size,height:size,borderRadius:99,background:`var(${color})`,display:'inline-block',flex:`0 0 ${size}px`}}/>;
}

/* ============ Heatmap anual (estilo contribuciones) ============ */
function Heatmap({porDia, selKey, onSelect, weeks=30, sentColor}){
  // construir matriz de semanas hacia atrás desde hoy
  const today = new Date(2026,5,13);
  const cells = [];
  const start = new Date(today); start.setDate(start.getDate() - (weeks*7 - 1));
  // alinear a domingo
  start.setDate(start.getDate() - start.getDay());
  const cols=[]; let cur=new Date(start);
  const keyf = window.DATA.key;
  const monthLabels=[];
  for(let w=0; w<weeks+1; w++){
    const col=[];
    for(let d=0; d<7; d++){
      const k = keyf(cur);
      const calls = porDia[k]||[];
      const n = calls.length;
      // sentimiento dominante
      let sent=null;
      if(n){ const order=["negativo","mixto","neutral","positivo"];
        const counts={}; calls.forEach(c=>counts[c.sent]=(counts[c.sent]||0)+1);
        sent = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
      }
      col.push({date:new Date(cur), k, n, sent, future: cur>today});
      if(cur.getDate()<=7 && d===0) monthLabels.push({w, m:cur.getMonth()});
      cur.setDate(cur.getDate()+1);
    }
    cols.push(col);
  }
  function intensity(n){ if(!n) return 0; if(n<=1) return .35; if(n<=3) return .55; if(n<=5) return .78; return 1; }
  return (
    <div>
      <div style={{display:'flex',gap:3,paddingLeft:2,marginBottom:6}}>
        {cols.map((col,w)=>{
          const ml = monthLabels.find(m=>m.w===w);
          return <div key={w} style={{width:13,fontSize:9.5,color:'var(--text-3)',fontWeight:700}}>{ml?window.DATA.MES[ml.m].slice(0,3):''}</div>;
        })}
      </div>
      <div className="heat">
        {cols.map((col,w)=>(
          <div className="heat-col" key={w}>
            {col.map((cell,d)=>{
              const base = cell.n ? cssv(sentColor[cell.sent]||'--cian') : null;
              const sel = cell.k===selKey;
              return <div key={d}
                className={"heat-cell"+(sel?' sel':'')}
                onClick={()=> cell.n && onSelect(cell.k, cell.date)}
                title={cell.n? `${cell.date.getDate()} ${window.DATA.MES[cell.date.getMonth()]} · ${cell.n} llamada${cell.n>1?'s':''}` : ''}
                style={{
                  background: cell.future?'transparent': cell.n? mix(base, intensity(cell.n)) : 'var(--bg-3)',
                  cursor: cell.n?'pointer':'default',
                  opacity: cell.future?0:1,
                }}/>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
// mezcla color con blanco según alpha
function mix(hex, a){
  const c = hex.replace('#',''); if(c.length<6) return hex;
  const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);
  const m=v=>Math.round(255+(v-255)*a);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/* ============ Waveform por sentimiento + momentos ============ */
function Waveform({call, progress, onSeek, sentColor}){
  const bars = useMemo(()=>{
    const n=120, arr=[]; let s=call.id.charCodeAt(1)||7;
    const segs = call.transcript || [];
    for(let i=0;i<n;i++){
      s=(s*9301+49297)%233280; const r=s/233280;
      const env = Math.sin(i/n*Math.PI)*0.5+0.5;
      arr.push(0.18+ (r*0.7+0.3)*env);
    }
    return arr;
  },[call.id]);
  const dur = call.dur||1;
  function sentAt(frac){
    const tr=call.transcript; if(!tr) return call.sent;
    const t=frac*dur; let cur=tr[0]?.s||call.sent;
    for(const line of tr){ if(line.t<=t) cur=line.s; }
    return cur;
  }
  const ref=useRef();
  function handle(e){
    const rect=ref.current.getBoundingClientRect();
    onSeek(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)));
  }
  return (
    <div style={{position:'relative',paddingTop:24}}>
      {(call.momentos||[]).map((m,i)=>(
        <div className="wave-moment" key={i} style={{left:`${m.t/dur*100}%`}} data-tooltip={m.label}
             onClick={()=>onSeek(m.t/dur)} title={m.label}>
          <div style={{width:18,height:18,borderRadius:6,background:`var(${m.tone==='positivo'?'--verde':m.tone==='negativo'?'--rojo':'--ambar'})`,
            display:'grid',placeItems:'center',color:'#fff',cursor:'pointer',boxShadow:'var(--sh-2)'}}>
            <Icon name="flag" size={10} stroke={2.4}/>
          </div>
        </div>
      ))}
      <div className="wave" ref={ref} onClick={handle}>
        {bars.map((h,i)=>{
          const frac=i/bars.length;
          const played=frac<=progress;
          const col=cssv(sentColor[sentAt(frac)]||'--cian');
          return <div key={i} className="wave-bar" style={{
            height:`${h*100}%`,
            background: played? col : mix(col,.28),
          }}/>;
        })}
        <div className="wave-head" style={{left:`${progress*100}%`}}/>
      </div>
    </div>
  );
}

/* tooltip flotante para [data-tooltip] */
function useFloatingTip(){
  useEffect(()=>{
    let el=null;
    function over(e){
      const t=e.target.closest('[data-tooltip]'); if(!t) return;
      el=document.createElement('div'); el.className='tt'; el.textContent=t.getAttribute('data-tooltip');
      el.style.transform='translate(-50%,-100%)';
      document.body.appendChild(el);
      const r=t.getBoundingClientRect();
      el.style.left=(r.left+r.width/2)+'px'; el.style.top=(r.top-8)+'px';
    }
    function out(){ if(el){el.remove();el=null;} }
    document.addEventListener('mouseover',over); document.addEventListener('mouseout',out);
    return ()=>{document.removeEventListener('mouseover',over);document.removeEventListener('mouseout',out);out();};
  },[]);
}

/* count-up number — timer-driven (works even if rAF/paint is throttled) */
function CountUp({to, dur=900, fmt=(x)=>Math.round(x)}){
  const [v,setV]=useState(0);
  useEffect(()=>{
    const t0=Date.now(); let done=false;
    const id=setInterval(()=>{
      const p=Math.min(1,(Date.now()-t0)/dur);
      setV(to*(1-Math.pow(1-p,3)));
      if(p>=1){ done=true; clearInterval(id); }
    },40);
    const safety=setTimeout(()=>{ if(!done){ clearInterval(id); setV(to); } }, dur+400);
    return ()=>{ clearInterval(id); clearTimeout(safety); };
  },[to]);
  return <>{fmt(v)}</>;
}

Object.assign(window, {cssv, initials, fmtDur, fmtDurLong, Avatar, Chip, Sparkline, StackedBar, Dot, Heatmap, Waveform, useFloatingTip, CountUp, mix});
