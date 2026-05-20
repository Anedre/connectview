"""
Fix UDEP-Router bot: add single-word utterances so WhatsApp button
replies (which arrive at Lex as the button TITLE like "Pregrado",
"Posgrado", "Asesor", …) match the right intent.

The WhatsApp interactive list rows have IDs:
  pregrado · posgrado · diplomados · pad
  alumno · costos · visita · asesor
plus sub-menu IDs like preg_lima, preg_piura, preg_costos, preg_admision,
asesor_preg, asesor_pos, volver…

Each ID becomes a one-word reply to Lex when the user taps. We add
those as direct utterances on the relevant intent. We also add the
button TITLE strings as utterances since some WhatsApp/Connect setups
forward the title (not the id) — both bases covered.
"""
import boto3, json, sys, time

REGION = "us-east-1"
BOT_ID = "VKG6YJG4DO"
ALIAS_ID = "N1CUYQL5IK"
LOCALE = "es_US"
c = boto3.client("lexv2-models", region_name=REGION)


def find_intent(name: str) -> str:
    for it in c.list_intents(
        botId=BOT_ID, botVersion="DRAFT", localeId=LOCALE
    )["intentSummaries"]:
        if it["intentName"] == name:
            return it["intentId"]
    raise RuntimeError(f"intent not found: {name}")


def add_utterances(intent_name: str, new_utts: list[str]):
    """Merge new utterances into the existing list (de-dupe) and patch
    the intent via update_intent. Lex requires the FULL intent payload
    on update_intent (no partial PATCH), so we describe → merge → push."""
    iid = find_intent(intent_name)
    it = c.describe_intent(
        botId=BOT_ID, botVersion="DRAFT", localeId=LOCALE, intentId=iid
    )
    existing = {u["utterance"] for u in it.get("sampleUtterances", [])}
    merged = list(existing)
    added = 0
    for u in new_utts:
        if u not in existing:
            merged.append(u)
            added += 1

    body = {
        "intentId": iid,
        "intentName": it["intentName"],
        "botId": BOT_ID,
        "botVersion": "DRAFT",
        "localeId": LOCALE,
        "sampleUtterances": [{"utterance": u} for u in merged],
    }
    # Preserve optional fields the API expects on update
    for k in [
        "description",
        "parentIntentSignature",
        "dialogCodeHook",
        "fulfillmentCodeHook",
        "intentConfirmationSetting",
        "intentClosingSetting",
        "inputContexts",
        "outputContexts",
        "kendraConfiguration",
        "slotPriorities",
        "initialResponseSetting",
        "qnAIntentConfiguration",
    ]:
        if it.get(k):
            body[k] = it[k]
    c.update_intent(**body)
    print(f"[ok] {intent_name:25s} +{added} utterances (total {len(merged)})")


# ─── Per-intent utterance additions ────────────────────────────────
# IDs + Titles from udep_send_whatsapp_interactive.py — covers both
# the lowercase id and the capitalized title variants.
add_utterances(
    "ConsultarPrograma",
    [
        "pregrado", "Pregrado",
        "posgrado", "Posgrado",
        "diplomados", "Diplomados",
        "diplomado",
        "pad", "PAD",
        "{nivel}",  # one-slot utterance — any nivel value matches
        # WhatsApp sub-menu IDs after picking a nivel
        "preg_lima", "preg_piura",
        "preg_costos", "preg_admision",
        "Sede Lima", "Sede Piura",
        "Costos pensiones", "Proceso de admision",
    ],
)

add_utterances(
    "SolicitarCostos",
    [
        "costos", "Costos",
        "costos y becas", "Costos y becas",
        "becas",
        "pensiones",
    ],
)

add_utterances(
    "AgendarVisita",
    [
        "visita", "Visita",
        "visitar campus", "Visitar campus",
        "tour",
    ],
)

add_utterances(
    "EstadoMatricula",
    [
        "alumno", "Alumno",
        "soy alumno", "Soy alumno",
        "estudiante",
        # NB: "matricula" is already on SolicitarCostos — Lex requires
        # globally-unique utterances, so we don't dupe it here. The
        # other utterances on this intent (alumno, estudiante) cover
        # the realistic user inputs.
    ],
)

add_utterances(
    "HablarConAsesor",
    [
        "asesor", "Asesor",
        "hablar con asesor", "Hablar con asesor",
        "asesor_preg", "asesor_pos", "asesor_dip", "asesor_pad",
        "atencion personalizada",
        "humano",
        "operador",
    ],
)


# ─── Build + version + alias ───────────────────────────────────────
print("\n[build] starting locale build")
c.build_bot_locale(botId=BOT_ID, botVersion="DRAFT", localeId=LOCALE)
for _ in range(40):
    s = c.describe_bot_locale(
        botId=BOT_ID, botVersion="DRAFT", localeId=LOCALE
    )["botLocaleStatus"]
    print(f"  {s}")
    if s in ("Built", "ReadyExpressTesting"):
        break
    if s in ("Failed", "NotBuilt"):
        print("build failed"); sys.exit(1)
    time.sleep(6)

print("\n[version] creating new bot version")
new_v = c.create_bot_version(
    botId=BOT_ID,
    botVersionLocaleSpecification={LOCALE: {"sourceBotVersion": "DRAFT"}},
)["botVersion"]
print(f"  v{new_v}")

# Wait until v becomes Available (poll list_bot_versions)
for _ in range(30):
    for v in c.list_bot_versions(botId=BOT_ID)["botVersionSummaries"]:
        if v["botVersion"] == new_v and v.get("botStatus") == "Available":
            break
    else:
        time.sleep(4); continue
    break
print(f"  v{new_v} is Available")

print(f"\n[alias] PROD → v{new_v}")
existing = c.describe_bot_alias(botId=BOT_ID, botAliasId=ALIAS_ID)
c.update_bot_alias(
    botAliasId=ALIAS_ID,
    botAliasName=existing["botAliasName"],
    botVersion=new_v,
    botAliasLocaleSettings=existing.get("botAliasLocaleSettings", {}),
    sentimentAnalysisSettings=existing.get(
        "sentimentAnalysisSettings", {"detectSentiment": False}
    ),
    botId=BOT_ID,
)
print(f"[done] Bot v{new_v} live on PROD alias — try WhatsApp again")
