import os
import json
import time
import httpx
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent"


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

    prompt = f"Translate this Bangla word/phrase to concise English (1-3 words). Bangladeshi dialect context. Reply with ONLY the translation, nothing else. Word: {text}"

    try:
        return _call_gemini(prompt, api_key)
    except httpx.HTTPStatusError as e:
        return {"error": f"API error: {e.response.status_code}"}
    except Exception as e:
        return {"error": str(e)}


def enrich_word(text: str, sentence: str, zipf: float, api_key: str = None) -> dict:
    if not api_key:
        api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        return {"error": "No API key provided"}

    prompt = f"""Analyze this Bangla word and return JSON only:
Word: {text}
Sentence: {sentence}
Zipf: {zipf}

Return this exact JSON structure:
{{"text":"{text}","type":"word or phrase","translation":"English","root":"Bangla root or same","pos":"noun/verb/adj/etc","sentence":"{sentence}","example":"another Bangla example sentence","example_translation":"English translation of example","zipf":{zipf}}}"""

    try:
        result = _call_gemini(prompt, api_key)
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:]
        if result.startswith("```"):
            result = result[3:]
        if result.endswith("```"):
            result = result[:-3]
        return json.loads(result.strip())
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
    except httpx.HTTPStatusError as e:
        return {"error": f"API error: {e.response.status_code}"}
    except Exception as e:
        return {"error": str(e)}
