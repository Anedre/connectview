"""Revert the CheckOutboundCallStatus addition from SBS-Novasys-Dialer.
Removes the AMD block and re-wires UpdateContactData back to UpdateContactTargetQueue.
"""
import json
import subprocess
import sys

INSTANCE_ID = "2345d564-4bd4-4318-9cf0-75649bad5197"
FLOW_ID = "82a34ded-1b7e-46d3-ad1a-ab40ef9b39b9"
UPDATE_DATA_BLOCK = "54a7ea50-2f11-4eca-a8ac-dd81a3195cc4"
TARGET_QUEUE_BLOCK = "0cfb37f9-e522-4f74-ad06-1c0bc8ef527a"

# Fetch the CURRENT flow (post-modification)
print("Fetching current flow...")
result = subprocess.run(
    [
        "aws", "connect", "describe-contact-flow",
        "--instance-id", INSTANCE_ID,
        "--contact-flow-id", FLOW_ID,
        "--region", "us-east-1",
        "--output", "json",
        "--query", "ContactFlow.Content",
    ],
    capture_output=True, text=True
)
if result.returncode != 0:
    print("FAILED to fetch:", result.stderr)
    sys.exit(1)

flow = json.loads(json.loads(result.stdout.strip()))

# Remove any CheckOutboundCallStatus blocks we added
before = len(flow["Actions"])
removed_ids = {
    a["Identifier"] for a in flow["Actions"]
    if a["Type"] == "CheckOutboundCallStatus"
}
flow["Actions"] = [
    a for a in flow["Actions"]
    if a["Identifier"] not in removed_ids
]
after = len(flow["Actions"])
print(f"Removed {before - after} CheckOutboundCallStatus blocks: {removed_ids}")

# Rewire UpdateContactData back to TargetQueue
for a in flow["Actions"]:
    if a["Identifier"] == UPDATE_DATA_BLOCK:
        a["Transitions"]["NextAction"] = TARGET_QUEUE_BLOCK
        print(f"Rewired {UPDATE_DATA_BLOCK} -> {TARGET_QUEUE_BLOCK}")
        break

# Clean up metadata entries for removed blocks
meta = flow.get("Metadata", {}).get("ActionMetadata", {})
for rid in removed_ids:
    meta.pop(rid, None)

# Save + push
new_content = json.dumps(flow, separators=(",", ":"))
with open("B:/Connectview/dist-lambda/sbs-reverted.json", "w") as f:
    f.write(new_content)

print("Updating flow to revert...")
r = subprocess.run(
    [
        "aws", "connect", "update-contact-flow-content",
        "--instance-id", INSTANCE_ID,
        "--contact-flow-id", FLOW_ID,
        "--content", "file://B:/Connectview/dist-lambda/sbs-reverted.json",
        "--region", "us-east-1",
    ],
    capture_output=True, text=True
)
print("stdout:", r.stdout)
print("stderr:", r.stderr)
if r.returncode == 0:
    print("OK - Flow reverted to pre-AMD state")
else:
    print("FAILED", file=sys.stderr)
    sys.exit(1)
