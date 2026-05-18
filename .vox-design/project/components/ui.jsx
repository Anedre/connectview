/* global React, Icon */
const { useMemo } = React;

// Avatar with initials
function Avatar({ name, color, size = 'md', src }) {
  const initials = name ? name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase() : '?';
  const cls = size === 'sm' ? 'av av--sm' : size === 'lg' ? 'av av--lg' : size === 'xl' ? 'av av--xl' : 'av';
  const bg = color || colorFromName(name || '?');
  return <span className={cls} style={{ background: bg }}>{initials}</span>;
}

function colorFromName(name) {
  const palette = ['#8B7EE8', '#22B8D9', '#F5A524', '#E879A6', '#1FAE6C', '#E5484D', '#5B8DEF'];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

// Tiny inline sparkline
function Spark({ data, color = 'var(--accent-cyan)', w = 80, h = 28, fill }) {
  const path = useMemo(() => {
    if (!data?.length) return '';
    const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
    return data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  }, [data, w, h]);
  const area = useMemo(() => {
    if (!data?.length || !fill) return '';
    const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
    let d = `M 0 ${h}`;
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    d += ` L ${w} ${h} Z`;
    return d;
  }, [data, w, h, fill]);
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {fill && <path d={area} fill={fill} stroke="none" />}
      <path d={path} stroke={color} />
    </svg>
  );
}

// Channel badge
function ChannelChip({ type, sm }) {
  const map = {
    voice: { cls: 'ch--voice', icon: Icon.Phone, label: 'Voz' },
    chat: { cls: 'ch--chat', icon: Icon.Chat, label: 'Chat' },
    wa:   { cls: 'ch--wa',   icon: Icon.WhatsApp, label: 'WhatsApp' },
    sms:  { cls: 'ch--sms',  icon: Icon.Sms, label: 'SMS' },
    email:{ cls: 'ch--email',icon: Icon.Mail, label: 'Email' },
  };
  const c = map[type] || map.voice;
  const Icn = c.icon;
  return (
    <span className={`ch ${c.cls}`} title={c.label} style={sm ? { width: 18, height: 18 } : null}>
      <Icn style={{ width: 12, height: 12 }} />
    </span>
  );
}

// KPI tile
function Kpi({ label, value, delta, deltaDir = 'up', spark, color = 'var(--accent-cyan)' }) {
  const cls = deltaDir === 'up' ? 'kpi__delta--up' : deltaDir === 'down' ? 'kpi__delta--down' : 'kpi__delta--flat';
  const Arrow = deltaDir === 'up' ? Icon.ArrowUp : deltaDir === 'down' ? Icon.ArrowDown : null;
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      {delta && (
        <div className={`kpi__delta ${cls}`}>
          {Arrow && <Arrow style={{ width: 11, height: 11 }} />} {delta}
        </div>
      )}
      {spark && (
        <div className="kpi__spark">
          <Spark data={spark} color={color} w={72} h={26} fill={color.includes('green') ? 'var(--accent-green-soft)' : color.includes('amber') ? 'var(--accent-amber-soft)' : 'var(--accent-cyan-soft)'} />
        </div>
      )}
    </div>
  );
}

// Status pill
function StatusPill({ status }) {
  const map = {
    'Activo':       'chip--green',
    'Resuelto':     'chip--green',
    'OK':           'chip--green',
    'Disponible':   'chip--green',
    'En curso':     'chip--cyan',
    'En proceso':   'chip--cyan',
    'En llamada':   'chip--cyan',
    'En riesgo':    'chip--red',
    'Crítica':      'chip--red',
    'Alta':         'chip--amber',
    'Media':        'chip--cyan',
    'Baja':         'chip--green',
    'Pausada':      'chip--amber',
    'Pausado':      'chip--amber',
    'Break':        'chip--amber',
    'ACW':          'chip--violet',
    'Programada':   'chip--violet',
    'Renovación':   'chip--violet',
    'Lead':         'chip--cyan',
    'Caso abierto': 'chip--amber',
    'Abierto':      'chip--amber',
    'Esperando cliente': 'chip--violet',
    'No conectado': 'chip--red',
  };
  return <span className={`chip ${map[status] || ''}`}><span className="dot" />{status}</span>;
}

Object.assign(window, { Avatar, Spark, ChannelChip, Kpi, StatusPill, colorFromName });
