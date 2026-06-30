/* ============================================================
   AIRA · Iconos (lucide-style)  ·  window.Icon
   ============================================================ */
const ICON_PATHS = {
  home:'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
  headset:'M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h1v-5H4Zm16 0a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1v-5h1Zm-1 5a4 4 0 0 1-4 4h-2',
  live:'M3 5h18M3 12h18M3 19h18',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11',
  megaphone:'m3 11 14-7v16l-7-3.5M3 11v3a1 1 0 0 0 1 1h2l1 5h3l-1-6M3 11h7',
  bot:'M12 8V4m0 0h-1m1 0h1M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm3 5h.01M16 13h.01',
  zap:'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  sparkles:'m12 3 1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3Zm6 9 .8 2.2L21 15l-2.2.8L18 18l-.8-2.2L15 15l2.2-.8L18 12ZM6 15l.6 1.7L8 17l-1.4.5L6 19l-.6-1.5L4 17l1.4-.3L6 15Z',
  calendar:'M8 2v4M16 2v4M3 9h18M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  chart:'M3 3v18h18M8 17v-5M13 17V7M18 17v-8',
  mic:'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  settings:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.13-1.4l2-1.55-2-3.46-2.36.95A7.9 7.9 0 0 0 15 4.6L14.66 2H9.34L9 4.6a7.9 7.9 0 0 0-2.5 1.44L4.13 5.1l-2 3.46 2 1.55a8 8 0 0 0 0 2.8l-2 1.55 2 3.46 2.36-.95A7.9 7.9 0 0 0 9 19.4L9.34 22h5.32L15 19.4a7.9 7.9 0 0 0 2.5-1.44l2.36.95 2-3.46-2-1.55c.09-.46.13-.93.13-1.4Z',
  search:'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.3-4.3',
  refresh:'M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5',
  phone:'M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L16 11l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z',
  chat:'M21 11.5a8 8 0 0 1-11.5 7.2L3 21l2.3-6.5A8 8 0 1 1 21 11.5Z',
  mail:'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 2 8 6 8-6',
  paperclip:'M21 8.5 12.5 17a4 4 0 0 1-6-5.5l8-8a3 3 0 0 1 4 4l-8 8a1.5 1.5 0 0 1-2-2l7-7',
  history:'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l4 2',
  chevR:'m9 6 6 6-6 6', chevL:'m15 6-6 6 6 6', chevD:'m6 9 6 6 6-6', chevU:'m6 15 6-6 6 6',
  play:'M6 4l14 8-14 8V4Z', pause:'M7 4h3v16H7zM14 4h3v16h-3z',
  x:'M6 6l12 12M18 6 6 18',
  download:'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  external:'M14 4h6v6M20 4l-9 9M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6',
  bell:'M18 9a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7M10.5 20a2 2 0 0 0 3 0',
  moon:'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  user:'M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  arrowIn:'M17 7 7 17m0 0h8m-8 0V9',   // entrante (down-left)
  arrowOut:'M7 17 17 7m0 0H9m8 0v8',   // saliente (up-right)
  missed:'m23 1-6 6m0-6 6 6M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L16 11l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z',
  gauge:'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm1.5-1.5L19 7M5 19a9 9 0 1 1 14 0',
  check:'M5 12l5 5L20 7',
  plus:'M12 5v14M5 12h14',
  filter:'M3 5h18l-7 8v6l-4-2v-4L3 5Z',
  more:'M5 12h.01M12 12h.01M19 12h.01',
  fileText:'M14 3v5h5M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM9 13h6M9 17h6',
  image:'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 12 5-5 4 4 3-3 5 5M9 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  rewind:'M11 19 2 12l9-7v14ZM22 19l-9-7 9-7v14Z',
  forward:'m13 19 9-7-9-7v14ZM2 19l9-7-9-7v14Z',
  flag:'M4 21V4s2-1 5-1 4 2 7 2 4-1 4-1v9s-2 1-5 1-4-2-7-2-4 1-4 1',
  tag:'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Zm5-4h.01',
  trending:'M22 7 13.5 15.5l-4-4L2 19M16 7h6v6',
  send:'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  building:'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h.01M8 12h.01M8 16h.01M12 8h.01M12 12h.01',
  share:'M16 6l-4-4-4 4M12 2v13M20 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6',
  volume:'M11 5 6 9H2v6h4l5 4V5ZM16 9a3 3 0 0 1 0 6M19 6a7 7 0 0 1 0 12',
  clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2',
  scissors:'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm14-17L8.1 15.9M14.5 14.5 20 20M8.5 8.5 12 12',
  mapPin:'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  panel:'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm5 0v16',
  dot:'M12 12h.01',
  arrowRight:'M5 12h14m0 0-6-6m6 6-6 6',
  inbox:'M22 12h-6l-2 3h-4l-2-3H2M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6L5 5Z',
  layers:'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
};

function Icon({name, size=18, stroke=2, fill="none", style, className}){
  const d = ICON_PATHS[name];
  if(!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
      {d.split('|').map((p,i)=><path key={i} d={p}/>)}
    </svg>
  );
}

window.Icon = Icon;
