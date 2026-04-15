from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
import os

from tokenizer import tokenize_article
from enricher import translate_word, translate_batch, enrich_word
from anki_export import create_deck, push_to_anki_connect

app = FastAPI(title="Bangla Reading Assistant")

static_path = os.path.join(os.path.dirname(__file__), "static")
templates_path = os.path.join(os.path.dirname(__file__), "templates")

if os.path.exists(static_path):
    app.mount("/static", StaticFiles(directory=static_path), name="static")

templates = Jinja2Templates(directory=templates_path)


class ProcessArticleRequest(BaseModel):
    text: str


class TranslateRequest(BaseModel):
    text: str
    api_key: str


class TranslateBatchRequest(BaseModel):
    words: list[str]
    api_key: str


class EnrichRequest(BaseModel):
    text: str
    sentence: str
    zipf: float
    api_key: str


class ExportApkgRequest(BaseModel):
    cards: list
    deck_name: str


class ExportAnkiConnectRequest(BaseModel):
    cards: list
    deck_name: str
    anki_url: str


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/process-article")
async def process_article(req: ProcessArticleRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    result = tokenize_article(req.text)

    html_parts = []
    for token in result["tokens"]:
        css_class = "word-span word-rare" if token["is_rare"] else "word-span"
        html_parts.append(
            f'<span class="{css_class}" data-word="{token["word"]}" data-zipf="{token["zipf"]}" data-is-rare="{str(token["is_rare"]).lower()}">{token["word"]}</span>'
        )

    result["html"] = " ".join(html_parts)
    return result


@app.post("/api/translate")
async def translate(req: TranslateRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
    if not req.api_key:
        raise HTTPException(status_code=400, detail="API key is required")

    result = translate_word(req.text, req.api_key)

    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return {"translation": result}


@app.post("/api/translate-batch")
async def translate_batch_endpoint(req: TranslateBatchRequest):
    if not req.words:
        raise HTTPException(status_code=400, detail="Words list is required")
    if not req.api_key:
        raise HTTPException(status_code=400, detail="API key is required")

    result = translate_batch(req.words, req.api_key)

    if isinstance(result, dict) and "error" in result and len(result) == 1:
        raise HTTPException(status_code=500, detail=result["error"])

    return {"translations": result}


@app.post("/api/enrich")
async def enrich(req: EnrichRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
    if not req.api_key:
        raise HTTPException(status_code=400, detail="API key is required")

    result = enrich_word(req.text, req.sentence, req.zipf, req.api_key)

    if "error" in result and len(result) == 1:
        raise HTTPException(status_code=500, detail=result["error"])

    return result


@app.post("/api/export/apkg")
async def export_apkg(req: ExportApkgRequest):
    if not req.cards:
        raise HTTPException(status_code=400, detail="Cards are required")
    if not req.deck_name:
        raise HTTPException(status_code=400, detail="Deck name is required")

    try:
        apkg_bytes = create_deck(req.cards, req.deck_name)
        filename = f"{req.deck_name.replace(' ', '_')}.apkg"

        return Response(
            content=apkg_bytes,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/export/anki-connect")
async def export_anki_connect(req: ExportAnkiConnectRequest):
    if not req.cards:
        raise HTTPException(status_code=400, detail="Cards are required")
    if not req.deck_name:
        raise HTTPException(status_code=400, detail="Deck name is required")
    if not req.anki_url:
        raise HTTPException(status_code=400, detail="Anki URL is required")

    result = push_to_anki_connect(req.cards, req.deck_name, req.anki_url)

    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Unknown error"))

    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
