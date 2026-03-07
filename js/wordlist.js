// WordNet 3.1 POS lookup — 74k words, built by scripts/build-wordnet.js
// Loads in background immediately on module import.

let _wordnet = null;
let _loadProgress = 0; // 0–1
let _loadDone = false;
let _loadError = null;

const _loadPromise = (async () => {
  try {
    const res = await fetch('./wordnet-data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) _loadProgress = received / contentLength;
    }

    _loadProgress = 0.95;
    // Decode and parse off main thread isn't possible without a worker,
    // but concatenate chunks efficiently first
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    const text = new TextDecoder().decode(merged);
    _wordnet = JSON.parse(text);
    _loadProgress = 1;
  } catch (e) {
    _loadError = e;
    console.warn('WordNet load failed — falling back to permissive mode:', e.message);
    _wordnet = {};
    _loadProgress = 1;
  }
  _loadDone = true;
})();

export function getLoadProgress() { return _loadProgress; }
export function isLoadDone() { return _loadDone; }
export function getLoadError() { return _loadError; }

export async function initWordNet() {
  await _loadPromise;
}

export function isValidWord(word) {
  if (!_wordnet) return true; // permissive while loading
  return word.toUpperCase() in _wordnet;
}

export function getWordTypes(word) {
  if (!_wordnet) return ['NOUN'];
  const tags = _wordnet[word.toUpperCase()];
  if (!tags || tags.length === 0) return ['NOUN'];
  const types = [];
  if (tags.includes('n')) types.push('NOUN');
  if (tags.includes('v')) types.push('VERB');
  if (tags.includes('a')) types.push('ADJ');
  return types.length > 0 ? types : ['NOUN'];
}

export function isVerb(word) {
  if (!_wordnet) return false;
  const tags = _wordnet[word.toUpperCase()];
  return !!(tags && tags.includes('v'));
}

export const STARTER_WORDS = [
  'BLOCK', 'CRANE', 'DRIFT', 'FLAME', 'GLOBE',
  'HASTE', 'JOINT', 'LEMON', 'MANGO',
  'OLIVE', 'PLANT', 'ROAST', 'STONE',
  'TRAIL', 'VALOR', 'WHEAT', 'YACHT',
  'BLAZE', 'CRUST', 'FROST', 'GRASP',
  'HOUSE', 'IVORY', 'JUMBO', 'LUCID',
  'MARCH', 'NERVE', 'ORBIT', 'PRISM',
  'RIDGE', 'SPEAR', 'THINK', 'VIGOR',
  'WORLD', 'EXTRA', 'YOUTH', 'ZEBRA', 'AMBER',
  'BIRCH', 'COMET', 'DELTA', 'EMBER', 'FLINT',
];

export function getRandomWord() {
  return STARTER_WORDS[Math.floor(Math.random() * STARTER_WORDS.length)];
}
