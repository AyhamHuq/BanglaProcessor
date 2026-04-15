import os
import json
import time
import hashlib
from pathlib import Path
import httpx
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent"

# Server-side persistent cache
CACHE_DIR = Path(__file__).parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)
TRANSLATION_CACHE_FILE = CACHE_DIR / "translations.json"
ENRICHMENT_CACHE_FILE = CACHE_DIR / "enrichments.json"


def _load_cache(cache_file: Path) -> dict:
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text(encoding='utf-8'))
        except:
            return {}
    return {}


def _save_cache(cache_file: Path, cache: dict):
    cache_file.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')


def _get_cache_key(text: str) -> str:
    return hashlib.md5(text.encode('utf-8')).hexdigest()[:16]


def _call_gemini(prompt: str, api_key: str, max_retries: int = 3) -> str:
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}]
    }

    for attempt in range(max_retries):
        try:
            response = httpx.post(
                f"{GEMINI_API_URL}?key={api_key}",
                headers=headers,
                json=payload,
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) + 1
                    time.sleep(wait_time)
                    continue
                raise Exception("API quota exceeded. Please wait or check your API key's billing.")
            raise
    raise Exception("Max retries exceeded")


def translate_word(text: str, api_key: str = None) -> str:
    if not api_key:
        api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        return {"error": "No API key provided"}

    # Check server-side cache first
    cache = _load_cache(TRANSLATION_CACHE_FILE)
    cache_key = _get_cache_key(text)
    if cache_key in cache:
        return cache[cache_key]

    # Shorter prompt = fewer tokens
    prompt = f"Bangla to English (1-3 words only): {text}"

    try:
        result = _call_gemini(prompt, api_key)
        # Cache the result server-side
        cache[cache_key] = result
        _save_cache(TRANSLATION_CACHE_FILE, cache)
        return result
    except Exception as e:
        return {"error": str(e)}


def enrich_word(text: str, sentence: str, zipf: float, api_key: str = None) -> dict:
    if not api_key:
        api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        return {"error": "No API key provided"}

    # Check server-side cache first
    cache = _load_cache(ENRICHMENT_CACHE_FILE)
    cache_key = _get_cache_key(text)
    if cache_key in cache:
        cached = cache[cache_key]
        # Update sentence/zipf from current context but reuse expensive AI data
        cached["sentence"] = sentence
        cached["zipf"] = zipf
        return cached

    # Shorter, more direct prompt
    prompt = f'Bangla "{text}" in "{sentence[:50]}": JSON only {{"translation":"eng","root":"root","pos":"noun/verb/adj","example":"bangla sentence","example_translation":"eng"}}'

    try:
        result = _call_gemini(prompt, api_key)
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:]
        if result.startswith("```"):
            result = result[3:]
        if result.endswith("```"):
            result = result[:-3]

        parsed = json.loads(result.strip())
        # Add the fields we already know
        parsed["text"] = text
        parsed["type"] = "phrase" if " " in text else "word"
        parsed["sentence"] = sentence
        parsed["zipf"] = zipf

        # Cache server-side
        cache[cache_key] = parsed
        _save_cache(ENRICHMENT_CACHE_FILE, cache)

        return parsed
    except json.JSONDecodeError:
        return {
            "text": text,
            "type": "word",
            "translation": "",
            "root": text,
            "pos": "unknown",
            "sentence": sentence,
            "example": "",
            "example_translation": "",
            "zipf": zipf,
            "error": "Failed to parse response"
        }
    except Exception as e:
        return {"error": str(e)}
