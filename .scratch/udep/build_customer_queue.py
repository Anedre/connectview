"""Build UDEP-Customer-Queue using the canonical default-queue pattern."""
import json, uuid

start_id = str(uuid.uuid4())
flow = {
    "Version": "2019-10-30",
    "StartAction": start_id,
    "Metadata": {
        "entryPointPosition": {"x": 40, "y": 40},
        "ActionMetadata": {start_id: {"position": {"x": 200, "y": 200}}},
    },
    "Actions": [
        {
            "Identifier": start_id,
            "Parameters": {
                "Messages": [
                    {"Text": "Gracias por escribir a la Universidad de Piura. Tu consulta es importante; un asesor te atendera en breve."},
                    {"Text": "Gracias por tu paciencia. Estamos asignando un asesor disponible."},
                    {"Text": "Pronto un asesor te atendera."},
                ],
            },
            "Transitions": {"Errors": [], "Conditions": []},
            "Type": "MessageParticipantIteratively",
        }
    ],
}

with open("B:/Connectview/.scratch/udep/UDEP-Customer-Queue.json", "w", encoding="utf-8") as f:
    json.dump(flow, f, ensure_ascii=False, indent=2)
print("Built customer-queue flow")
