"""
UDEP-Lookup-Lead Lambda

Called by the UDEP-Main-Inbound contact flow at the start of every chat to
classify the inbound contact's lead type and pre-populate first name /
program interest. This lets the flow personalize the welcome and skip
straight to a relevant queue for warm leads.

Input (from Amazon Connect "Invoke AWS Lambda function" block):
    {
      "Details": {
        "ContactData": {
          "CustomerEndpoint": {"Address": "+51..."},  # WhatsApp E.164
          ...
        }
      }
    }

Output (consumed via $.External.<key> in the flow):
    leadType   one of: returning_student | hot_lead | new | unknown
    firstName  string  (empty when unknown)
    programa   string  (program of interest from CP attrs, may be empty)
    studentId  string  (from CP attrs if linked to UDEP SIGA)
"""
import json
import os
import time
import boto3

DOMAIN = os.environ.get("CP_DOMAIN", "amazon-connect-novasys")
HOT_LEAD_DAYS = int(os.environ.get("HOT_LEAD_DAYS", "7"))

profiles = boto3.client("customer-profiles")


def _normalize_phone(raw: str) -> str:
    if not raw:
        return ""
    return "".join(ch for ch in raw if ch.isdigit() or ch == "+")


def lambda_handler(event, _ctx):
    try:
        cd = event.get("Details", {}).get("ContactData", {})
        endpoint = cd.get("CustomerEndpoint") or {}
        phone = _normalize_phone(endpoint.get("Address", ""))
        if not phone:
            return {
                "leadType": "unknown",
                "firstName": "",
                "programa": "",
                "studentId": "",
            }

        # Try search by phone in CP
        res = profiles.search_profiles(
            DomainName=DOMAIN,
            KeyName="_phone",
            Values=[phone],
        )
        items = res.get("Items", [])
        if not items:
            # Also try without the leading +
            if phone.startswith("+"):
                res = profiles.search_profiles(
                    DomainName=DOMAIN,
                    KeyName="_phone",
                    Values=[phone[1:]],
                )
                items = res.get("Items", [])

        if not items:
            return {
                "leadType": "new",
                "firstName": "",
                "programa": "",
                "studentId": "",
            }

        p = items[0]
        attrs = p.get("Attributes") or {}
        first_name = p.get("FirstName") or attrs.get("firstName", "") or ""
        programa = attrs.get("udep_programa_interes") or attrs.get("programa", "") or ""
        student_id = attrs.get("udep_student_id") or attrs.get("studentId", "") or ""

        # Decide lead type
        lead_type = "new"
        if student_id:
            lead_type = "returning_student"
        else:
            # If the profile was created/touched in the last N days and has
            # a programa attribute, treat as hot lead
            last_update = p.get("LastUpdatedAt")
            if programa and last_update:
                try:
                    ts = last_update.timestamp() if hasattr(last_update, "timestamp") else 0
                    if ts and (time.time() - ts) < HOT_LEAD_DAYS * 86400:
                        lead_type = "hot_lead"
                except Exception:
                    pass

        return {
            "leadType": lead_type,
            "firstName": first_name,
            "programa": programa,
            "studentId": student_id,
        }
    except Exception as e:
        # Never fail the flow — return safe defaults
        return {
            "leadType": "unknown",
            "firstName": "",
            "programa": "",
            "studentId": "",
            "error": type(e).__name__,
        }
