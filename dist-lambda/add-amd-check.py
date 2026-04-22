"""Add a CheckOutboundCallStatus block to SBS-Novasys-Dialer to filter out
voicemail / no-answer calls before the agent is connected.

Chain before:
  Start -> Logging -> Recording(+Lens) -> TTSVoice -> UpdateContactData
    -> UpdateContactTargetQueue -> MessageParticipant -> ... -> Transfer -> Disconnect

Chain after:
  Start -> Logging -> Recording -> TTSVoice -> UpdateContactData
    -> [NEW] CheckOutboundCallStatus
           |-- CallAnswered -----> UpdateContactTargetQueue (existing flow continues)
           \\-- default/other --> DisconnectParticipant (existing leaf)
"""
import json
import subprocess
import sys
import uuid

INSTANCE_ID = "2345d564-4bd4-4318-9cf0-75649bad5197"
FLOW_ID = "82a34ded-1b7e-46d3-ad1a-ab40ef9b39b9"

UPDATE_DATA_BLOCK = "54a7ea50-2f11-4eca-a8ac-dd81a3195cc4"   # UpdateContactData (currently points to TargetQueue)
TARGET_QUEUE_BLOCK = "0cfb37f9-e522-4f74-ad06-1c0bc8ef527a"  # UpdateContactTargetQueue
DISCONNECT_BLOCK = "fc5f01d5-56d2-4c2b-a132-9b7feb6ee4ad"     # DisconnectParticipant (existing leaf)

# Load CURRENT state (not the stale saved one)
import os
if os.path.exists("B:/Connectview/dist-lambda/sbs-current.txt"):
    with open("B:/Connectview/dist-lambda/sbs-current.txt") as f:
        raw = f.read().strip()
else:
    raise SystemExit("run describe-contact-flow first to populate sbs-current.txt")

flow = json.loads(json.loads(raw))

# Find the UpdateContactData block so we can re-wire its Next
update_data = next(
    (a for a in flow["Actions"] if a["Identifier"] == UPDATE_DATA_BLOCK), None
)
if not update_data:
    print(f"ERROR: UpdateData block {UPDATE_DATA_BLOCK} not found")
    sys.exit(1)

# Build the CheckOutboundCallStatus block — structure mirrors the reference
# flow (A-Outbound-Campaign-With-Contact-Attributes). Only Equals conditions,
# only NoMatchingError in Errors.
amd_id = str(uuid.uuid4())
amd_block = {
    "Identifier": amd_id,
    "Type": "CheckOutboundCallStatus",
    "Parameters": {},
    "Transitions": {
        # Default (any status not matched by a condition) → disconnect
        "NextAction": DISCONNECT_BLOCK,
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
            {
                "NextAction": DISCONNECT_BLOCK,
                "ErrorType": "NoMatchingError",
            },
        ],
    },
}

# Rewire UpdateContactData → our new AMD check (instead of TargetQueue)
update_data["Transitions"]["NextAction"] = amd_id

# Append our new block
flow["Actions"].append(amd_block)

# Register minimal metadata — Connect rejects richer attributes for this type
meta = flow.setdefault("Metadata", {}).setdefault("ActionMetadata", {})
meta[amd_id] = {"position": {"x": 100, "y": -50}}

# Re-serialize and push
new_content = json.dumps(flow, separators=(",", ":"))
with open("B:/Connectview/dist-lambda/sbs-flow-amd.json", "w") as f:
    f.write(new_content)

print(f"New AMD block id: {amd_id}")
print("Updating flow...")

result = subprocess.run(
    [
        "aws", "connect", "update-contact-flow-content",
        "--instance-id", INSTANCE_ID,
        "--contact-flow-id", FLOW_ID,
        "--content", "file://B:/Connectview/dist-lambda/sbs-flow-amd.json",
        "--region", "us-east-1",
    ],
    capture_output=True, text=True
)
print("stdout:", result.stdout)
print("stderr:", result.stderr)
if result.returncode == 0:
    print("OK - Flow now filters voicemails. Agent only sees real humans.")
else:
    print("FAILED", file=sys.stderr)
    sys.exit(1)
