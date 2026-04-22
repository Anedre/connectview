import json
d = json.load(open("B:/Connectview/dist-lambda/smoke5.json"))
if d.get("statusCode") != 200:
    print("ERROR status", d.get("statusCode"))
    print(d.get("body", "")[:400])
else:
    b = json.loads(d["body"])
    print(f"{'user':18s}  {'queues':30s}  qForMe  done  errors")
    for a in b.get("agents", []):
        s = a.get("stats") or {}
        qs = ",".join(q["name"] for q in (a.get("queues") or []))[:28]
        print(
            f"{a['username'][:18]:18s}  {qs:30s}  "
            f"{s.get('queuedForMe', 0):4d}   {s.get('completedToday', 0):3d}   {s.get('errorsToday', 0):3d}"
        )
