# Bangla Reading Assistant

A local web app for accelerating Bangla vocabulary acquisition through contextual reading and Anki flashcard generation.

## Features

- Paste Prothom Alo articles and read with vocabulary assistance
- Rare words (Zipf score < 3.0) are subtly underlined
- Click any word for instant Gemini-powered translation
- Add words to Anki with rich context (sentence, example, POS, root)
- Export to .apkg or push directly via AnkiConnect
- Dark mode UI with Noto Sans Bengali

## Setup

```bash
pip install -r requirements.txt
```

## Usage

1. Start the server:
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

2. Open http://localhost:8000

3. Click the gear icon to set your Gemini API key (get one free at [Google AI Studio](https://aistudio.google.com))

4. Paste a Bangla article and click "Read Article"

5. Click words to see translations, add to queue, or ignore

6. Export your cards when ready

## Requirements

- Python 3.10+
- Gemini API key (free tier works)
- Anki with AnkiConnect add-on (code: 2055492159) for direct push
