#!/usr/bin/env python
"""Genera ARIA-Historias-de-Usuario-y-Casos-de-Prueba.xlsx (openpyxl).
Hojas: Portada · Historias de Usuario · Criterios de Aceptacion · Casos de Prueba
· Matriz de Trazabilidad. Sin fórmulas (catálogo estático) → cero errores."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
import os

PLUM = "7A1E52"; MAGENTA = "BC5587"; AMBER = "D98A2B"
BAND = "FBF1F5"; INK = "1F2A40"; GREY = "7A879F"; LINE = "E7EAF0"
FONT = "Arial"

thin = Side(style="thin", color=LINE)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

def hdr(c):
    c.font = Font(name=FONT, bold=True, color="FFFFFF", size=10.5)
    c.fill = PatternFill("solid", fgColor=PLUM)
    c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    c.border = BORDER

def cell(c, band=False, top=True, bold=False, color=INK, wrap=True, center=False):
    c.font = Font(name=FONT, size=10, bold=bold, color=color)
    c.alignment = Alignment(horizontal="center" if center else "left",
                            vertical="top" if top else "center", wrap_text=wrap)
    if band:
        c.fill = PatternFill("solid", fgColor=BAND)
    c.border = BORDER

def sheet_table(ws, headers, widths, rows, freeze="A3", estado_col=None):
    for j, (h, w) in enumerate(zip(headers, widths), start=1):
        ws.column_dimensions[get_column_letter(j)].width = w
        c = ws.cell(row=2, column=j, value=h); hdr(c)
    ws.row_dimensions[2].height = 26
    for i, row in enumerate(rows):
        band = i % 2 == 1
        for j, val in enumerate(row, start=1):
            c = ws.cell(row=3 + i, column=j, value=val)
            cell(c, band=band, center=(j == 1))
    ws.freeze_panes = freeze
    ws.auto_filter.ref = f"A2:{get_column_letter(len(headers))}{2 + len(rows)}"
    if estado_col:
        dv = DataValidation(type="list",
                            formula1='"Pendiente,En progreso,Pasó,Falló,Bloqueado"',
                            allow_blank=True)
        ws.add_data_validation(dv)
        col = get_column_letter(estado_col)
        dv.add(f"{col}3:{col}{2 + len(rows)}")

# ─────────────────────────── CONTENIDO ───────────────────────────
# (cu, modulo, [historias]); cada historia: (hu, rol, historia, prioridad,
#  [criterios: (ca, escenario, dado, cuando, entonces)],
#  [pruebas: (cp, titulo, tipo, prioridad, precond, pasos, datos, esperado)])
DATA = [
 ("CU-T-01","Identidad y onboarding",[
   ("HU-01","usuario nuevo","registrarme con mi correo y los datos de mi empresa para tener mi propia organización en ARIA","Must",
    [("CA-01.1","Registro exitoso","ingreso email, contraseña, nombre y empresa válidos","confirmo el registro","se crea mi organización (tenantId), quedo como Admin y accedo a la app"),
     ("CA-01.2","Correo duplicado","uso un correo ya registrado","intento registrarme","el sistema lo rechaza y muestra 'cuenta existente'")],
    [("CP-01.1","Alta de organización nueva","Funcional","Alta","No existe cuenta con ese correo","1. Abrir registro\n2. Ingresar datos válidos\n3. Confirmar correo","nuevo@demo.com","Se crea el tenantId; el usuario queda en el grupo Admins; carga la UI de Admin"),
     ("CP-01.2","Registro con correo duplicado","Negativa","Media","Correo ya registrado","1. Abrir registro\n2. Ingresar correo existente\n3. Confirmar","correo existente","Mensaje 'cuenta existente'; no se crea un tenant nuevo")]),
  ]),
 ("CU-T-02","Identidad y onboarding",[
   ("HU-02","agente","iniciar sesión y abrir mi softphone para atender llamadas","Must",
    [("CA-02.1","Softphone listo","tengo sesión válida y pulso 'Conectar'","la federación o el login de Connect completan","el softphone queda operativo para voz/chat"),
     ("CA-02.2","Degradación sin voz","la conexión de voz falla","abro la app","la app sigue funcionando en canales digitales y marca softphoneUnavailable")],
    [("CP-02.1","Apertura de softphone","Funcional","Alta","Sesión Cognito válida; instancia Connect conectada","1. Iniciar sesión\n2. Pulsar 'Conectar'","-","El softphone pasa a estado disponible; se puede recibir/emitir voz"),
     ("CP-02.2","Voz caída, app operativa","Negativa","Alta","Connect no disponible","1. Iniciar sesión\n2. Forzar fallo de voz","-","softphoneUnavailable=true; chat/WhatsApp/correo siguen operativos"),
     ("CP-02.3","Guard multipestaña","Funcional","Media","Softphone ya abierto en otra pestaña","1. Abrir ARIA en 2ª pestaña","-","La 2ª pestaña ofrece 'Usar aquí'; no se duplica el softphone")]),
  ]),
 ("CU-T-03","Identidad y onboarding",[
   ("HU-03","administrador del cliente","conectar mi propia instancia de Amazon Connect sin entregar credenciales","Must",
    [("CA-03.1","Conexión BYO verificada","apliqué la plantilla y pegué el Role ARN","pulso 'Verificar'","el diagnóstico asume el rol y muestra 'Conectado (N OK · 0 error)'"),
     ("CA-03.2","Rol mal configurado","el rol carece de permisos","pulso 'Verificar'","el diagnóstico lista cada checo fallido con su error puntual")],
    [("CP-03.1","Onboarding BYO feliz","E2E","Alta","Cuenta AWS con instancia Connect","1. Iniciar 'Conectar Connect'\n2. Aplicar plantilla\n3. Pegar Role ARN + ARN instancia\n4. Verificar","Role ARN válido","Config guardada en connectview-connections; verificación OK"),
     ("CP-03.2","Verificación con permisos faltantes","Negativa","Media","Rol sin permisos de tablas","1. Pegar Role ARN incompleto\n2. Verificar","Rol limitado","Se listan los checks fallidos; no marca conectado")]),
  ]),
 ("CU-T-04","Identidad y onboarding",[
   ("HU-04","administrador","conectar Salesforce y WhatsApp para que ARIA se acople a mi stack","Should",
    [("CA-04.1","Salesforce OAuth","completo el OAuth de Salesforce","vuelvo a ARIA","se guardan tokens en Secrets Manager y se descubre el esquema para el mapeo"),
     ("CA-04.2","Alta de número WhatsApp","registro número y WABA","guardo","el número queda disponible con su flujo (vista Ruteo)")],
    [("CP-04.1","Conectar Salesforce","Funcional","Media","Org Salesforce disponible","1. Iniciar OAuth\n2. Autorizar\n3. Volver a ARIA","credenciales SF","Estado 'conectado'; mapeo de campos disponible"),
     ("CP-04.2","Alta de número WhatsApp","Funcional","Media","WABA aprobado","1. Registrar número + WABA\n2. Guardar","+51 9XXXXXXXX","Número activo; enrutable por flujo")]),
  ]),
 ("CU-T-05","Captación e ingesta",[
   ("HU-05","responsable de marketing","que los leads de Meta entren solos y se contacten al instante para no enfriarlos","Must",
    [("CA-05.1","Ingesta y speed-to-lead","llega un evento leadgen de Meta","se procesa","se crea el lead, se clasifica en su Programa y se dispara el primer contacto en segundos"),
     ("CA-05.2","Deduplicación","el teléfono ya existe","llega el leadgen","se fusiona el historial en vez de duplicar el lead")],
    [("CP-05.1","Lead nuevo end-to-end","E2E","Alta","Página Meta conectada; formulario publicado","1. Enviar leadgen de prueba\n2. Observar embudo","lead de prueba","Lead creado y clasificado; WhatsApp de bienvenida enviado; tarea al asesor"),
     ("CP-05.2","Lead duplicado","Negativa","Media","Teléfono ya registrado","1. Enviar leadgen con teléfono existente","teléfono repetido","No se duplica; se fusiona el historial")]),
  ]),
 ("CU-T-06","Atención omnicanal",[
   ("HU-06","agente","recibir el contacto con el contexto 360° del cliente para atender sin buscar en otras pantallas","Must",
    [("CA-06.1","Contexto al aceptar","acepto un contacto entrante","se abre el workspace","veo perfil, historial y transcripción en vivo del cliente"),
     ("CA-06.2","Copiloto en vivo","estoy en la conversación","pido sugerencias","el copiloto propone réplicas y próxima acción")],
    [("CP-06.1","Atención con 360°","Funcional","Alta","Softphone conectado; contacto en cola","1. Aceptar contacto\n2. Revisar paneles","contacto de prueba","Cargan perfil, historial y transcripción sin cambiar de pantalla"),
     ("CP-06.2","Cierre con tipificación asistida","Funcional","Media","Contacto en curso","1. Finalizar\n2. Aceptar tipificación sugerida","-","Wrap-up guardado; perfil e historial actualizados")]),
  ]),
 ("CU-T-07","Atención omnicanal",[
   ("HU-07","cliente por WhatsApp","recibir respuesta inmediata a mis dudas frecuentes a cualquier hora","Must",
    [("CA-07.1","Respuesta con fuente","escribo una consulta cubierta por la base","el bot responde","da la respuesta correcta citando la fuente, desde el número del cliente"),
     ("CA-07.2","Fallback controlado","pregunto algo fuera de la base","el bot no encuentra match","responde con un fallback controlado o deriva")],
    [("CP-07.1","Consulta resuelta por el bot","Funcional","Alta","Bot publicado; número conectado","1. Enviar consulta conocida por WhatsApp","'¿cuánto cuesta?'","Respuesta correcta con citación; enviada desde el número del tenant"),
     ("CP-07.2","Consulta sin cobertura","Negativa","Media","Bot publicado","1. Enviar consulta fuera de alcance","pregunta rara","Fallback controlado; sin respuesta inventada")]),
  ]),
 ("CU-T-08","Atención omnicanal",[
   ("HU-08","cliente","hablar con una persona sin repetir lo que ya conté al bot","Must",
    [("CA-08.1","Handoff con contexto","pido hablar con un asesor","el bot deriva","el agente recibe el contacto con el historial del bot ya cargado"),
     ("CA-08.2","Sin agentes disponibles","no hay agentes u horario","el bot intenta derivar","ofrece agendar callback o continuar por bot")],
    [("CP-08.1","Derivación a humano","Funcional","Alta","Conversación de bot en curso; agentes disponibles","1. Escribir 'quiero hablar con un asesor'","-","El contacto entra a cola con contexto; el agente lo ve"),
     ("CP-08.2","Derivación fuera de horario","Negativa","Media","Sin agentes en línea","1. Pedir asesor fuera de horario","-","Ofrece callback/cita; no deja al cliente sin salida")]),
  ]),
 ("CU-T-09","Salida y campañas",[
   ("HU-09","supervisor","lanzar una campaña de voz o WhatsApp con reglas para contactar una base sin saturar","Must",
    [("CA-09.1","Campaña en ejecución","configuré audiencia, canal y reglas y activo","el marcador corre","respeta pacing/% abandono y reparte entre agentes; veo KPIs en vivo"),
     ("CA-09.2","Respeta supresión","un número está en no-molestar","la campaña llega a él","lo salta sin contactar")],
    [("CP-09.1","Campaña de voz predictiva","E2E","Alta","Audiencia cargada; agentes asignados","1. Crear campaña voz\n2. Activar\n3. Observar KPIs","100 contactos","Marca respetando pacing; KPIs (contactados/conversión/AHT) en vivo"),
     ("CP-09.2","Campaña WhatsApp con plantilla","Funcional","Alta","Plantilla aprobada","1. Crear campaña WhatsApp\n2. Activar","plantilla aprobada","Envío desde el número del tenant con botones"),
     ("CP-09.3","Número suprimido en campaña","Negativa","Alta","Número en DNC dentro de la audiencia","1. Ejecutar campaña","número DNC","El número se omite; queda registrado el motivo")]),
  ]),
 ("CU-T-10","Automatización e IA",[
   ("HU-10","agente","obtener un resumen y tipificación automáticos de la llamada para cerrar en segundos","Should",
    [("CA-10.1","Resumen generado","termina la llamada con transcripción","abro wrap-up","la IA muestra resumen, tipificación y próxima acción"),
     ("CA-10.2","Degradación de IA","Bedrock no responde","pido el resumen","se muestra un mensaje suave y puedo redactar manual")],
    [("CP-10.1","Resumen de llamada","Funcional","Media","Contacto con transcripción","1. Finalizar llamada\n2. Abrir copiloto/wrap-up","llamada de prueba","Resumen + tipificación sugerida + próxima acción"),
     ("CP-10.2","Fallo de Bedrock","Negativa","Baja","Bedrock no disponible","1. Solicitar resumen","-","Mensaje suave; el agente puede redactar manual (sin bloqueo)")]),
  ]),
 ("CU-T-11","Automatización e IA",[
   ("HU-11","administrador","definir reglas 'cuando pase X haz Y' para que el trabajo repetitivo se haga solo","Should",
    [("CA-11.1","Regla ejecutada","hay una regla activa y ocurre su evento","el motor evalúa","ejecuta las acciones resolviendo los tokens [[name]]/{{name}}"),
     ("CA-11.2","Sin coincidencia","ninguna regla coincide con el evento","ocurre el evento","no se ejecuta ninguna acción (no-op)")],
    [("CP-11.1","Automatización trigger→acción","Funcional","Media","Regla 'nuevo lead → notificar + plantilla' activa","1. Crear un lead\n2. Verificar acciones","lead de prueba","Se notifica al agente y se envía la plantilla con tokens resueltos"),
     ("CP-11.2","Evento sin regla","Negativa","Baja","Sin reglas que apliquen","1. Disparar evento no cubierto","-","No se ejecuta ninguna acción")]),
  ]),
 ("CU-T-12","Automatización e IA",[
   ("HU-12","administrador","armar recorridos multi-paso (mensaje→espera→condición) que avancen solos","Could",
    [("CA-12.1","Journey avanza","un contacto está inscrito y se cumple la espera","corre el runner","el contacto pasa al siguiente paso según condiciones"),
     ("CA-12.2","Salida temprana","el contacto convierte o pide baja","corre el runner","el contacto abandona el journey")],
    [("CP-12.1","Avance de journey","Funcional","Media","Journey publicado; contacto inscrito","1. Inscribir contacto\n2. Esperar el tick","contacto de prueba","El contacto avanza de paso; se registran eventos"),
     ("CP-12.2","Salida por conversión","Funcional","Baja","Contacto en journey","1. Marcar conversión\n2. Esperar tick","-","El contacto sale del journey")]),
  ]),
 ("CU-T-13","Automatización e IA",[
   ("HU-13","sistema","cerrar las conversaciones de forma consistente por cualquiera de los tres disparadores","Should",
    [("CA-13.1","Cierre manual/IA","el agente cierra o el Agente IA marca done","se invoca closeConversation","la conversación queda cerrada y se consolidan métricas"),
     ("CA-13.2","Cierre por inactividad","pasan ~10 min sin actividad","corre el reaper","la conversación se cierra automáticamente")],
    [("CP-13.1","Cierre por agente","Funcional","Media","Conversación abierta","1. Cerrar desde el workspace","-","Conversación cerrada; métricas consolidadas"),
     ("CP-13.2","Cierre por reaper","Funcional","Media","Conversación inactiva","1. Dejar inactiva >10 min","-","El reaper la cierra; no queda colgada")]),
  ]),
 ("CU-T-14","Salida y campañas",[
   ("HU-14","oficial de cumplimiento","que ningún número en 'no molestar' sea contactado para cuidar la reputación","Must",
    [("CA-14.1","Bloqueo por supresión","un número está suprimido","se intenta un contacto saliente","el contacto se bloquea y se registra el motivo"),
     ("CA-14.2","Fail-open","el servicio de supresión no responde","se intenta un contacto","no se bloquea pero se avisa (no frena la operación)")],
    [("CP-14.1","Contacto a número suprimido","Negativa","Alta","Número en lista de supresión","1. Intentar llamada/WhatsApp saliente","número DNC","Se bloquea; motivo registrado"),
     ("CP-14.2","Supresión no disponible (fail-open)","Negativa","Media","Servicio de supresión caído","1. Intentar contacto","-","No bloquea, pero deja aviso; la operación continúa")]),
  ]),
 ("CU-T-15","Analítica e integración",[
   ("HU-15","supervisor","ver tableros por dominio y exportar reportes para decidir con datos","Should",
    [("CA-15.1","KPIs con comparación","abro Reportes","cargan los tableros","veo KPIs por dominio comparados contra el período previo"),
     ("CA-15.2","Exportación","elijo un reporte","descargo","obtengo Excel/CSV; existe feed seguro para Power BI")],
    [("CP-15.1","Tablero por programa","Funcional","Media","Actividad registrada","1. Abrir Reportes\n2. Filtrar por programa","rango + programa","KPIs segmentados con delta vs período previo"),
     ("CP-15.2","Descarga de reporte","Funcional","Baja","Datos disponibles","1. Elegir reporte\n2. Descargar","-","Archivo Excel/CSV correcto")]),
  ]),
 ("CU-T-16","Analítica e integración",[
   ("HU-16","sistema","sincronizar la actividad con Salesforce para mantener el CRM del cliente al día","Should",
    [("CA-16.1","Write-back","ocurre un golpe/cierre relevante","corre la sincronización","se hace upsert de Lead/Task y campos Vox*__c con dedupe"),
     ("CA-16.2","Campo inexistente","el org no tiene un campo destino","corre la sincronización","el mapeo lo omite sin romper el sync")],
    [("CP-16.1","Sync de gestión a Salesforce","Funcional","Media","Salesforce conectado y mapeado","1. Registrar una gestión\n2. Verificar en SF","lead con teléfono","Upsert correcto; sin duplicar por teléfono/VoxLeadId"),
     ("CP-16.2","Mapeo con campo ausente","Negativa","Baja","Campo destino inexistente en el org","1. Sincronizar","-","Se omite el campo; el resto del sync no falla")]),
  ]),
]

PRIOR_ORDER = {"Must": 0, "Should": 1, "Could": 2, "Won't": 3}

wb = Workbook()

# ── Portada ──
ws = wb.active; ws.title = "Portada"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 3
ws.column_dimensions["B"].width = 108
def prow(r, text, size, color, bold=True, top=6):
    c = ws.cell(row=r, column=2, value=text)
    c.font = Font(name=FONT, size=size, bold=bold, color=color)
    c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[r].height = top
prow(3, "ARIA · by Novasys", 12, MAGENTA); ws.row_dimensions[3].height = 20
prow(4, "Historias de Usuario, Criterios de Aceptación y Casos de Prueba", 20, PLUM); ws.row_dimensions[4].height = 34
prow(5, "Documento de QA — trazable con los Casos de Uso Técnicos (CU-T-NN). Actualizado 2026-07-10.", 11, INK, bold=False); ws.row_dimensions[5].height = 20
# conteos (estáticos: catálogo cerrado)
n_hu = sum(len(h) for _,_,hs in DATA for h in [hs]) if False else sum(len(hs) for _,_,hs in DATA)
n_ca = sum(len(cr) for _,_,hs in DATA for (_,_,_,_,cr,_) in hs)
n_cp = sum(len(pr) for _,_,hs in DATA for (_,_,_,_,_,pr) in hs)
prow(7, "Contenido de este libro", 13, PLUM); ws.row_dimensions[7].height = 22
idx = [
  ("Historias de Usuario", f"{n_hu} historias — formato «Como… quiero… para…» con prioridad MoSCoW."),
  ("Criterios de Aceptación", f"{n_ca} escenarios — formato Dado / Cuando / Entonces (Gherkin)."),
  ("Casos de Prueba", f"{n_cp} casos — pasos, datos y resultado esperado; columna Estado editable."),
  ("Matriz de Trazabilidad", "Cadena Módulo → Caso de uso → Historia → Criterio → Caso de prueba."),
]
r = 8
for name, desc in idx:
    c = ws.cell(row=r, column=2, value=f"•  {name}")
    c.font = Font(name=FONT, size=11, bold=True, color=INK)
    r += 1
    d = ws.cell(row=r, column=2, value=f"     {desc}")
    d.font = Font(name=FONT, size=10, color=GREY); d.alignment = Alignment(wrap_text=True)
    ws.row_dimensions[r].height = 16
    r += 1
prow(r+1, "Leyenda — Prioridad (MoSCoW): Must (imprescindible) · Should (importante) · Could (deseable).", 9.5, GREY, bold=False)
prow(r+2, "Leyenda — Tipo de prueba: Funcional · Negativa · E2E (extremo a extremo).", 9.5, GREY, bold=False)
prow(r+3, "Estado de prueba: Pendiente · En progreso · Pasó · Falló · Bloqueado.", 9.5, GREY, bold=False)

# ── Historias de Usuario ──
ws = wb.create_sheet("Historias de Usuario")
hu_rows = []
for cu, mod, hs in DATA:
    for hu, rol, hist, prio, cr, pr in hs:
        hu_rows.append([hu, mod, f"Como {rol}, quiero {hist}.", prio, cu])
hu_rows.sort(key=lambda x: (PRIOR_ORDER.get(x[3], 9), x[0]))
sheet_table(ws, ["ID","Módulo","Historia de usuario","Prioridad","Caso de uso"],
            [10, 24, 72, 12, 13], hu_rows)

# ── Criterios de Aceptación ──
ws = wb.create_sheet("Criterios de Aceptacion")
ca_rows = []
for cu, mod, hs in DATA:
    for hu, rol, hist, prio, cr, pr in hs:
        for ca, esc, dado, cuando, ent in cr:
            ca_rows.append([ca, hu, esc, f"Dado que {dado}", f"Cuando {cuando}", f"Entonces {ent}"])
sheet_table(ws, ["ID","Historia","Escenario","Dado","Cuando","Entonces"],
            [11, 10, 24, 34, 30, 40], ca_rows)

# ── Casos de Prueba ──
ws = wb.create_sheet("Casos de Prueba")
cp_rows = []
for cu, mod, hs in DATA:
    for hu, rol, hist, prio, cr, pr in hs:
        for cp, tit, tipo, tprio, prec, pasos, datos, esp in pr:
            cp_rows.append([cp, tit, cu, hu, tipo, tprio, prec, pasos, datos, esp, "Pendiente"])
sheet_table(ws, ["ID","Título","Caso de uso","Historia","Tipo","Prioridad",
                 "Precondición","Pasos","Datos","Resultado esperado","Estado"],
            [11, 26, 13, 10, 11, 11, 26, 34, 16, 38, 13], cp_rows,
            estado_col=11)
# filas de pasos: un poco más altas por el multilínea
for i in range(len(cp_rows)):
    ws.row_dimensions[3 + i].height = 58

# ── Matriz de Trazabilidad ──
ws = wb.create_sheet("Matriz de Trazabilidad")
tz_rows = []
for cu, mod, hs in DATA:
    for hu, rol, hist, prio, cr, pr in hs:
        cas = ", ".join(c[0] for c in cr)
        for cp, tit, tipo, tprio, prec, pasos, datos, esp in pr:
            tz_rows.append([mod, cu, hu, cas, cp, tit])
sheet_table(ws, ["Módulo","Caso de uso","Historia","Criterios","Caso de prueba","Título del caso de prueba"],
            [24, 13, 11, 20, 13, 40], tz_rows)

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "docs", "tecnico", "ARIA-Historias-de-Usuario-y-Casos-de-Prueba.xlsx")
wb.save(OUT)
print("OK", OUT)
print(f"Historias={n_hu} Criterios={n_ca} CasosDePrueba={n_cp} Traza={len(tz_rows)}")
