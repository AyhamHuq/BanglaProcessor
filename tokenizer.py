import re
from wordfreq import zipf_frequency


def tokenize_article(text: str) -> dict:
    pattern = r'[।|,;:!?\s\u0964\u0965\(\)\[\]\{\}\"\'`\-\—\–]+'

    words = re.split(pattern, text)
    words = [w.strip() for w in words if w.strip()]

    tokens = []
    unique_words = {}

    for word in words:
        if word not in unique_words:
            zipf = zipf_frequency(word, 'bn')
            unique_words[word] = {
                'word': word,
                'zipf': zipf,
                'is_rare': zipf < 3.0
            }

        tokens.append({
            'word': word,
            'zipf': unique_words[word]['zipf'],
            'is_rare': unique_words[word]['is_rare']
        })

    return {
        'tokens': tokens,
        'unique_words': unique_words
    }
