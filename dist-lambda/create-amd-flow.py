"""Create a new contact flow `Connectview-Campaign-AMD` that is a copy of
SBS-Novasys-Dialer with a CheckOutboundCallStatus block at the start
to filter voicemails / no-answer calls before the agent is engaged.
SBS-Novasys-Dialer itself is not modified.
"""
import json
import subprocess
import sys
import uuid

INSTANCE_ID = "2345d564-4bd4-4318-9cf0-75649bad5197"
SBS_FLOW_ID = "82a34ded-1b7e-46d3-ad1a-ab40ef9b39b9"

# Fetch the SBS flow as the base
r = subprocess.run(
    [
        "aws", "connect", "describe-contact-flow",
        "--instance-id", INSTANCE_ID,
        "--contact-flow-id", SBS_FLOW_ID,
        "--region", "us-east-1",
        "--output", "json",
        "--query", "ContactFlow.Content",
    ],
    capture_output=True, text=True,
)
if r.returncode != 0:
    print("fetch failed:", r.stderr); sys.exit(1)

flow = json.loads(json.loads(r.stdout.strip()))

# Existing blocks we're chaining around
UPDATE_DATA_BLOCK = "54a7ea50-2f11-4eca-a8ac-dd81a3195cc4"
TARGET_QUEUE_BLOCK = "0cfb37f9-e522-4f74-ad06-1c0bc8ef527a"
DISCONNECT_BLOCK = "fc5f01d5-56d2-4c2b-a132-9b7feb6ee4ad"

# Build the CheckOutboundCallStatus block
amd_id = str(uuid.uuid4())
amd_block = {
    "Identifier": amd_id,
    "Type": "CheckOutboundCallStatus",
    "Parameters": {},
    "Transitions": {
        "NextAction": DISCONNECT_BLOCK,  # default: not a human → disconnect
        "Conditions": [
            {
                "NextAction": TARGET_QUEUE_BLOCK,
                "Condition": {
                    "Operator": "Equals",
                    "Operands": ["CallAnswered"],
                },
            },
            {
                "NextAction": DISCONNECT_BLOCK,
                "Condition": {
                    "Operator": "Equals",
                    "Operands": ["VoicemailBeep"],
                },
            },
            {
                "NextAction": DISCONNECT_BLOCK,
                "Condition": {
                    "Operator": "Equals",
                    "Operands": ["VoicemailNoBeep"],
                },
            },
            {
                "NextAction": DISCONNECT_BLOCK,
                "Condition": {
                    "Operator": "Equals",
                    "Operands": ["NotDetected"],
                },
            },
        ],
        "Errors": [
            {"NextAction": DISCONNECT_BLOCK, "ErrorType": "NoMatchingError"},
        ],
    },
}

# Rewire UpdateContactData -> AMD check -> (CallAnswered: TargetQueue | else: Disconnect)
for a in flow["Actions"]:
    if a["Identifier"] == UPDATE_DATA_BLOCK:
        a["Transitions"]["NextAction"] = amd_id
        break

flow["Actions"].append(amd_block)

meta = flow.setdefault("Metadata", {}).setdefault("ActionMetadata", {})
meta[amd_id] = {"position": {"x": 100, "y": -50}}

content = json.dumps(flow, separators=(",", ":"))
with open("B:/Connectview/dist-lambda/amd-flow-content.json", "w") as f:
    f.write(content)

# Create as a NEW flow (not an update)
r = subprocess.run(
    [
        "aws", "connect", "create-contact-flow",
        "--instance-id", INSTANCE_ID,
        "--name", "Connectview-Campaign-AMD",
        "--type", "CONTACT_FLOW",
        "--description",
        "Outbound campaign flow with Answer Machine Detection - filters voicemails/no-answer before agent receives",
        "--content", "file://B:/Connectview/dist-lambda/amd-flow-content.json",
        "--region", "us-east-1",
    ],
    capture_output=True, text=True,
)
print("stdout:", r.stdout)
print("stderr:", r.stderr)
if r.returncode != 0:
    sys.exit(1)
