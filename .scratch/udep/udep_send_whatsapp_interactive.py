"""
UDEP-Send-WhatsApp-Interactive Lambda (v2 — multi-menu)

Sends a WhatsApp Interactive message (List or Buttons) to the customer
via AWS End User Messaging Social.

Driven by the `udep_menu_key` contact attribute, which the contact flow
sets before invoking this Lambda. Each key maps to a different menu
template (main / pregrado / posgrado / maestrias / costos_pregrado /
costos_posgrado / proceso_admision).

Output ($.External.<key>):
    sent       "true" | "false"
    messageId  Meta message ID (when sent=true)
    error      Exception class name on failure
    menuKey    The menu that was rendered (for downstream branching)
"""
import json
import os
import boto3

PHONE_NUMBER_ID = os.environ["WHATSAPP_PHONE_NUMBER_ID"]
META_API_VERSION = os.environ.get("META_API_VERSION", "v20.0")

social = boto3.client("socialmessaging")


# ─── Menu builders ───────────────────────────────────────────────

def _main_menu(to: str, first_name: str) -> dict:
    body = "¿En que te podemos ayudar?"
    if first_name and first_name.strip():
        body = f"Hola {first_name.strip()}, ¿en que te podemos ayudar?"
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "list",
            "header": {"type": "text", "text": "Universidad de Piura"},
            "body": {"text": body},
            "footer": {"text": "Toca una opcion o escribe libremente"},
            "action": {
                "button": "Ver opciones",
                "sections": [
                    {
                        "title": "🎓 Oferta academica",
                        "rows": [
                            {"id": "pregrado", "title": "🎓 Pregrado",   "description": "Carreras profesionales"},
                            {"id": "posgrado", "title": "📚 Posgrado",   "description": "Maestrias y doctorados"},
                            {"id": "diplomados","title": "🎯 Diplomados","description": "Educacion ejecutiva"},
                            {"id": "pad",      "title": "💼 PAD",        "description": "Escuela de Direccion"},
                        ],
                    },
                    {
                        "title": "🤝 Atencion",
                        "rows": [
                            {"id": "alumno", "title": "👤 Soy alumno",       "description": "Soporte academico"},
                            {"id": "costos", "title": "💰 Costos y becas",   "description": "Pensiones y financiamiento"},
                            {"id": "visita", "title": "📅 Visitar campus",   "description": "Agendar tour"},
                            {"id": "asesor", "title": "🙋 Hablar con asesor","description": "Atencion personalizada"},
                        ],
                    },
                ],
            },
        },
    }


def _pregrado_menu(to: str, first_name: str) -> dict:
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "list",
            "header": {"type": "text", "text": "Pregrado UDEP"},
            "body": {"text": "Selecciona la informacion que te interesa:"},
            "footer": {"text": "Toca una opcion"},
            "action": {
                "button": "Ver opciones",
                "sections": [
                    {
                        "title": "🎓 Conoce la oferta",
                        "rows": [
                            {"id": "preg_lima",     "title": "🏙️ Sede Lima",       "description": "Carreras disponibles en Lima"},
                            {"id": "preg_piura",    "title": "🌴 Sede Piura",      "description": "Carreras + Medicina en Piura"},
                            {"id": "preg_costos",   "title": "💰 Costos / pensiones","description": "Escalas y financiamiento"},
                            {"id": "preg_admision", "title": "📝 Proceso admision","description": "Pasos, fechas y requisitos"},
                        ],
                    },
                    {
                        "title": "➡️ Siguiente paso",
                        "rows": [
                            {"id": "asesor_preg", "title": "🙋 Hablar con asesor","description": "Atencion personalizada"},
                            {"id": "volver",      "title": "🔙 Volver al menu",   "description": "Volver al menu principal"},
                        ],
                    },
                ],
            },
        },
    }


def _posgrado_menu(to: str, first_name: str) -> dict:
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "list",
            "header": {"type": "text", "text": "Posgrado UDEP"},
            "body": {"text": "Te interesa Posgrado. ¿Que area?"},
            "footer": {"text": "Toca una opcion"},
            "action": {
                "button": "Ver opciones",
                "sections": [
                    {
                        "title": "📚 Programas",
                        "rows": [
                            {"id": "post_maestrias", "title": "🎓 Maestrias",       "description": "Derecho, Educacion, Ing, etc."},
                            {"id": "post_doctorado", "title": "🧠 Doctorados",      "description": "Programas de doctorado UDEP"},
                            {"id": "post_pad",       "title": "💼 PAD / MBA",        "description": "Escuela de Direccion"},
                            {"id": "post_costos",    "title": "💰 Costos / becas",   "description": "Pensiones y financiamiento"},
                        ],
                    },
                    {
                        "title": "➡️ Siguiente paso",
                        "rows": [
                            {"id": "asesor_post", "title": "🙋 Hablar con asesor","description": "Atencion personalizada"},
                            {"id": "volver",      "title": "🔙 Volver al menu",   "description": "Volver al menu principal"},
                        ],
                    },
                ],
            },
        },
    }


def _maestrias_menu(to: str, first_name: str) -> dict:
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "list",
            "header": {"type": "text", "text": "Maestrias UDEP"},
            "body": {"text": "¿Sobre que area de maestria te interesa info?"},
            "footer": {"text": "Toca una opcion"},
            "action": {
                "button": "Ver maestrias",
                "sections": [
                    {
                        "title": "🎓 Por area",
                        "rows": [
                            {"id": "mae_derecho",    "title": "⚖️ Derecho",          "description": "M. en Derecho de la Empresa, etc."},
                            {"id": "mae_educacion",  "title": "🍎 Educacion",        "description": "M. en Educacion / Direccion"},
                            {"id": "mae_comunicacion","title": "🎬 Comunicacion",    "description": "M. en Comunicacion"},
                            {"id": "mae_ingenieria", "title": "🔧 Ingenieria",       "description": "M. en Ing. Industrial / Sistemas"},
                            {"id": "mae_admin",      "title": "📊 Administracion",   "description": "M. en Admin / MBA executive"},
                        ],
                    },
                    {
                        "title": "➡️ Siguiente paso",
                        "rows": [
                            {"id": "asesor_mae", "title": "🙋 Hablar con asesor","description": "Atencion personalizada"},
                            {"id": "volver",     "title": "🔙 Volver",           "description": "Volver al menu de posgrado"},
                        ],
                    },
                ],
            },
        },
    }


MENU_BUILDERS = {
    "main":      _main_menu,
    "pregrado":  _pregrado_menu,
    "posgrado":  _posgrado_menu,
    "maestrias": _maestrias_menu,
}


def lambda_handler(event, _ctx):
    cd = event.get("Details", {}).get("ContactData", {}) or {}
    endpoint = cd.get("CustomerEndpoint") or {}
    to_raw = endpoint.get("Address", "") or ""
    to = to_raw.strip()
    if not to:
        return {"sent": "false", "error": "MissingCustomerAddress"}
    if not to.startswith("+"):
        to = "+" + to

    attrs = cd.get("Attributes") or {}
    first_name = attrs.get("udep_first_name") or ""

    # Flow can pass the desired menu via the Parameters block of the
    # InvokeLambdaFunction action — Connect injects those into event
    # `Details.Parameters`. Falls back to udep_menu_key attribute, then
    # to "main".
    params = event.get("Details", {}).get("Parameters", {}) or {}
    menu_key = (
        (params.get("menu") or "").lower()
        or (attrs.get("udep_menu_key") or "").lower()
        or "main"
    )

    builder = MENU_BUILDERS.get(menu_key)
    if not builder:
        return {"sent": "false", "error": f"UnknownMenu:{menu_key}"}

    payload = builder(to, first_name)

    try:
        r = social.send_whatsapp_message(
            originationPhoneNumberId=PHONE_NUMBER_ID,
            message=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            metaApiVersion=META_API_VERSION,
        )
        return {
            "sent": "true",
            "menuKey": menu_key,
            "messageId": r.get("messageId", ""),
        }
    except Exception as e:
        return {
            "sent": "false",
            "menuKey": menu_key,
            "error": type(e).__name__,
            "errorMsg": str(e)[:200],
        }
