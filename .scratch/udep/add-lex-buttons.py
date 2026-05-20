"""
Add interactive button response cards (imageResponseCard) to UDEP-Router
Lex V2 bot slots so WhatsApp/chat shows tappable buttons instead of
asking the user to type.

Flow:
  1. Update slot prompts on draft with response cards
  2. Build the DRAFT locale
  3. Create a new bot version
  4. Update the PROD alias to point to the new version

After this the bot's "¿Qué nivel?" question becomes a button list,
and WhatsApp renders it as a native interactive message.
"""
import boto3
import json
import sys
import time

REGION = "us-east-1"
BOT_ID = "VKG6YJG4DO"
ALIAS_ID = "N1CUYQL5IK"   # PROD
LOCALE = "es_US"

c = boto3.client("lexv2-models", region_name=REGION)


def find_intent(name: str) -> str:
    for it in c.list_intents(
        botId=BOT_ID, botVersion="DRAFT", localeId=LOCALE
    )["intentSummaries"]:
        if it["intentName"] == name:
            return it["intentId"]
    raise RuntimeError(f"intent not found: {name}")


def find_slot(intent_id: str, name: str) -> str:
    for s in c.list_slots(
        botId=BOT_ID, botVersion="DRAFT", localeId=LOCALE, intentId=intent_id
    )["slotSummaries"]:
        if s["slotName"] == name:
            return s["slotId"]
    raise RuntimeError(f"slot not found: {name}")


def build_prompt_spec(title: str, subtitle: str, buttons: list[tuple[str, str]]):
    """Build a promptSpecification with an imageResponseCard. Lex
    falls back to plain text automatically on channels that don't
    support cards (it strips buttons and sends `title + subtitle`).
    NB: messageGroup messages must all be the same type — Lex rejects
    mixing imageResponseCard with plainTextMessage in the same group."""
    return {
        "messageGroups": [
            {
                "message": {
                    "imageResponseCard": {
                        "title": title,
                        "subtitle": subtitle,
                        "buttons": [
                            {"text": text, "value": value}
                            for text, value in buttons
                        ],
                    }
                },
            }
        ],
        "maxRetries": 2,
        "allowInterrupt": True,
        "messageSelectionStrategy": "Ordered",
        "promptAttemptsSpecification": {
            "Initial": {
                "allowInterrupt": True,
                "allowedInputTypes": {
                    "allowAudioInput": True,
                    "allowDTMFInput": True,
                },
                "audioAndDTMFInputSpecification": {
                    "startTimeoutMs": 4000,
                    "audioSpecification": {
                        "maxLengthMs": 15000,
                        "endTimeoutMs": 640,
                    },
                    "dtmfSpecification": {
                        "maxLength": 513,
                        "endTimeoutMs": 5000,
                        "deletionCharacter": "*",
                        "endCharacter": "#",
                    },
                },
                "textInputSpecification": {"startTimeoutMs": 30000},
            }
        },
    }


def update_slot_prompt(intent_id: str, slot_id: str, prompt_spec: dict):
    """Update an existing slot's prompt without resetting the rest of
    its config (slot type, capture setting, etc)."""
    current = c.describe_slot(
        botId=BOT_ID,
        botVersion="DRAFT",
        localeId=LOCALE,
        intentId=intent_id,
        slotId=slot_id,
    )
    new_elicit = current.get("valueElicitationSetting", {})
    new_elicit["promptSpecification"] = prompt_spec
    # Strip read-only fields the API doesn't accept on update.
    body = {
        "slotId": slot_id,
        "slotName": current["slotName"],
        "slotTypeId": current["slotTypeId"],
        "valueElicitationSetting": new_elicit,
        "botId": BOT_ID,
        "botVersion": "DRAFT",
        "localeId": LOCALE,
        "intentId": intent_id,
    }
    # Carry forward optional bits when present
    if current.get("description"):
        body["description"] = current["description"]
    if current.get("multipleValuesSetting"):
        body["multipleValuesSetting"] = current["multipleValuesSetting"]
    if current.get("obfuscationSetting"):
        body["obfuscationSetting"] = current["obfuscationSetting"]
    if current.get("subSlotSetting"):
        body["subSlotSetting"] = current["subSlotSetting"]
    c.update_slot(**body)


# ─── 1. Update ConsultarPrograma.nivel ──────────────────────────────
intent_id = find_intent("ConsultarPrograma")
slot_id = find_slot(intent_id, "nivel")
update_slot_prompt(
    intent_id,
    slot_id,
    build_prompt_spec(
        title="¿Qué nivel académico te interesa?",
        subtitle="Toca una opción",
        buttons=[
            ("🎓 Pregrado", "pregrado"),
            ("📚 Posgrado", "posgrado"),
            ("🎯 Diplomado", "diplomado"),
            ("💼 PAD / MBA", "pad"),
        ],
    ),
)
print("[ok] ConsultarPrograma.nivel  ← 4 botones")

# ─── 2. Update ConsultarPrograma.sede ───────────────────────────────
slot_id = find_slot(intent_id, "sede")
update_slot_prompt(
    intent_id,
    slot_id,
    build_prompt_spec(
        title="¿En qué sede?",
        subtitle="Lima o Piura",
        buttons=[
            ("📍 Lima (Miraflores)", "lima"),
            ("📍 Piura (Mugica)", "piura"),
            ("Cualquiera", "ambas"),
        ],
    ),
)
print("[ok] ConsultarPrograma.sede   ← 3 botones")

# ─── 3. Update AgendarVisita (1 slot — likely sede) ─────────────────
try:
    visit_intent = find_intent("AgendarVisita")
    visit_slot = find_slot(visit_intent, "sede")
    update_slot_prompt(
        visit_intent,
        visit_slot,
        build_prompt_spec(
            title="¿Qué campus quieres visitar?",
            subtitle="Coordinaremos fecha y hora",
            buttons=[
                ("📍 Lima", "lima"),
                ("📍 Piura", "piura"),
            ],
        ),
    )
    print("[ok] AgendarVisita.sede       ← 2 botones")
except Exception as e:
    print(f"[skip] AgendarVisita.sede — {e}")

# ─── 4. Update SolicitarCostos.nivel (if present) ───────────────────
try:
    cost_intent = find_intent("SolicitarCostos")
    cost_slot = find_slot(cost_intent, "nivel")
    update_slot_prompt(
        cost_intent,
        cost_slot,
        build_prompt_spec(
            title="¿Costos de qué nivel?",
            subtitle="Para enviarte los rangos correctos",
            buttons=[
                ("🎓 Pregrado", "pregrado"),
                ("📚 Posgrado", "posgrado"),
                ("🎯 Diplomado", "diplomado"),
                ("💼 PAD / MBA", "pad"),
            ],
        ),
    )
    print("[ok] SolicitarCostos.nivel    ← 4 botones")
except Exception as e:
    print(f"[skip] SolicitarCostos.nivel — {e}")


# ─── 5. Build the DRAFT locale ──────────────────────────────────────
print("\n[build] starting locale build for", LOCALE)
c.build_bot_locale(botId=BOT_ID, botVersion="DRAFT", localeId=LOCALE)
# Poll until done
deadline = time.time() + 180
while time.time() < deadline:
    status = c.describe_bot_locale(
        botId=BOT_ID, botVersion="DRAFT", localeId=LOCALE
    )["botLocaleStatus"]
    print(f"  status: {status}")
    if status in ("Built", "ReadyExpressTesting"):
        break
    if status in ("Failed", "NotBuilt"):
        print("  build failed")
        sys.exit(1)
    time.sleep(8)
else:
    print("  timeout waiting for build")
    sys.exit(1)

# ─── 6. Create a new bot version ────────────────────────────────────
print("\n[version] creating new bot version from DRAFT")
new_ver = c.create_bot_version(
    botId=BOT_ID,
    botVersionLocaleSpecification={
        LOCALE: {"sourceBotVersion": "DRAFT"}
    },
)
new_version = new_ver["botVersion"]
print(f"  new version: {new_version}")

# Wait until the version is ready
deadline = time.time() + 120
while time.time() < deadline:
    info = c.describe_bot_version(botId=BOT_ID, botVersion=new_version)
    status = info.get("botStatus")
    print(f"  version status: {status}")
    if status == "Available":
        break
    if status == "Failed":
        print("  version failed")
        sys.exit(1)
    time.sleep(5)

# ─── 7. Point PROD alias to the new version ─────────────────────────
print("\n[alias] updating PROD alias →", new_version)
existing_alias = c.describe_bot_alias(botId=BOT_ID, botAliasId=ALIAS_ID)
c.update_bot_alias(
    botAliasId=ALIAS_ID,
    botAliasName=existing_alias["botAliasName"],
    botVersion=new_version,
    botAliasLocaleSettings=existing_alias.get("botAliasLocaleSettings", {}),
    sentimentAnalysisSettings=existing_alias.get(
        "sentimentAnalysisSettings", {"detectSentiment": False}
    ),
    botId=BOT_ID,
)
print(f"[done] Bot v{new_version} live on PROD alias")
