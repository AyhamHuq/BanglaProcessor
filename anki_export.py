import io
import hashlib
import tempfile
import genanki
import httpx


def _generate_id(name: str, prefix: str = "") -> int:
    hash_input = f"{prefix}{name}".encode()
    return int(hashlib.md5(hash_input).hexdigest()[:8], 16)


def _create_note_model(deck_name: str) -> genanki.Model:
    model_id = _generate_id(deck_name, "model_")

    return genanki.Model(
        model_id,
        f"Bangla Vocab - {deck_name}",
        fields=[
            {"name": "Word"},
            {"name": "Translation"},
            {"name": "Sentence"},
            {"name": "Example"},
            {"name": "ExampleTranslation"},
            {"name": "POS"},
            {"name": "Root"},
            {"name": "Zipf"},
        ],
        templates=[
            {
                "name": "Card 1",
                "qfmt": """
<div style="text-align: center; font-family: 'Noto Sans Bengali', sans-serif;">
    <div style="font-size: 48px; margin: 40px 0;">{{Word}}</div>
</div>
""",
                "afmt": """
<div style="text-align: center; font-family: 'Noto Sans Bengali', sans-serif;">
    <div style="font-size: 48px; margin: 20px 0;">{{Word}}</div>
    <hr>
    <div style="font-size: 24px; color: #2563eb; margin: 15px 0;">{{Translation}}</div>
    <div style="font-size: 14px; color: #666; margin: 10px 0;">
        <b>POS:</b> {{POS}} | <b>Root:</b> {{Root}} | <b>Zipf:</b> {{Zipf}}
    </div>
    <div style="margin: 20px 0; padding: 15px; background: #f3f4f6; border-radius: 8px;">
        <div style="font-size: 18px;">{{Sentence}}</div>
    </div>
    <div style="margin: 20px 0; padding: 15px; background: #fef3c7; border-radius: 8px;">
        <div style="font-size: 16px;">{{Example}}</div>
        <div style="font-size: 14px; color: #666; margin-top: 8px;">{{ExampleTranslation}}</div>
    </div>
</div>
""",
            }
        ],
        css="""
.card {
    font-family: 'Noto Sans Bengali', Arial, sans-serif;
    background-color: #ffffff;
    color: #1f2937;
}
"""
    )


def create_deck(cards: list, deck_name: str) -> bytes:
    deck_id = _generate_id(deck_name, "deck_")
    deck = genanki.Deck(deck_id, deck_name)
    model = _create_note_model(deck_name)

    for card in cards:
        note = genanki.Note(
            model=model,
            fields=[
                card.get("text", ""),
                card.get("translation", ""),
                card.get("sentence", ""),
                card.get("example", ""),
                card.get("example_translation", ""),
                card.get("pos", ""),
                card.get("root", ""),
                str(card.get("zipf", 0)),
            ]
        )
        deck.add_note(note)

    package = genanki.Package(deck)

    with tempfile.NamedTemporaryFile(suffix=".apkg", delete=False) as tmp:
        package.write_to_file(tmp.name)
        tmp.seek(0)
        with open(tmp.name, "rb") as f:
            return f.read()


def push_to_anki_connect(cards: list, deck_name: str, anki_url: str) -> dict:
    try:
        create_deck_payload = {
            "action": "createDeck",
            "version": 6,
            "params": {"deck": deck_name}
        }
        httpx.post(anki_url, json=create_deck_payload, timeout=10.0)

        notes = []
        for card in cards:
            notes.append({
                "deckName": deck_name,
                "modelName": "Basic",
                "fields": {
                    "Front": f"""<div style="font-size: 36px; font-family: 'Noto Sans Bengali';">{card.get('text', '')}</div>""",
                    "Back": f"""
<div style="font-family: 'Noto Sans Bengali';">
    <div style="font-size: 24px; color: #2563eb;">{card.get('translation', '')}</div>
    <hr>
    <div><b>POS:</b> {card.get('pos', '')} | <b>Root:</b> {card.get('root', '')}</div>
    <div style="margin-top: 10px;"><b>Sentence:</b> {card.get('sentence', '')}</div>
    <div style="margin-top: 10px;"><b>Example:</b> {card.get('example', '')}</div>
    <div style="color: #666;">{card.get('example_translation', '')}</div>
</div>
"""
                },
                "options": {"allowDuplicate": False},
                "tags": ["bangla-processor"]
            })

        add_notes_payload = {
            "action": "addNotes",
            "version": 6,
            "params": {"notes": notes}
        }

        response = httpx.post(anki_url, json=add_notes_payload, timeout=30.0)
        response.raise_for_status()
        result = response.json()

        if result.get("error"):
            return {"success": False, "error": result["error"]}

        added_count = sum(1 for r in result.get("result", []) if r is not None)
        return {
            "success": True,
            "added": added_count,
            "total": len(cards)
        }

    except httpx.HTTPStatusError as e:
        return {"success": False, "error": f"HTTP error: {e.response.status_code}"}
    except httpx.ConnectError:
        return {"success": False, "error": "Cannot connect to AnkiConnect. Is Anki running?"}
    except Exception as e:
        return {"success": False, "error": str(e)}
