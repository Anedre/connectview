"""
Build UDEP-Main-Inbound contact flow JSON.

Uses Amazon Connect Flow Language v2019-10-30 with:
- WhatsApp interactive messages (ListPicker / QuickReply) via MessageParticipant
- Lex V2 NLU via ConnectParticipantWithLexBot
- Branching by intent + slot
- Queue routing
"""
import json
import uuid

# Resource IDs (already created)
INSTANCE = "arn:aws:connect:us-east-1:731736972577:instance/2345d564-4bd4-4318-9cf0-75649bad5197"
HOURS_UDEP = f"{INSTANCE}/operating-hours/d697fc10-4c4c-42b8-b927-99e88196540e"
Q_PRE = f"{INSTANCE}/queue/9ff3b0a1-90aa-4d2a-8029-c4526a22adc8"
Q_POS = f"{INSTANCE}/queue/72e0ce0c-27d6-496c-9746-0394ba5a21e7"
Q_DIP = f"{INSTANCE}/queue/b2865a8e-0d74-42d7-974a-8761beb34677"
Q_ALU = f"{INSTANCE}/queue/06bd9e25-c6db-4b04-b8be-103c508b03d1"
LEX_ALIAS = "arn:aws:lex:us-east-1:731736972577:bot-alias/VKG6YJG4DO/N1CUYQL5IK"
FLOW_CUSTOMER_QUEUE = f"{INSTANCE}/contact-flow/934b7516-939e-4899-a112-9c2d405d564e"
FLOW_DISCONNECT = f"{INSTANCE}/contact-flow/a2f5f398-f4f2-453a-afed-166344904364"
LAMBDA_LOOKUP = "arn:aws:lambda:us-east-1:731736972577:function:UDEP-Lookup-Lead"
LAMBDA_SEND_WA = "arn:aws:lambda:us-east-1:731736972577:function:UDEP-Send-WhatsApp-Interactive"


def nid():
    return str(uuid.uuid4())


def action(typ, params, transitions=None, ident=None):
    """Build a flow action node."""
    return {
        "Identifier": ident or nid(),
        "Type": typ,
        "Parameters": params,
        "Transitions": transitions or {},
    }


def interactive(template_type, content):
    """Serialize an interactive message payload."""
    return json.dumps({
        "templateType": template_type,
        "version": "1.0",
        "data": {"content": content},
    }, ensure_ascii=False)


# === Build the action graph ===
actions = []

# 1. Logging on
log = action("UpdateFlowLoggingBehavior", {"FlowLoggingBehavior": "Enabled"})
actions.append(log)

# 2. Voice + language
voice = action(
    "UpdateContactTextToSpeechVoice",
    {"TextToSpeechVoice": "Lupe"},
)
actions.append(voice)
log["Transitions"]["NextAction"] = voice["Identifier"]

lang = action("UpdateContactData", {"LanguageCode": "es-US"})
actions.append(lang)
voice["Transitions"]["NextAction"] = lang["Identifier"]
voice["Transitions"]["Errors"] = [{"NextAction": lang["Identifier"], "ErrorType": "NoMatchingError"}]

# 3. Set channel attribute
src = action(
    "UpdateContactAttributes",
    {"Attributes": {"udep_source": "whatsapp", "udep_idioma": "es"}, "TargetContact": "Current"},
)
actions.append(src)
lang["Transitions"]["NextAction"] = src["Identifier"]
lang["Transitions"]["Errors"] = [{"NextAction": src["Identifier"], "ErrorType": "NoMatchingError"}]

# 3b. Lookup lead in Customer Profiles → returns leadType, firstName, programa
lookup = action(
    "InvokeLambdaFunction",
    {
        "LambdaFunctionARN": LAMBDA_LOOKUP,
        "InvocationTimeLimitSeconds": "5",
        "ResponseValidation": {"ResponseType": "JSON"},
    },
)
actions.append(lookup)
src["Transitions"]["NextAction"] = lookup["Identifier"]
src["Transitions"]["Errors"] = [{"NextAction": lookup["Identifier"], "ErrorType": "NoMatchingError"}]

# 3c. Persist Lambda response into contact attributes so the agent / Vox sees them
persist_lead = action(
    "UpdateContactAttributes",
    {
        "Attributes": {
            "udep_lead_type": "$.External.leadType",
            "udep_first_name": "$.External.firstName",
            "udep_programa_interes": "$.External.programa",
            "udep_student_id": "$.External.studentId",
        },
        "TargetContact": "Current",
    },
)
actions.append(persist_lead)
lookup["Transitions"]["NextAction"] = persist_lead["Identifier"]
lookup["Transitions"]["Errors"] = [{"NextAction": persist_lead["Identifier"], "ErrorType": "NoMatchingError"}]

# === Sub-flow heads (forward references) ===
# We define IDs upfront so we can wire transitions before building each branch.
ID_DISCONNECT = nid()
ID_DISCONNECT_ERROR = nid()
ID_FUERA_HORARIO_MSG = nid()
ID_WELCOME = nid()
ID_SEND_WA_LAMBDA = nid()
ID_CHECK_WA_SENT = nid()
ID_PLAIN_MENU_FALLBACK = nid()
# After sending the interactive list (or falling back to text), wait for
# the user's response via Lex. Re-prompts (when the user types something
# Lex can't classify) bounce back through ID_SEND_WA_LAMBDA so the
# customer sees the rich list again — not just a plain text menu.
ID_MAIN_MENU = ID_SEND_WA_LAMBDA
ID_MAIN_LEX = nid()
ID_FALLBACK_MSG = nid()
ID_SUB_PREGRADO_SEDE = nid()  # QuickReply sede
ID_SUB_PREGRADO_LEX = nid()
ID_SUB_PREGRADO_SEDE_CMP = nid()

# Queue-bound branches
ID_SET_Q_PREGRADO = nid()
ID_SET_Q_POSGRADO = nid()
ID_SET_Q_DIPLOMADOS = nid()
ID_SET_Q_ALUMNOS = nid()
ID_MSG_TRANSFER = nid()
ID_TRANSFER = nid()


# 4. Hours of operation check
hoo = action(
    "CheckHoursOfOperation",
    {"HoursOfOperationId": HOURS_UDEP},
    {
        "NextAction": ID_FUERA_HORARIO_MSG,
        "Conditions": [
            {"NextAction": ID_WELCOME, "Condition": {"Operator": "Equals", "Operands": ["True"]}},
            {"NextAction": ID_FUERA_HORARIO_MSG, "Condition": {"Operator": "Equals", "Operands": ["False"]}},
        ],
        "Errors": [{"NextAction": ID_FUERA_HORARIO_MSG, "ErrorType": "NoMatchingError"}],
    },
)
actions.append(hoo)
persist_lead["Transitions"]["NextAction"] = hoo["Identifier"]
persist_lead["Transitions"]["Errors"] = [{"NextAction": hoo["Identifier"], "ErrorType": "NoMatchingError"}]

# 5. Fuera de horario
fuera = action(
    "MessageParticipant",
    {"Text": "Gracias por escribir a la Universidad de Piura. Nuestro horario de atencion es L-V 8:00-20:00 y sabados 9:00-13:00. Por favor escribenos en ese horario para ser atendido por un asesor. ¡Hasta pronto!"},
    {"NextAction": ID_DISCONNECT, "Errors": [{"NextAction": ID_DISCONNECT, "ErrorType": "NoMatchingError"}]},
    ident=ID_FUERA_HORARIO_MSG,
)
actions.append(fuera)

# 6. Welcome (uses firstName from Lambda if available — falls back gracefully)
welcome = action(
    "MessageParticipant",
    {"Text": "¡Hola $.Attributes.udep_first_name! 👋 Bienvenido(a) a la *Universidad de Piura*. Soy tu asistente virtual y puedo ayudarte con informacion academica o conectarte con un asesor."},
    ident=ID_WELCOME,
)
actions.append(welcome)

# 6b. Send NATIVE WhatsApp interactive list via Social Messaging Lambda.
# MessageParticipant cannot send Meta interactive content on the
# WhatsApp channel through AWS Social Messaging, so we bypass to the
# socialmessaging:SendWhatsAppMessage API directly.
# (ID_SEND_WA_LAMBDA and ID_PLAIN_MENU_FALLBACK are declared above.)

welcome["Transitions"] = {
    "NextAction": ID_SEND_WA_LAMBDA,
    "Errors": [{"NextAction": ID_SEND_WA_LAMBDA, "ErrorType": "NoMatchingError"}],
}

send_wa = action(
    "InvokeLambdaFunction",
    {
        "LambdaFunctionARN": LAMBDA_SEND_WA,
        "InvocationTimeLimitSeconds": "5",
        "ResponseValidation": {"ResponseType": "JSON"},
    },
    {
        "NextAction": ID_CHECK_WA_SENT,
        "Errors": [{"NextAction": ID_PLAIN_MENU_FALLBACK, "ErrorType": "NoMatchingError"}],
    },
    ident=ID_SEND_WA_LAMBDA,
)
actions.append(send_wa)

# Branch on Lambda success: if "sent"=="true" go straight to Lex listening;
# otherwise drop to the plain text fallback menu (still routes correctly).
check_wa = action(
    "Compare",
    {"ComparisonValue": "$.External.sent"},
    {
        "NextAction": ID_PLAIN_MENU_FALLBACK,
        "Conditions": [
            {"NextAction": ID_MAIN_LEX, "Condition": {"Operator": "Equals", "Operands": ["true"]}},
        ],
        "Errors": [{"NextAction": ID_PLAIN_MENU_FALLBACK, "ErrorType": "NoMatchingCondition"}],
    },
    ident=ID_CHECK_WA_SENT,
)
actions.append(check_wa)

# 7. Plain-text fallback menu (only used if Lambda fails to send the
# native WhatsApp interactive list). Identical routing semantics — Lex
# resolves "Pregrado", "Posgrado", "1", "2", etc.
main_menu = action(
    "MessageParticipant",
    {
        "Text": (
            "¿En qué te podemos ayudar? 🎓\n"
            "Responde con el *número* o escribe tu consulta libre:\n\n"
            "1️⃣  Pregrado — carreras profesionales\n"
            "2️⃣  Posgrado — maestrías y doctorados\n"
            "3️⃣  Diplomados / PAD — educación ejecutiva\n"
            "4️⃣  Soy alumno — soporte académico\n"
            "5️⃣  Costos y becas\n"
            "6️⃣  Visitar el campus\n"
            "7️⃣  Hablar con un asesor"
        ),
    },
    {"NextAction": ID_MAIN_LEX, "Errors": [{"NextAction": ID_DISCONNECT_ERROR, "ErrorType": "NoMatchingError"}]},
    ident=ID_PLAIN_MENU_FALLBACK,
)
actions.append(main_menu)

# 8. Connect with Lex — define handler IDs first, then build the block
ID_HANDLER_CONSULTAR = nid()
ID_HANDLER_COSTOS = nid()
ID_HANDLER_VISITA = nid()
ID_HANDLER_ALUMNO = nid()
ID_HANDLER_ASESOR = nid()

main_lex = action(
    "ConnectParticipantWithLexBot",
    {
        # Connect requires a non-empty Text for the Lex block — we pass a
        # zero-width space so the user doesn't see "esperando" noise; the
        # actual prompt happened in the MessageParticipant above.
        "Text": "​",
        "LexV2Bot": {"AliasArn": LEX_ALIAS},
    },
    ident=ID_MAIN_LEX,
)
actions.append(main_lex)

# Connect with Lex (listens for both button-click and free text) transitions
main_lex["Transitions"] = {
    "NextAction": ID_FALLBACK_MSG,
    "Conditions": [
        {"NextAction": ID_HANDLER_CONSULTAR, "Condition": {"Operator": "Equals", "Operands": ["ConsultarPrograma"]}},
        {"NextAction": ID_HANDLER_COSTOS,    "Condition": {"Operator": "Equals", "Operands": ["SolicitarCostos"]}},
        {"NextAction": ID_HANDLER_VISITA,    "Condition": {"Operator": "Equals", "Operands": ["AgendarVisita"]}},
        {"NextAction": ID_HANDLER_ALUMNO,    "Condition": {"Operator": "Equals", "Operands": ["EstadoMatricula"]}},
        {"NextAction": ID_HANDLER_ASESOR,    "Condition": {"Operator": "Equals", "Operands": ["HablarConAsesor"]}},
    ],
    "Errors": [
        {"NextAction": ID_FALLBACK_MSG, "ErrorType": "NoMatchingCondition"},
        {"NextAction": ID_FALLBACK_MSG, "ErrorType": "NoMatchingError"},
    ],
}

# === Handler: ConsultarPrograma ===
# Inspect the slot 'nivel' to route to the right queue
# Set attribute udep_intent + udep_nivel + udep_facultad + udep_sede from Lex slots
set_consultar_attrs = action(
    "UpdateContactAttributes",
    {
        "Attributes": {
            "udep_intent": "consultar_programa",
            "udep_nivel": "$.Lex.Slots.nivel",
            "udep_facultad": "$.Lex.Slots.facultad",
            "udep_sede": "$.Lex.Slots.sede",
        },
        "TargetContact": "Current",
    },
    ident=ID_HANDLER_CONSULTAR,
)
actions.append(set_consultar_attrs)

# Branch by nivel slot value
nivel_cmp_id = nid()
set_consultar_attrs["Transitions"]["NextAction"] = nivel_cmp_id
set_consultar_attrs["Transitions"]["Errors"] = [{"NextAction": nivel_cmp_id, "ErrorType": "NoMatchingError"}]

nivel_cmp = action(
    "Compare",
    {"ComparisonValue": "$.Lex.Slots.nivel"},
    {
        "NextAction": ID_MAIN_MENU,  # if no slot, re-show menu
        "Conditions": [
            {"NextAction": ID_SET_Q_PREGRADO,   "Condition": {"Operator": "TextContains", "Operands": ["pregrado"]}},
            {"NextAction": ID_SET_Q_POSGRADO,   "Condition": {"Operator": "TextContains", "Operands": ["maestria"]}},
            {"NextAction": ID_SET_Q_POSGRADO,   "Condition": {"Operator": "TextContains", "Operands": ["doctorado"]}},
            {"NextAction": ID_SET_Q_POSGRADO,   "Condition": {"Operator": "TextContains", "Operands": ["posgrado"]}},
            {"NextAction": ID_SET_Q_DIPLOMADOS, "Condition": {"Operator": "TextContains", "Operands": ["diplomado"]}},
            {"NextAction": ID_SET_Q_DIPLOMADOS, "Condition": {"Operator": "TextContains", "Operands": ["pad"]}},
        ],
        "Errors": [{"NextAction": ID_SET_Q_PREGRADO, "ErrorType": "NoMatchingCondition"}],
    },
    ident=nivel_cmp_id,
)
actions.append(nivel_cmp)

# === Handler: SolicitarCostos — route by nivel slot if present, default to Pregrado ===
set_costos_attrs = action(
    "UpdateContactAttributes",
    {
        "Attributes": {
            "udep_intent": "solicitar_costos",
            "udep_nivel": "$.Lex.Slots.nivel",
            "udep_facultad": "$.Lex.Slots.facultad",
        },
        "TargetContact": "Current",
    },
    ident=ID_HANDLER_COSTOS,
)
actions.append(set_costos_attrs)
costos_cmp_id = nid()
set_costos_attrs["Transitions"]["NextAction"] = costos_cmp_id
set_costos_attrs["Transitions"]["Errors"] = [{"NextAction": costos_cmp_id, "ErrorType": "NoMatchingError"}]

costos_cmp = action(
    "Compare",
    {"ComparisonValue": "$.Lex.Slots.nivel"},
    {
        "NextAction": ID_SET_Q_PREGRADO,
        "Conditions": [
            {"NextAction": ID_SET_Q_POSGRADO,   "Condition": {"Operator": "TextContains", "Operands": ["maestria"]}},
            {"NextAction": ID_SET_Q_POSGRADO,   "Condition": {"Operator": "TextContains", "Operands": ["doctorado"]}},
            {"NextAction": ID_SET_Q_POSGRADO,   "Condition": {"Operator": "TextContains", "Operands": ["posgrado"]}},
            {"NextAction": ID_SET_Q_DIPLOMADOS, "Condition": {"Operator": "TextContains", "Operands": ["diplomado"]}},
        ],
        "Errors": [{"NextAction": ID_SET_Q_PREGRADO, "ErrorType": "NoMatchingCondition"}],
    },
    ident=costos_cmp_id,
)
actions.append(costos_cmp)

# === Handler: AgendarVisita → Pregrado ===
set_visita_attrs = action(
    "UpdateContactAttributes",
    {
        "Attributes": {
            "udep_intent": "agendar_visita",
            "udep_sede": "$.Lex.Slots.sede",
        },
        "TargetContact": "Current",
    },
    {"NextAction": ID_SET_Q_PREGRADO, "Errors": [{"NextAction": ID_SET_Q_PREGRADO, "ErrorType": "NoMatchingError"}]},
    ident=ID_HANDLER_VISITA,
)
actions.append(set_visita_attrs)

# === Handler: EstadoMatricula → Alumnos ===
set_alumno_attrs = action(
    "UpdateContactAttributes",
    {"Attributes": {"udep_intent": "soporte_alumno"}, "TargetContact": "Current"},
    {"NextAction": ID_SET_Q_ALUMNOS, "Errors": [{"NextAction": ID_SET_Q_ALUMNOS, "ErrorType": "NoMatchingError"}]},
    ident=ID_HANDLER_ALUMNO,
)
actions.append(set_alumno_attrs)

# === Handler: HablarConAsesor → Pregrado (default) ===
set_asesor_attrs = action(
    "UpdateContactAttributes",
    {"Attributes": {"udep_intent": "hablar_con_asesor"}, "TargetContact": "Current"},
    {"NextAction": ID_SET_Q_PREGRADO, "Errors": [{"NextAction": ID_SET_Q_PREGRADO, "ErrorType": "NoMatchingError"}]},
    ident=ID_HANDLER_ASESOR,
)
actions.append(set_asesor_attrs)

# === Queue setters ===
set_q_pre = action(
    "UpdateContactTargetQueue",
    {"QueueId": Q_PRE},
    {"NextAction": ID_MSG_TRANSFER, "Errors": [{"NextAction": ID_DISCONNECT_ERROR, "ErrorType": "NoMatchingError"}]},
    ident=ID_SET_Q_PREGRADO,
)
actions.append(set_q_pre)

set_q_pos = action(
    "UpdateContactTargetQueue",
    {"QueueId": Q_POS},
    {"NextAction": ID_MSG_TRANSFER, "Errors": [{"NextAction": ID_DISCONNECT_ERROR, "ErrorType": "NoMatchingError"}]},
    ident=ID_SET_Q_POSGRADO,
)
actions.append(set_q_pos)

set_q_dip = action(
    "UpdateContactTargetQueue",
    {"QueueId": Q_DIP},
    {"NextAction": ID_MSG_TRANSFER, "Errors": [{"NextAction": ID_DISCONNECT_ERROR, "ErrorType": "NoMatchingError"}]},
    ident=ID_SET_Q_DIPLOMADOS,
)
actions.append(set_q_dip)

set_q_alu = action(
    "UpdateContactTargetQueue",
    {"QueueId": Q_ALU},
    {"NextAction": ID_MSG_TRANSFER, "Errors": [{"NextAction": ID_DISCONNECT_ERROR, "ErrorType": "NoMatchingError"}]},
    ident=ID_SET_Q_ALUMNOS,
)
actions.append(set_q_alu)

# === Transfer message + set customer queue flow (via EventHooks) + transfer ===
msg_transfer = action(
    "MessageParticipant",
    {"Text": "¡Perfecto! Te estoy conectando con un asesor de la UDEP. Por favor espera unos segundos. 🎓"},
    ident=ID_MSG_TRANSFER,
)
actions.append(msg_transfer)
ID_SET_CQ = nid()
msg_transfer["Transitions"] = {"NextAction": ID_SET_CQ, "Errors": [{"NextAction": ID_SET_CQ, "ErrorType": "NoMatchingError"}]}

set_cq = action(
    "UpdateContactEventHooks",
    {"EventHooks": {"CustomerQueue": FLOW_CUSTOMER_QUEUE}},
    {"NextAction": ID_TRANSFER, "Errors": [{"NextAction": ID_TRANSFER, "ErrorType": "NoMatchingError"}]},
    ident=ID_SET_CQ,
)
actions.append(set_cq)

transfer = action(
    "TransferContactToQueue",
    {},
    {
        "NextAction": ID_DISCONNECT,
        "Errors": [
            {"NextAction": ID_DISCONNECT, "ErrorType": "QueueAtCapacity"},
            {"NextAction": ID_DISCONNECT, "ErrorType": "NoMatchingError"},
        ],
    },
    ident=ID_TRANSFER,
)
actions.append(transfer)

# === Fallback (Lex didn't understand) — re-send menu ===
fallback = action(
    "MessageParticipant",
    {"Text": "No te entendi del todo 😅. Te muestro nuevamente las opciones:"},
    {"NextAction": ID_MAIN_MENU, "Errors": [{"NextAction": ID_DISCONNECT, "ErrorType": "NoMatchingError"}]},
    ident=ID_FALLBACK_MSG,
)
actions.append(fallback)

# === Terminators ===
disc = action("DisconnectParticipant", {}, ident=ID_DISCONNECT)
actions.append(disc)
disc_err = action("DisconnectParticipant", {}, ident=ID_DISCONNECT_ERROR)
actions.append(disc_err)


# === Assemble flow ===
flow = {
    "Version": "2019-10-30",
    "StartAction": log["Identifier"],
    "Metadata": {
        "entryPointPosition": {"x": 40, "y": 40},
        "ActionMetadata": {a["Identifier"]: {"position": {"x": 0, "y": 0}} for a in actions},
        "Annotations": [],
        "name": "UDEP-Main-Inbound",
        "description": "WhatsApp/Chat router for UDEP — interactive menus + Lex NLU",
        "type": "contactFlow",
        "status": "PUBLISHED",
        "hash": {},
    },
    "Actions": actions,
}

with open("B:/Connectview/.scratch/udep/UDEP-Main-Inbound.json", "w", encoding="utf-8") as f:
    json.dump(flow, f, ensure_ascii=False, indent=2)

print(f"Built flow with {len(actions)} actions")
print(f"Start: {log['Identifier']}")
