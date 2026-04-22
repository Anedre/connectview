"""Add a 'Play prompt' block to the SBS-Novasys-Dialer flow so the agent
only gets the contact AFTER the customer has answered (Connect cannot
play audio to a ringing phone).

Flow change:
  Start → ... → UpdateContactTargetQueue → MessageParticipant (new!) → Set Main Agent View → TransferContactToQueue
"""
import json
import subprocess
import sys
import uuid

INSTANCE_ID = "2345d564-4bd4-4318-9cf0-75649bad5197"
FLOW_ID = "82a34ded-1b7e-46d3-ad1a-ab40ef9b39b9"

# Existing block IDs we care about
SET_QUEUE_BLOCK = "0cfb37f9-e522-4f74-ad06-1c0bc8ef527a"  # UpdateContactTargetQueue (BasicQueue)
# The existing message participant block (53fc1bf7) already plays something,
# but we'll add an explicit "wait for customer" prompt right after SetQueue.
# We chain: SetQueue -> NEW PlayPrompt -> (existing chain continues)

# Load current flow
with open("B:/Connectview/dist-lambda/sbs-verify.txt") as f:
    raw = f.read().strip()
flow = json.loads(json.loads(raw))

# Find the SetQueue block's current NextAction so we can chain after our new block
set_queue = None
for a in flow["Actions"]:
    if a["Identifier"] == SET_QUEUE_BLOCK:
        set_queue = a
        break
if not set_queue:
    print(f"ERROR: SetQueue block {SET_QUEUE_BLOCK} not found")
    sys.exit(1)

old_next = set_queue["Transitions"]["NextAction"]
print(f"Current chain: SetQueue -> {old_next[:12]}...")

# Create the new MessageParticipant (Play prompt) block.
# Type: MessageParticipant with TextToSpeech parameters.
new_block_id = str(uuid.uuid4())
new_block = {
    "Identifier": new_block_id,
    "Type": "MessageParticipant",
    "Parameters": {
        "Text": "Hola, un momento por favor, lo conectamos con un asesor.",
        "TextToSpeechType": "text"
    },
    "Transitions": {
        "NextAction": old_next,
        "Errors": [
            {"NextAction": old_next, "ErrorType": "NoMatchingError"}
        ]
    }
}

# Rewire SetQueue to point to our new block
set_queue["Transitions"]["NextAction"] = new_block_id
flow["Actions"].append(new_block)

# Also register in ActionMetadata so the visual editor doesn't freak out
meta = flow.setdefault("Metadata", {}).setdefault("ActionMetadata", {})
meta[new_block_id] = {
    "position": {"x": 370, "y": 45.6},
    "isFriendlyName": True,
    "parameters": {
        "Text": {
            "displayName": "Wait for customer prompt"
        }
    }
}

# Re-serialize
new_content = json.dumps(flow, separators=(",", ":"))
with open("B:/Connectview/dist-lambda/sbs-flow-prompt.json", "w") as f:
    f.write(new_content)

print(f"\nNew block id: {new_block_id}")
print(f"New content size: {len(new_content)} bytes")
print("Calling UpdateContactFlowContent...")

result = subprocess.run(
    [
        "aws", "connect", "update-contact-flow-content",
        "--instance-id", INSTANCE_ID,
        "--contact-flow-id", FLOW_ID,
        "--content", "file://B:/Connectview/dist-lambda/sbs-flow-prompt.json",
        "--region", "us-east-1"
    ],
    capture_output=True, text=True
)
print("stdout:", result.stdout)
print("stderr:", result.stderr)
if result.returncode == 0:
    print("OK - Play prompt added. Agent will now only receive calls after customer answers.")
else:
    print("FAILED", file=sys.stderr)
    sys.exit(1)
