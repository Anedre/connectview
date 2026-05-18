/* global window */
// Mock data — original, fictional companies and people

const AGENTS = [
  { id: 'a1', name: 'Camila Reyes', role: 'Sr. Agent', team: 'Retención', state: 'En llamada', stateColor: '#1FAE6C', time: '04:12', avatar: 'CR', color: '#8B7EE8' },
  { id: 'a2', name: 'Mateo Silva', role: 'Agent', team: 'Retención', state: 'Disponible', stateColor: '#1FAE6C', time: '00:48', avatar: 'MS', color: '#22B8D9' },
  { id: 'a3', name: 'Lucía Ortega', role: 'Agent', team: 'Ventas', state: 'ACW', stateColor: '#F5A524', time: '01:22', avatar: 'LO', color: '#E879A6' },
  { id: 'a4', name: 'Diego Paredes', role: 'Agent', team: 'Soporte L1', state: 'En llamada', stateColor: '#1FAE6C', time: '08:01', avatar: 'DP', color: '#F5A524' },
  { id: 'a5', name: 'Renata Castro', role: 'Agent', team: 'Soporte L1', state: 'Break', stateColor: '#F5A524', time: '06:33', avatar: 'RC', color: '#1FAE6C' },
  { id: 'a6', name: 'Iván Beltrán', role: 'Agent', team: 'Ventas', state: 'Disponible', stateColor: '#1FAE6C', time: '02:14', avatar: 'IB', color: '#E5484D' },
  { id: 'a7', name: 'Sofía Aguilar', role: 'Sr. Agent', team: 'Soporte L2', state: 'En llamada', stateColor: '#1FAE6C', time: '11:47', avatar: 'SA', color: '#22B8D9' },
  { id: 'a8', name: 'Tomás Herrera', role: 'Agent', team: 'Retención', state: 'Disponible', stateColor: '#1FAE6C', time: '00:12', avatar: 'TH', color: '#8B7EE8' },
  { id: 'a9', name: 'Valeria Núñez', role: 'Agent', team: 'Ventas', state: 'En llamada', stateColor: '#1FAE6C', time: '03:55', avatar: 'VN', color: '#F5A524' },
  { id: 'a10', name: 'Joaquín Mora', role: 'Agent', team: 'Soporte L1', state: 'No conectado', stateColor: '#5F6E8C', time: '—', avatar: 'JM', color: '#5F6E8C' },
];

const CONTACTS = [
  { id: 'c1', name: 'Ariadna Ferré', company: 'Nordal Logistics', segment: 'Enterprise', status: 'Activo', email: 'a.ferre@nordal.co', phone: '+34 612 884 122', lastTouch: 'Hace 2h', owner: 'CR', value: 184500, channel: 'voice', satisfaction: 92 },
  { id: 'c2', name: 'Heriberto Quiñones', company: 'Magnoli & Cía', segment: 'Mid-Market', status: 'Caso abierto', email: 'h.q@magnoli.mx', phone: '+52 55 1234 7766', lastTouch: 'Hace 14m', owner: 'MS', value: 42800, channel: 'wa', satisfaction: 71 },
  { id: 'c3', name: 'Béatrice Salvatori', company: 'OmniVault', segment: 'Enterprise', status: 'Renovación', email: 'b.salvatori@omnivault.eu', phone: '+39 02 8801 4521', lastTouch: 'Ayer', owner: 'LO', value: 612000, channel: 'email', satisfaction: 88 },
  { id: 'c4', name: 'Kasimir Pawlak', company: 'Stryga Bank', segment: 'Enterprise', status: 'En riesgo', email: 'k.pawlak@stryga.eu', phone: '+48 22 770 8810', lastTouch: 'Hace 3d', owner: 'SA', value: 920400, channel: 'voice', satisfaction: 54 },
  { id: 'c5', name: 'Imani Okafor', company: 'Halcyon Foods', segment: 'SMB', status: 'Activo', email: 'imani@halcyon.io', phone: '+1 415 220 7782', lastTouch: 'Hace 1h', owner: 'IB', value: 18900, channel: 'chat', satisfaction: 84 },
  { id: 'c6', name: 'Rodion Larsen', company: 'Brattby Energi', segment: 'Mid-Market', status: 'Lead', email: 'r.larsen@brattby.no', phone: '+47 99 442 110', lastTouch: 'Hace 6h', owner: 'TH', value: 67200, channel: 'sms', satisfaction: 78 },
  { id: 'c7', name: 'Solange Médard', company: 'Atlas Médard', segment: 'SMB', status: 'Activo', email: 's.medard@atlas.fr', phone: '+33 1 4488 2230', lastTouch: 'Hace 30m', owner: 'CR', value: 24300, channel: 'voice', satisfaction: 95 },
  { id: 'c8', name: 'Yusuf Tahiri', company: 'Kelibia Maritime', segment: 'Enterprise', status: 'Renovación', email: 'y.tahiri@kelibia.tn', phone: '+216 71 332 480', lastTouch: 'Hace 4h', owner: 'VN', value: 348700, channel: 'email', satisfaction: 81 },
];

const QUEUES = [
  { id: 'q1', name: 'Voz · Retención',     channel: 'voice', inQueue: 12, sla: 78, longest: 142, status: 'warn' },
  { id: 'q2', name: 'Voz · Soporte L1',    channel: 'voice', inQueue: 28, sla: 41, longest: 348, status: 'alert' },
  { id: 'q3', name: 'WhatsApp · Ventas',   channel: 'wa',    inQueue: 8,  sla: 95, longest: 38,  status: 'ok' },
  { id: 'q4', name: 'Chat · Soporte',      channel: 'chat',  inQueue: 15, sla: 89, longest: 84,  status: 'ok' },
  { id: 'q5', name: 'Email · Facturación', channel: 'email', inQueue: 47, sla: 72, longest: 1820, status: 'warn' },
  { id: 'q6', name: 'SMS · Cobranza',      channel: 'sms',   inQueue: 4,  sla: 100, longest: 12, status: 'ok' },
];

const CASES = [
  { id: 'VX-4821', subject: 'Cargo duplicado en factura de marzo', priority: 'Alta',   status: 'Abierto',     contact: 'Heriberto Quiñones', owner: 'MS', sla: 'En riesgo', age: '2h 14m', channel: 'wa' },
  { id: 'VX-4820', subject: 'Solicita cancelación de servicio premium', priority: 'Crítica', status: 'En proceso', contact: 'Kasimir Pawlak',     owner: 'SA', sla: 'Vence en 22m', age: '3h 02m', channel: 'voice' },
  { id: 'VX-4819', subject: 'No recibe códigos OTP en SMS', priority: 'Media',  status: 'Esperando cliente', contact: 'Imani Okafor',     owner: 'IB', sla: 'OK', age: '1d 4h', channel: 'sms' },
  { id: 'VX-4815', subject: 'Cambio de titular de la cuenta', priority: 'Baja',   status: 'En proceso',  contact: 'Solange Médard',     owner: 'CR', sla: 'OK', age: '5h 11m', channel: 'email' },
  { id: 'VX-4812', subject: 'Reclamo por demora en envío internacional', priority: 'Alta',   status: 'Abierto',     contact: 'Ariadna Ferré',      owner: 'CR', sla: 'OK', age: '38m', channel: 'voice' },
  { id: 'VX-4808', subject: 'Activación de módulo de reportes', priority: 'Media',  status: 'Resuelto',    contact: 'Béatrice Salvatori', owner: 'LO', sla: 'OK', age: '2d', channel: 'chat' },
  { id: 'VX-4801', subject: 'Pregunta sobre integración API v3', priority: 'Baja',   status: 'Resuelto',    contact: 'Rodion Larsen',      owner: 'TH', sla: 'OK', age: '3d', channel: 'email' },
];

const CAMPAIGNS = [
  { id: 'cm1', name: 'Renovación Q3 Enterprise',     channel: 'voice', status: 'En curso',   progress: 64, reached: 1248, total: 1950, conversion: 18.4, owner: 'CR' },
  { id: 'cm2', name: 'WhatsApp · Carrito abandonado', channel: 'wa',    status: 'En curso',   progress: 88, reached: 8412, total: 9560, conversion: 9.2,  owner: 'LO' },
  { id: 'cm3', name: 'Encuesta NPS post-onboarding',  channel: 'email', status: 'Programada', progress: 0,  reached: 0,    total: 4200, conversion: 0,    owner: 'SA' },
  { id: 'cm4', name: 'SMS · Recordatorio cobranza',   channel: 'sms',   status: 'En curso',   progress: 42, reached: 2104, total: 5012, conversion: 24.1, owner: 'IB' },
  { id: 'cm5', name: 'Outbound Mid-Market — Spain',   channel: 'voice', status: 'Pausada',    progress: 31, reached: 612,  total: 1980, conversion: 11.7, owner: 'TH' },
];

const WORKFLOWS = [
  { id: 'w1', name: 'Routing inteligente · Soporte',   trigger: 'Llamada entrante', runs: 12480, success: 99.2, lastRun: 'Hace 4s',  status: 'Activo' },
  { id: 'w2', name: 'Wrap-up automatizado',             trigger: 'Fin de llamada',   runs: 8124,  success: 97.8, lastRun: 'Hace 11s', status: 'Activo' },
  { id: 'w3', name: 'Escalado de SLA crítico',          trigger: 'Caso > 1h sin asignar', runs: 312, success: 100, lastRun: 'Hace 8m', status: 'Activo' },
  { id: 'w4', name: 'Confirmación WhatsApp 24h',        trigger: 'Caso resuelto',    runs: 4620,  success: 96.4, lastRun: 'Hace 2m',  status: 'Activo' },
  { id: 'w5', name: 'Reasignación por sentiment ≤ -0.6', trigger: 'Contact Lens',     runs: 184,   success: 89.7, lastRun: 'Hace 22m', status: 'Activo' },
  { id: 'w6', name: 'Outbound de bienvenida',            trigger: 'Nuevo lead',       runs: 1102,  success: 94.1, lastRun: 'Hace 3h',  status: 'Pausado' },
];

const TRANSCRIPT_SCRIPT = [
  { who: 'agent', text: 'Buenas tardes, gracias por comunicarse con Vox, le atiende Camila. ¿Con quién tengo el gusto?', sent: 'neu', t: '00:02' },
  { who: 'customer', text: 'Hola Camila, soy Ariadna Ferré, de Nordal Logistics. Estoy llamando por el envío de la semana pasada que aún no llega.', sent: 'neu', t: '00:09' },
  { who: 'agent', text: 'Lamento mucho la situación, Ariadna. Déjeme verificar el estado del envío en este momento.', sent: 'pos', t: '00:18' },
  { who: 'customer', text: 'Es la tercera vez que llamo por esto. Necesito una respuesta clara, esto está afectando a mis clientes.', sent: 'neg', t: '00:26' },
  { who: 'agent', text: 'Entiendo perfectamente la frustración. Veo aquí su ticket VX-4812 y la trazabilidad. Voy a escalar esto con prioridad ahora mismo.', sent: 'pos', t: '00:38' },
  { who: 'customer', text: 'Eso me tranquiliza. ¿Tienen alguna fecha estimada de entrega?', sent: 'neu', t: '00:51' },
  { who: 'agent', text: 'Según el carrier, la entrega revisada es para mañana antes de las 14:00. Le voy a enviar la confirmación por correo en cuanto colguemos.', sent: 'pos', t: '01:02' },
  { who: 'customer', text: 'Perfecto, muchas gracias. ¿Puedo recibir una compensación por la demora?', sent: 'pos', t: '01:14' },
];

const Q_SUGGESTIONS = [
  { id: 's1', title: 'Compensación elegible', body: 'El cliente cumple criterios para un crédito de 8% (Tier Enterprise + envío >3 días de retraso). Aplica el SKU CRED-LATE-08.', actions: ['Aplicar crédito', 'Ver política'] },
  { id: 's2', title: 'Knowledge Base', body: '3 artículos relevantes: "Política de compensación por demoras", "Trazabilidad para envíos internacionales", "Escalado prioritario clientes Enterprise".', actions: ['Abrir artículos'] },
  { id: 's3', title: 'Próxima mejor acción', body: 'Programa un follow-up en 24h para confirmar entrega. Cliente con NPS histórico de 9 — prioriza retención.', actions: ['Crear tarea'] },
];

const NOTIFICATIONS = [
  { id: 'n1', title: 'SLA en riesgo · Voz Soporte L1', body: 'La cola supera 5min de espera promedio.', time: '2m', kind: 'warn' },
  { id: 'n2', title: 'Nuevo caso asignado', body: 'VX-4821 · Heriberto Quiñones', time: '14m', kind: 'info' },
  { id: 'n3', title: 'Resumen Contact Lens listo', body: 'Llamada de 09:42 procesada con sentiment positivo.', time: '32m', kind: 'ok' },
];

window.DATA = { AGENTS, CONTACTS, QUEUES, CASES, CAMPAIGNS, WORKFLOWS, TRANSCRIPT_SCRIPT, Q_SUGGESTIONS, NOTIFICATIONS };
