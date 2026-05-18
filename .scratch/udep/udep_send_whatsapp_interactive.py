"""
UDEP-Send-WhatsApp-Interactive Lambda

Sends a native WhatsApp Interactive List Message to the customer using
AWS End User Messaging Social (which talks to Meta's WhatsApp Cloud API).

Why this exists:
  Amazon Connect's MessageParticipant block does NOT auto-translate the
  Connect interactive content-type to Meta's WhatsApp interactive payload
  when the channel uses AWS Social Messaging. So we bypass it and call
  the Social Messaging service directly with Meta's native format.

The customer's button click flows back through Meta -> Social Messaging
-> Connect chat session as a regular CUSTOMER message. The downstream
ConnectParticipantWithLexBot picks it up and routes by intent + slot.

Input (Connect "Invoke AWS Lambda function" block):
    {
      "Details": {
        "ContactData": {
          "CustomerEndpoint": {"Address": "+51..."},
          "Attributes": {"udep_first_name": "Andre", ...}
        }
      }
    }

Output ($.External.<key>):
    sent       "true" or "false"
    messageId  Meta message ID (when sent=true)
    error      Exception class name on failure
"""
import json
import os
import boto3

PHONE_NUMBER_ID = os.environ["WHATSAPP_PHONE_NUMBER_ID"]
META_API_VERSION = os.environ.get("META_API_VERSION", "v20.0")

social = boto3.client("socialmessaging")


def _build_main_menu(to: str, first_name: str) -> dict:
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
                        "title": "Oferta academica",
                        "rows": [
                            {"id": "opt_pregrado",   "title": "Pregrado",     "description": "Carreras profesionales"},
                            {"id": "opt_posgrado",   "title": "Posgrado",     "description": "Maestrias y doctorados"},
                            {"id": "opt_diplomados", "title": "Diplomados",   "description": "Educacion ejecutiva"},
                            {"id": "opt_pad",        "title": "PAD",          "description": "Escuela de Direccion"},
                        ],
                    },
                    {
                        "title": "Otras opciones",
                        "rows": [
                            {"id": "opt_alumno", "title": "Soy alumno",       "description": "Soporte academico"},
                            {"id": "opt_costos", "title": "Costos y becas",   "description": "Pensiones y financiamiento"},
                            {"id": "opt_visita", "title": "Visitar campus",   "description": "Agendar tour"},
                            {"id": "opt_asesor", "title": "Hablar con asesor","description": "Atencion personalizada"},
                        ],
                    },
                ],
            },
        },
    }


def lambda_handler(event, _ctx):
    cd = event.get("Details", {}).get("ContactData", {}) or {}
    endpoint = cd.get("CustomerEndpoint") or {}
    to_raw = endpoint.get("Address", "") or ""
    to = to_raw.strip()
    # Meta accepts either "+51..." or "51..." — preserve the leading '+'
    # to keep the input strictly E.164. The SocialMessaging proxy passes
    # the value through to Meta verbatim.
    if not to:
        return {"sent": "false", "error": "MissingCustomerAddress"}
    if not to.startswith("+"):
        to = "+" + to

    attrs = cd.get("Attributes") or {}
    first_name = attrs.get("udep_first_name") or ""

    payload = _build_main_menu(to, first_name)

    try:
        r = social.send_whatsapp_message(
            originationPhoneNumberId=PHONE_NUMBER_ID,
            message=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            metaApiVersion=META_API_VERSION,
        )
        return {
            "sent": "true",
            "messageId": r.get("messageId", ""),
        }
    except Exception as e:
        return {
            "sent": "false",
            "error": type(e).__name__,
            "errorMsg": str(e)[:200],
        }
