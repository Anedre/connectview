"""
Sprinkle more emojis throughout UDEP-Main-Inbound contact flow.

Touches every MessageParticipant block to make the WhatsApp experience
feel more conversational and friendly. Keeps the actual content intact —
just adds emojis around key phrases and lists.
"""
import boto3, json
client = boto3.client("connect", region_name="us-east-1")
INSTANCE = "2345d564-4bd4-4318-9cf0-75649bad5197"
FLOW_ID = "fbbce86d-5892-4fc3-baa6-2b5e1219e4e9"


# Map of action identifier → new Text. Identifiers come from the
# describe_contact_flow dump done earlier.
NEW_TEXTS = {
    # ─── After-hours ─────────────────────────────────────────────
    "270e19db-e3d9-4bff-8ed3-85ad64daa59e": (
        "🌙 ¡Gracias por escribir a la *Universidad de Piura*! 🎓\n\n"
        "🕘 Nuestro horario de atención es:\n"
        "• L-V de 8:00 a 20:00 ⏰\n"
        "• Sábados de 9:00 a 13:00 📅\n\n"
        "✍️ Escríbenos en ese horario y un asesor te atenderá personalmente.\n"
        "¡Hasta pronto! 👋💙"
    ),

    # ─── Welcome ────────────────────────────────────────────────
    "70a4601e-982d-4468-8523-7cce43054a67": (
        "👋 ¡Hola $.Attributes.udep_first_name! 🎉\n\n"
        "🎓 Bienvenido(a) a la *Universidad de Piura* 💙\n\n"
        "🤖 Soy tu asistente virtual y estoy aquí para ayudarte con "
        "información académica sobre pregrado, posgrado, diplomados y "
        "más. 📚✨\n\n"
        "👇 Toca una opción del menú o escríbeme lo que necesitas."
    ),

    # ─── Fallback ───────────────────────────────────────────────
    "f9b153bd-766c-4ee8-89e6-3808f99bab65": (
        "🤔 Mmm, no te entendí del todo 😅\n\n"
        "👇 Te muestro las opciones de nuevo para que toques la que "
        "te interese:"
    ),

    # ─── Pregrado ───────────────────────────────────────────────
    "1379c5c5-5f4d-407b-9826-152079f1e038": (
        "🎓 *Pregrado UDEP* — 21 carreras en 7 facultades ✨\n\n"
        "*📍 Campus Piura* (Av. Ramón Mugica 131) 🌴\n"
        "🏛️ Arquitectura · 5 años\n"
        "📊 Administración de Empresas\n"
        "💼 Contabilidad y Auditoría\n"
        "📈 Economía\n"
        "⚖️ Derecho\n"
        "🍎 Ciencias de la Educación · Inicial / Primaria / Lengua / Matemática\n"
        "📚 Historia y Gestión Cultural\n"
        "🎬 Comunicación Audiovisual · Marketing · Periodismo\n"
        "🔧 Ingeniería Civil · Industrial y Sistemas · Mecánico-Eléctrica\n"
        "🩺 Medicina Humana · 7 años (sólo Piura)\n\n"
        "*📍 Campus Lima* (Calle Mártir Olaya 162, Miraflores) 🏙️\n"
        "📊 Administración de Empresas · Servicios\n"
        "⚖️ Derecho · 📈 Economía\n"
        "📚 Historia y Gestión Cultural\n"
        "🔧 Ingeniería en Gobierno de Organizaciones\n\n"
        "🗓️ *Admisión*: 2 procesos al año (enero y julio)\n"
        "💰 *Escalas*: definidas por evaluación socioeconómica\n"
        "🎁 *Becas* y financiamiento disponibles\n\n"
        "🤝 Te paso con un asesor de Pregrado para tu programa específico 👇"
    ),

    # ─── Sede Lima detail ───────────────────────────────────────
    "ae6a2cb0-ec6c-47a3-aca8-e7020863893d": (
        "🏛️ *Sede Lima (Miraflores)* 🌆\n\n"
        "🎓 Carreras disponibles:\n"
        "⚖️ Derecho · 🔧 Ingeniería · 🎬 Comunicación\n"
        "📈 Economía · 📊 Administración · 💼 Contabilidad\n"
        "🍎 Educación · 📚 Humanidades\n\n"
        "📍 Dirección: Calle Mártir Olaya 162, Miraflores 📌\n"
        "🚌 Cerca de la Vía Expresa\n\n"
        "🤝 Te paso con un asesor para más detalles 💙"
    ),

    # ─── Posgrado ───────────────────────────────────────────────
    "06db6c2e-e62a-45cb-9c37-713cbb1bba22": (
        "📚 *Posgrado UDEP* — ¡Lleva tu carrera al siguiente nivel! 🚀\n\n"
        "*🎯 Maestrías*:\n"
        "🍎 *Educación* — Gestión Educativa, Psicopedagogía, Teorías Educativas\n"
        "⚖️ *Derecho* — Empresarial, Administrativo, Público\n"
        "📊 *Economía / Empresariales* — Dirección Comercial, Gestión del Talento, "
        "Dirección Financiera, Control de Gestión\n"
        "🎬 *Comunicación* — Comunicación Estratégica de Organizaciones\n"
        "🎨 *Gestión Cultural*\n\n"
        "🎓 *Doctorados*: ⚖️ Derecho · 🍎 Educación · 🧠 Filosofía\n\n"
        "📍 *Sedes*: Lima 🏙️ y Piura 🌴\n"
        "📅 *Modalidad*: presencial / semipresencial\n\n"
        "🤝 Te paso con un asesor de Posgrado para el programa que te interesa 💙"
    ),

    # ─── Diplomados ─────────────────────────────────────────────
    "98e629e2-e295-4a7e-9ac1-cd03650ec627": (
        "🎯 *Diplomados / Educación Ejecutiva UDEP* ⚡\n\n"
        "📆 Programas de 3 a 6 meses · 💻 modalidad presencial / online\n\n"
        "🏢 *Gestión Empresarial* · 👥 Recursos Humanos\n"
        "⚖️ *Compliance* y Gobierno Corporativo\n"
        "📱 *Marketing Digital* · 📊 Project Management\n"
        "🍎 *Liderazgo Educativo* (vía Facultad de Educación)\n"
        "🌐 Y muchos más — Derecho corporativo, Comunicación estratégica…\n\n"
        "✨ Algunos diplomados son escalables a maestría 🎓\n\n"
        "🤝 Te paso con un asesor para calendario y costos 💙"
    ),

    # ─── PAD ────────────────────────────────────────────────────
    "65fa7799-6647-4499-8eda-524ff499ed0c": (
        "💼 *PAD — Escuela de Dirección UDEP* 🏆\n\n"
        "🥇 La escuela de negocios de la UDEP, para alta dirección.\n\n"
        "🚀 *Programas master*:\n"
        "🎯 *MBA Part Time* — para gerentes en ejercicio\n"
        "🌴 *EMBA Piura* — Executive MBA en Piura\n"
        "📊 *MEDEX* — Maestría en Dirección de Empresas para Ejecutivos\n"
        "🏛️ *MGO* — Maestría en Gobierno de las Organizaciones\n"
        "💰 *MDC* — Maestría en Dirección Comercial\n\n"
        "📍 *Sedes*: 🏙️ Lima (sede PAD) · 🌴 Piura\n"
        "🔗 *Web*: https://pad.edu/\n\n"
        "🤝 Te paso con un asesor del PAD para iniciar tu proceso 💙"
    ),

    # ─── Soporte alumnos ───────────────────────────────────────
    "d8455e32-3c5a-4312-a26c-35f9c13bdf63": (
        "👤 *Soporte para alumnos UDEP* 🎒\n\n"
        "🤝 Te paso con el equipo de Soporte Académico para ayudarte con:\n\n"
        "🔐 Acceso al SIGA / Plataforma Virtual\n"
        "📝 Matrícula · reincorporación · cambios\n"
        "💳 Pago de pensiones · 📬 Reclamos\n"
        "📚 Notas · sílabos · horarios\n\n"
        "🆔 Por favor, ten a la mano tu *código de estudiante* 👍"
    ),

    # ─── Visita campus ─────────────────────────────────────────
    "c8e2460f-051d-4e21-96b8-b16f9e0863c4": (
        "📅 *Visita el campus UDEP* 🏛️\n\n"
        "🚶‍♀️ Podemos agendar una visita guiada al campus de tu interés:\n\n"
        "🏙️ *Lima*: Calle Mártir Olaya 162, Miraflores 📍\n"
        "🌴 *Piura*: Av. Ramón Mugica 131, San Eduardo 📍\n\n"
        "🤝 Te paso con un asesor para coordinar fecha y hora 📆"
    ),

    # ─── Costos ────────────────────────────────────────────────
    "7ac38f17-fe4d-43af-a360-0be0af343643": (
        "💰 *Costos UDEP* 💳\n\n"
        "💵 Los costos varían según:\n"
        "🎓 *Nivel* (Pregrado / Posgrado / Diplomado / PAD)\n"
        "📍 *Sede* (Lima 🏙️ / Piura 🌴)\n"
        "📊 *Escala* (pregrado) — definida por evaluación socioeconómica\n\n"
        "🎁 Ofrecemos *becas* y *financiamiento* 💙\n"
        "✨ También planes corporativos para empresas 🏢\n\n"
        "🤝 Te paso con un asesor para darte los costos específicos 👇"
    ),

    # ─── Connecting to advisor ─────────────────────────────────
    "0089b6fb-e876-4c6f-94fc-d66358a8a8d6": (
        "🎉 ¡Perfecto! 🚀\n\n"
        "🤝 Te estoy conectando con un asesor de la *UDEP* 🎓\n"
        "⏳ Por favor espera unos segundos…\n\n"
        "💙 ¡Gracias por tu paciencia! 🙌"
    ),
}


# Fetch + patch + push
res = client.describe_contact_flow(InstanceId=INSTANCE, ContactFlowId=FLOW_ID)
flow = json.loads(res["ContactFlow"]["Content"])
print(f"[load] {len(flow['Actions'])} actions")

updated = 0
for a in flow["Actions"]:
    if a["Identifier"] in NEW_TEXTS:
        a["Parameters"]["Text"] = NEW_TEXTS[a["Identifier"]]
        updated += 1
print(f"[edit] updated {updated} of {len(NEW_TEXTS)} target blocks")

client.update_contact_flow_content(
    InstanceId=INSTANCE,
    ContactFlowId=FLOW_ID,
    Content=json.dumps(flow, ensure_ascii=False),
)
print("[done] flow pushed — try WhatsApp now 🚀")
