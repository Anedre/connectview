"""Enable Contact Lens Real-time analytics on the SBS-Novasys-Dialer flow
by adding AnalyticsBehavior to the existing UpdateContactRecordingBehavior block.
"""
import json
import subprocess
import sys

INSTANCE_ID = "2345d564-4bd4-4318-9cf0-75649bad5197"
FLOW_ID = "82a34ded-1b7e-46d3-ad1a-ab40ef9b39b9"
RECORDING_BLOCK_ID = "141aadde-3f11-47bb-9543-1b33d616534a"

# Load the current content we already saved
with open("B:/Connectview/dist-lambda/sbs-flow.txt") as f:
    raw = f.read().strip()
content = json.loads(raw)  # outer JSON string -> Python string
flow = json.loads(content)  # inner JSON -> flow dict

# Find and mutate the recording block
updated = False
for action in flow.get("Actions", []):
    if action["Identifier"] == RECORDING_BLOCK_ID:
        params = action.setdefault("Parameters", {})
        params["AnalyticsBehavior"] = {
            "Enabled": "True",
            "AnalyticsLanguage": "es-US",
            "AnalyticsRedactionBehavior": "Disabled",
            "AnalyticsRedactionResults": "None",
            "ChannelConfiguration": {
                "Chat": {"AnalyticsModes": []},
                "Voice": {"AnalyticsModes": ["RealTime"]}
            }
        }
        updated = True
        print(f"Updated block {RECORDING_BLOCK_ID}:")
        print(json.dumps(params, indent=2))
        break

if not updated:
    print(f"ERROR: block {RECORDING_BLOCK_ID} not found", file=sys.stderr)
    sys.exit(1)

# Re-serialize: Connect expects the Content as a JSON string
new_content = json.dumps(flow, separators=(",", ":"))

# Save locally so we can pass as file to CLI
with open("B:/Connectview/dist-lambda/sbs-flow-new.json", "w") as f:
    f.write(new_content)

print(f"\nNew content size: {len(new_content)} bytes")
print("Calling UpdateContactFlowContent...")

result = subprocess.run(
    [
        "aws", "connect", "update-contact-flow-content",
        "--instance-id", INSTANCE_ID,
        "--contact-flow-id", FLOW_ID,
        "--content", "file://B:/Connectview/dist-lambda/sbs-flow-new.json",
        "--region", "us-east-1"
    ],
    capture_output=True, text=True
)
print("stdout:", result.stdout)
print("stderr:", result.stderr)
if result.returncode == 0:
    print("OK — flow updated with Contact Lens Real-time analytics")
else:
    print("FAILED", file=sys.stderr)
    sys.exit(1)
