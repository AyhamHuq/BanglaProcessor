// Bangla Reading Assistant - Frontend Application

// ============================================================================
// State Management
// ============================================================================

const STORAGE_KEYS = {
    API_KEY: 'bangla_api_key',
    ANKI_URL: 'bangla_anki_url',
    DECK_NAME: 'bangla_deck_name',
    ZIPF_THRESHOLD: 'bangla_zipf_threshold',
    IGNORED_WORDS: 'bangla_ignored_words',
    CARD_QUEUE: 'bangla_card_queue',
    TRANSLATION_CACHE: 'bangla_translation_cache',
    ENRICHMENT_CACHE: 'bangla_enrichment_cache'
};

const DEFAULT_VALUES = {
    ANKI_URL: 'http://localhost:8765',
    DECK_NAME: 'Bangla Vocab',
    ZIPF_THRESHOLD: 3.0
};

// State helpers
function getState(key, defaultValue = null) {
    const value = localStorage.getItem(key);
    if (value === null) return defaultValue;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function setState(key, value) {
    const toStore = typeof value === 'object' ? JSON.stringify(value) : value;
    localStorage.setItem(key, toStore);
}

function getIgnoredWords() {
    return getState(STORAGE_KEYS.IGNORED_WORDS, []);
}

function addIgnoredWord(word) {
    const ignored = getIgnoredWords();
    if (!ignored.includes(word)) {
        ignored.push(word);
        setState(STORAGE_KEYS.IGNORED_WORDS, ignored);
    }
}

function getCardQueue() {
    return getState(STORAGE_KEYS.CARD_QUEUE, []);
}

function addToQueue(card) {
    const queue = getCardQueue();
    // Avoid duplicates based on word
    if (!queue.some(c => c.word === card.word)) {
        queue.push(card);
        setState(STORAGE_KEYS.CARD_QUEUE, queue);
    }
    return queue;
}

function removeFromQueue(word) {
    const queue = getCardQueue().filter(c => c.word !== word);
    setState(STORAGE_KEYS.CARD_QUEUE, queue);
    return queue;
}

function getTranslationCache() {
    return getState(STORAGE_KEYS.TRANSLATION_CACHE, {});
}

function cacheTranslation(word, translation) {
    const cache = getTranslationCache();
    cache[word] = translation;
    setState(STORAGE_KEYS.TRANSLATION_CACHE, cache);
}

function getEnrichmentCache() {
    return getState(STORAGE_KEYS.ENRICHMENT_CACHE, {});
}

function cacheEnrichment(word, enrichment) {
    const cache = getEnrichmentCache();
    cache[word] = enrichment;
    setState(STORAGE_KEYS.ENRICHMENT_CACHE, cache);
}

function getApiKey() {
    return getState(STORAGE_KEYS.API_KEY, '');
}

function getAnkiUrl() {
    return getState(STORAGE_KEYS.ANKI_URL, DEFAULT_VALUES.ANKI_URL);
}

function getDeckName() {
    return getState(STORAGE_KEYS.DECK_NAME, DEFAULT_VALUES.DECK_NAME);
}

function getZipfThreshold() {
    return parseFloat(getState(STORAGE_KEYS.ZIPF_THRESHOLD, DEFAULT_VALUES.ZIPF_THRESHOLD));
}

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
    // Views
    landingView: document.getElementById('landing-view'),
    readerView: document.getElementById('reader-view'),

    // Landing
    articleInput: document.getElementById('article-input'),
    readBtn: document.getElementById('read-btn'),

    // Reader
    backBtn: document.getElementById('back-btn'),
    articleContent: document.getElementById('article-content'),

    // Popup
    wordPopup: document.getElementById('word-popup'),
    popupWord: document.getElementById('popup-word'),
    popupZipfBadge: document.getElementById('popup-zipf-badge'),
    translationLoading: document.getElementById('translation-loading'),
    translationText: document.getElementById('translation-text'),
    popupClose: document.getElementById('popup-close'),
    popupAdd: document.getElementById('popup-add'),
    popupIgnore: document.getElementById('popup-ignore'),
    popupSkip: document.getElementById('popup-skip'),

    // Queue
    queuePanel: document.getElementById('queue-panel'),
    queueToggle: document.getElementById('queue-toggle'),
    queueCount: document.getElementById('queue-count'),
    queueClose: document.getElementById('queue-close'),
    queueList: document.getElementById('queue-list'),
    exportApkg: document.getElementById('export-apkg'),
    exportAnki: document.getElementById('export-anki'),

    // Settings
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    settingsOverlay: document.getElementById('settings-overlay'),
    settingsClose: document.getElementById('settings-close'),
    settingsApiKey: document.getElementById('settings-api-key'),
    settingsAnkiUrl: document.getElementById('settings-anki-url'),
    settingsDeckName: document.getElementById('settings-deck-name'),
    settingsZipfThreshold: document.getElementById('settings-zipf-threshold'),
    zipfValue: document.getElementById('zipf-value'),
    clearIgnored: document.getElementById('clear-ignored'),
    clearCache: document.getElementById('clear-cache'),
    settingsSave: document.getElementById('settings-save'),

    // Toast
    toastContainer: document.getElementById('toast-container')
};

// Current selection state
let currentSelection = {
    word: '',
    zipf: null,
    isRare: false,
    sentence: ''
};

// Store original article text for sentence extraction
let originalArticleText = '';

// ============================================================================
// API Functions
// ============================================================================

async function apiRequest(endpoint, options = {}) {
    const apiKey = getApiKey();
    const headers = {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-Key': apiKey }),
        ...options.headers
    };

    const response = await fetch(endpoint, {
        ...options,
        headers
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }));
        throw new Error(error.detail || 'Request failed');
    }

    return response;
}

async function processArticle(text) {
    const response = await apiRequest('/api/process-article', {
        method: 'POST',
        body: JSON.stringify({ text, zipf_threshold: getZipfThreshold() })
    });
    return response.json();
}

async function translateWord(word) {
    // Check cache first
    const cache = getTranslationCache();
    if (cache[word]) {
        return cache[word];
    }

    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Please set your Gemini API key in settings');
    }

    const response = await apiRequest('/api/translate', {
        method: 'POST',
        body: JSON.stringify({ text: word, api_key: apiKey })
    });
    const data = await response.json();

    // Cache the result
    cacheTranslation(word, data.translation);
    return data.translation;
}

async function batchTranslateWords(words) {
    const apiKey = getApiKey();
    if (!apiKey) return;

    // Filter out already cached words
    const cache = getTranslationCache();
    const uncached = words.filter(w => !cache[w]);
    if (uncached.length === 0) return;

    try {
        const response = await apiRequest('/api/translate-batch', {
            method: 'POST',
            body: JSON.stringify({ words: uncached, api_key: apiKey })
        });
        const data = await response.json();

        // Cache all results
        for (const [word, translation] of Object.entries(data.translations)) {
            cacheTranslation(word, translation);
        }
    } catch (error) {
        console.error('Batch translation error:', error);
    }
}

async function enrichWord(word, sentence = '', zipf = 0) {
    // Check cache first
    const cache = getEnrichmentCache();
    if (cache[word]) {
        return cache[word];
    }

    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Please set your Gemini API key in settings');
    }

    const response = await apiRequest('/api/enrich', {
        method: 'POST',
        body: JSON.stringify({ text: word, sentence, zipf, api_key: apiKey })
    });
    const data = await response.json();

    // Cache the result
    cacheEnrichment(word, data);
    return data;
}

async function exportApkg() {
    const queue = getCardQueue();
    if (queue.length === 0) {
        showToast('No cards in queue', 'warning');
        return;
    }

    const response = await apiRequest('/api/export/apkg', {
        method: 'POST',
        body: JSON.stringify({
            cards: queue,
            deck_name: getDeckName()
        })
    });

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getDeckName().replace(/\s+/g, '_')}.apkg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Downloaded .apkg file', 'success');
}

async function exportToAnki() {
    const queue = getCardQueue();
    if (queue.length === 0) {
        showToast('No cards in queue', 'warning');
        return;
    }

    const response = await apiRequest('/api/export/anki-connect', {
        method: 'POST',
        body: JSON.stringify({
            cards: queue,
            deck_name: getDeckName(),
            anki_url: getAnkiUrl()
        })
    });

    const data = await response.json();
    if (data.success) {
        showToast(`Added ${data.added} cards to Anki`, 'success');
        // Clear the queue after successful export
        setState(STORAGE_KEYS.CARD_QUEUE, []);
        updateQueueUI();
    } else {
        showToast(data.error || 'Failed to push to Anki', 'error');
    }
}

// ============================================================================
// UI Functions
// ============================================================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        warning: 'bg-yellow-600',
        info: 'bg-blue-600'
    };

    toast.className = `toast px-4 py-2 rounded-lg shadow-lg ${colors[type]} text-white`;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function showView(view) {
    if (view === 'landing') {
        elements.landingView.classList.remove('hidden');
        elements.readerView.classList.add('hidden');
    } else {
        elements.landingView.classList.add('hidden');
        elements.readerView.classList.remove('hidden');
    }
}

function getZipfBadge(zipf) {
    if (zipf === null || zipf === undefined) {
        return { text: 'Unknown', class: 'bg-gray-600 text-gray-200' };
    }
    if (zipf >= 4.5) {
        return { text: 'Common', class: 'bg-green-600 text-green-100' };
    } else if (zipf >= 3.0) {
        return { text: 'Uncommon', class: 'bg-yellow-600 text-yellow-100' };
    } else {
        return { text: 'Rare', class: 'bg-red-600 text-red-100' };
    }
}

function renderArticle(html) {
    elements.articleContent.innerHTML = html;
    applyWordStyling();
}

function applyWordStyling() {
    const ignored = getIgnoredWords();
    const queue = getCardQueue();
    const addedWords = queue.map(c => c.word);

    document.querySelectorAll('.word-span').forEach(span => {
        const word = span.dataset.word;
        const isRare = span.dataset.isRare === 'true';

        // Reset classes
        span.classList.remove('word-ignored', 'word-added', 'word-rare');

        if (ignored.includes(word)) {
            span.classList.add('word-ignored');
        } else if (addedWords.includes(word)) {
            span.classList.add('word-added');
        }

        if (isRare && !ignored.includes(word)) {
            span.classList.add('word-rare');
        }
    });
}

function getSentenceForWord(word) {
    if (!originalArticleText) return word;
    // Split by Bangla sentence endings and newlines
    const sentences = originalArticleText.split(/[।\n]+/).filter(s => s.trim());
    for (const sentence of sentences) {
        if (sentence.includes(word)) {
            return sentence.trim();
        }
    }
    return word;
}

function showPopup(x, y, word, zipf) {
    const sentence = getSentenceForWord(word);
    currentSelection = { word, zipf, isRare: zipf !== null && zipf < getZipfThreshold(), sentence };

    elements.popupWord.textContent = word;

    const badge = getZipfBadge(zipf);
    elements.popupZipfBadge.textContent = badge.text;
    elements.popupZipfBadge.className = `ml-2 px-2 py-0.5 text-xs rounded-full ${badge.class}`;

    // Reset translation state
    elements.translationLoading.classList.remove('hidden');
    elements.translationText.textContent = '';

    // Position popup
    const popup = elements.wordPopup;
    popup.classList.remove('hidden');

    // Calculate position to keep popup in viewport
    const popupRect = popup.getBoundingClientRect();
    let left = x;
    let top = y + 10;

    if (left + popupRect.width > window.innerWidth) {
        left = window.innerWidth - popupRect.width - 10;
    }
    if (top + popupRect.height > window.innerHeight) {
        top = y - popupRect.height - 10;
    }

    popup.style.left = `${Math.max(10, left)}px`;
    popup.style.top = `${Math.max(10, top)}px`;

    // Fetch translation (skips API for very common words)
    loadTranslation(word, zipf);
}

async function loadTranslation(word, zipf) {
    // Skip API call for very common words (zipf > 5.5) - user likely knows these
    if (zipf !== null && zipf > 5.5) {
        elements.translationLoading.classList.add('hidden');
        elements.translationText.textContent = '(common word - click Add for full details)';
        return;
    }

    try {
        const translation = await translateWord(word);
        elements.translationLoading.classList.add('hidden');
        elements.translationText.textContent = translation;
    } catch (error) {
        elements.translationLoading.classList.add('hidden');
        const msg = error.message || '';
        if (msg.includes('quota') || msg.includes('429')) {
            elements.translationText.textContent = 'API quota exhausted - wait or upgrade key';
        } else if (msg.includes('API key')) {
            elements.translationText.textContent = 'Set API key in settings';
        } else {
            elements.translationText.textContent = 'Translation unavailable';
        }
        console.error('Translation error:', error);
    }
}

function hidePopup() {
    elements.wordPopup.classList.add('hidden');
    currentSelection = { word: '', zipf: null, isRare: false, sentence: '' };
}

function updateQueueUI() {
    const queue = getCardQueue();
    elements.queueCount.textContent = queue.length;

    if (queue.length === 0) {
        elements.queueList.innerHTML = '<p class="text-gray-500 text-center">No cards in queue</p>';
        return;
    }

    elements.queueList.innerHTML = queue.map(card => `
        <div class="flex items-center justify-between p-2 bg-gray-700 rounded-lg">
            <div>
                <span class="text-lg">${card.word}</span>
                <span class="text-sm text-gray-400 block">${card.translation || ''}</span>
            </div>
            <button class="queue-remove p-1 text-gray-500 hover:text-red-400" data-word="${card.word}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>
    `).join('');

    // Add remove handlers
    document.querySelectorAll('.queue-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            removeFromQueue(btn.dataset.word);
            updateQueueUI();
            applyWordStyling();
        });
    });
}

function loadSettings() {
    elements.settingsApiKey.value = getApiKey();
    elements.settingsAnkiUrl.value = getAnkiUrl();
    elements.settingsDeckName.value = getDeckName();
    elements.settingsZipfThreshold.value = getZipfThreshold();
    elements.zipfValue.textContent = getZipfThreshold().toFixed(1);
}

function saveSettings() {
    setState(STORAGE_KEYS.API_KEY, elements.settingsApiKey.value);
    setState(STORAGE_KEYS.ANKI_URL, elements.settingsAnkiUrl.value || DEFAULT_VALUES.ANKI_URL);
    setState(STORAGE_KEYS.DECK_NAME, elements.settingsDeckName.value || DEFAULT_VALUES.DECK_NAME);
    setState(STORAGE_KEYS.ZIPF_THRESHOLD, elements.settingsZipfThreshold.value);

    showToast('Settings saved', 'success');
    elements.settingsModal.classList.add('hidden');
}

// ============================================================================
// Event Handlers
// ============================================================================

// Read Article
elements.readBtn.addEventListener('click', async () => {
    const text = elements.articleInput.value.trim();
    if (!text) {
        showToast('Please enter some text', 'warning');
        return;
    }

    elements.readBtn.disabled = true;
    elements.readBtn.innerHTML = '<div class="loading-spinner"></div> Processing...';

    try {
        originalArticleText = text;  // Store for sentence extraction
        const result = await processArticle(text);
        renderArticle(result.html);
        showView('reader');

        // Batch-translate all rare words in the background
        const rareWords = result.tokens
            .filter(t => t.is_rare)
            .map(t => t.word)
            .filter((w, i, arr) => arr.indexOf(w) === i);  // dedupe
        if (rareWords.length > 0) {
            batchTranslateWords(rareWords);  // fire and forget
        }
    } catch (error) {
        showToast(error.message || 'Failed to process article', 'error');
        console.error('Process error:', error);
    } finally {
        elements.readBtn.disabled = false;
        elements.readBtn.innerHTML = `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
            </svg>
            Read Article
        `;
    }
});

// Back to landing
elements.backBtn.addEventListener('click', () => {
    showView('landing');
    hidePopup();
});

// Word click + phrase selection handler
elements.articleContent.addEventListener('mouseup', (e) => {
    // Small delay to let selection finalize
    setTimeout(() => {
        if (elements.wordPopup.contains(e.target)) return;

        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText && selectedText.length > 1) {
            // Text was dragged/selected — treat as phrase or single word
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            showPopup(rect.left, rect.bottom, selectedText, null);
        } else {
            // Single click on a word span
            const span = e.target.closest('.word-span');
            if (span) {
                const word = span.dataset.word;
                const zipf = span.dataset.zipf ? parseFloat(span.dataset.zipf) : null;
                const rect = span.getBoundingClientRect();
                showPopup(rect.left, rect.bottom, word, zipf);
            }
        }
    }, 10);
});

// Popup close
elements.popupClose.addEventListener('click', hidePopup);
elements.popupSkip.addEventListener('click', hidePopup);

// Click outside popup to close
document.addEventListener('click', (e) => {
    if (!elements.wordPopup.contains(e.target) &&
        !e.target.closest('.word-span') &&
        !elements.wordPopup.classList.contains('hidden')) {
        hidePopup();
    }
});

// Escape to close popup
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hidePopup();
        elements.settingsModal.classList.add('hidden');
        elements.queuePanel.classList.add('hidden');
    }
});

// Debounce helper
let addDebounceTimer = null;

// Add to Anki
elements.popupAdd.addEventListener('click', async () => {
    if (!currentSelection.word) return;

    // Debounce rapid clicks
    if (addDebounceTimer) return;
    addDebounceTimer = setTimeout(() => { addDebounceTimer = null; }, 1000);

    elements.popupAdd.disabled = true;
    elements.popupAdd.innerHTML = '<div class="loading-spinner mx-auto"></div>';

    try {
        // Get sentence context from original article
        const sentence = currentSelection.sentence || currentSelection.word;
        const zipf = currentSelection.zipf || 0;

        const enrichment = await enrichWord(currentSelection.word, sentence, zipf);

        // Use enrichment translation (saves a separate translate call if not cached)
        const translation = enrichment.translation || elements.translationText.textContent;

        const card = {
            word: currentSelection.word,
            translation: translation,
            ...enrichment
        };

        addToQueue(card);
        updateQueueUI();
        applyWordStyling();
        showToast(`Added "${currentSelection.word}" to queue`, 'success');
        hidePopup();
    } catch (error) {
        showToast(error.message || 'Failed to enrich word', 'error');
        console.error('Enrich error:', error);
    } finally {
        elements.popupAdd.disabled = false;
        elements.popupAdd.textContent = 'Add to Anki';
    }
});

// Ignore word
elements.popupIgnore.addEventListener('click', () => {
    if (!currentSelection.word) return;

    addIgnoredWord(currentSelection.word);
    applyWordStyling();
    showToast(`Ignored "${currentSelection.word}"`, 'info');
    hidePopup();
});

// Queue panel
elements.queueToggle.addEventListener('click', () => {
    elements.queuePanel.classList.toggle('hidden');
    updateQueueUI();
});

elements.queueClose.addEventListener('click', () => {
    elements.queuePanel.classList.add('hidden');
});

// Export handlers
elements.exportApkg.addEventListener('click', async () => {
    elements.exportApkg.disabled = true;
    elements.exportApkg.innerHTML = '<div class="loading-spinner mx-auto"></div>';

    try {
        await exportApkg();
    } catch (error) {
        showToast(error.message || 'Export failed', 'error');
        console.error('Export error:', error);
    } finally {
        elements.exportApkg.disabled = false;
        elements.exportApkg.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            Download .apkg
        `;
    }
});

elements.exportAnki.addEventListener('click', async () => {
    elements.exportAnki.disabled = true;
    elements.exportAnki.innerHTML = '<div class="loading-spinner mx-auto"></div>';

    try {
        await exportToAnki();
    } catch (error) {
        showToast(error.message || 'Push to Anki failed', 'error');
        console.error('Push error:', error);
    } finally {
        elements.exportAnki.disabled = false;
        elements.exportAnki.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
            </svg>
            Push to Anki
        `;
    }
});

// Settings
elements.settingsBtn.addEventListener('click', () => {
    loadSettings();
    elements.settingsModal.classList.remove('hidden');
});

elements.settingsClose.addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
});

elements.settingsOverlay.addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
});

elements.settingsZipfThreshold.addEventListener('input', () => {
    elements.zipfValue.textContent = parseFloat(elements.settingsZipfThreshold.value).toFixed(1);
});

elements.settingsSave.addEventListener('click', saveSettings);

elements.clearIgnored.addEventListener('click', () => {
    setState(STORAGE_KEYS.IGNORED_WORDS, []);
    applyWordStyling();
    showToast('Cleared ignored words', 'success');
});

elements.clearCache.addEventListener('click', () => {
    setState(STORAGE_KEYS.TRANSLATION_CACHE, {});
    setState(STORAGE_KEYS.ENRICHMENT_CACHE, {});
    showToast('Cleared cache', 'success');
});

// ============================================================================
// Initialization
// ============================================================================

function init() {
    // Initialize with defaults if not set
    if (!localStorage.getItem(STORAGE_KEYS.ANKI_URL)) {
        setState(STORAGE_KEYS.ANKI_URL, DEFAULT_VALUES.ANKI_URL);
    }
    if (!localStorage.getItem(STORAGE_KEYS.DECK_NAME)) {
        setState(STORAGE_KEYS.DECK_NAME, DEFAULT_VALUES.DECK_NAME);
    }
    if (!localStorage.getItem(STORAGE_KEYS.ZIPF_THRESHOLD)) {
        setState(STORAGE_KEYS.ZIPF_THRESHOLD, DEFAULT_VALUES.ZIPF_THRESHOLD);
    }

    // Initialize UI state
    updateQueueUI();
}

// Run initialization
init();
