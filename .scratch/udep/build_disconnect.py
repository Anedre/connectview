"""Build UDEP-Disconnect flow (NPS survey + close)."""
import json, uuid

def nid():
    return str(uuid.uuid4())

def action(typ, params, transitions=None, ident=None):
    return {
        "Identifier": ident or nid(),
        "Type": typ,
        "Parameters": params,
        "Transitions": transitions or {},
    }


actions = []
ID_DISCONNECT = nid()
ID_THANKS = nid()

# Just a polite thank-you and disconnect. NPS via WhatsApp template is heavy and best
# done via a separate post-call WhatsApp HSM, not in-flow.
log = action("UpdateFlowLoggingBehavior", {"FlowLoggingBehavior": "Enabled"})
actions.append(log)

thanks = action(
    "MessageParticipant",
    {"Text": "Gracias por contactar a la Universidad de Piura. Si necesitas algo mas, escribenos de nuevo. ¡Que tengas un excelente dia! 🎓"},
    {"NextAction": ID_DISCONNECT, "Errors": [{"NextAction": ID_DISCONNECT, "ErrorType": "NoMatchingError"}]},
    ident=ID_THANKS,
)
actions.append(thanks)
log["Transitions"]["NextAction"] = ID_THANKS

disc = action("DisconnectParticipant", {}, ident=ID_DISCONNECT)
actions.append(disc)

flow = {
    "Version": "2019-10-30",
    "StartAction": log["Identifier"],
    "Metadata": {
        "entryPointPosition": {"x": 40, "y": 40},
        "ActionMetadata": {a["Identifier"]: {"position": {"x": 0, "y": 0}} for a in actions},
        "Annotations": [],
        "name": "UDEP-Disconnect",
        "description": "UDEP — chat closure with thank-you message",
        "type": "contactFlow",
        "status": "PUBLISHED",
        "hash": {},
    },
    "Actions": actions,
}

with open("B:/Connectview/.scratch/udep/UDEP-Disconnect.json", "w", encoding="utf-8") as f:
    json.dump(flow, f, ensure_ascii=False, indent=2)

print(f"Built disconnect flow with {len(actions)} actions")
