// WordNet 3.1 POS lookup — 74k words, built by scripts/build-wordnet.js
// Loads in background immediately on module import.

let _wordnet = null;
let _loadProgress = 0; // 0–1
let _loadDone = false;
let _loadError = null;

const _loadPromise = fetch('./wordnet-data.json')
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(data => {
    _wordnet = data;
    _loadProgress = 1;
  })
  .catch(e => {
    _loadError = e;
    console.warn('WordNet load failed:', e.message);
    _wordnet = {};
    _loadProgress = 1;
  })
  .finally(() => { _loadDone = true; });

export function getLoadProgress() { return _loadProgress; }
export function isLoadDone() { return _loadDone; }
export function loadFailed() { return !!_loadError; }
export function getLoadError() { return _loadError; }

export async function initWordNet() {
  await _loadPromise;
}

export function isValidWord(word) {
  if (!_wordnet || _loadError) return true; // permissive if not loaded or failed
  const w = word.toUpperCase();
  if (!(w in _wordnet)) return true; // WordNet doesn't have everything — be permissive
  return true; // always allow, use WordNet only for POS tagging
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
