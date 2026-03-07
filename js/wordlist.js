// WordNet-backed word lookup.
// wordnet-data.json maps UPPERCASE words to arrays of POS tags: "n", "v", "a"
// Built by: node scripts/build-wordnet.js

let _wordnet = null;
// Start fetching immediately on module load — runs in background while user reads intro
const _loadPromise = fetch('./wordnet-data.json')
  .then(r => r.json())
  .then(data => { _wordnet = data; })
  .catch(() => { _wordnet = {}; }); // fail open

// Awaiting this resolves instantly if already loaded
export async function initWordNet() {
  await _loadPromise;
}

// Returns true if the word exists in WordNet
export function isValidWord(word) {
  if (!_wordnet) return true; // permissive before load
  return word.toUpperCase() in _wordnet;
}

// Returns array of type strings: one or more of 'VERB', 'NOUN', 'ADJ'
// Falls back to ['NOUN'] for unknown words
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
  'HASTE', 'JOINT', 'KNELT', 'LEMON', 'MANGO',
  'OLIVE', 'PLANT', 'QUIRK', 'ROAST', 'STONE',
  'TRAIL', 'VALOR', 'WHEAT', 'YACHT',
  'BLAZE', 'CRUST', 'FROST', 'GRASP',
  'HOUSE', 'IVORY', 'JUMBO', 'LUCID',
  'MARCH', 'NERVE', 'ORBIT', 'PRISM', 'QUILT',
  'RIDGE', 'SPEAR', 'THINK', 'UNITY', 'VIGOR',
  'WORLD', 'EXTRA', 'YOUTH', 'ZEBRA', 'AMBER',
  'BIRCH', 'COMET', 'DELTA', 'EMBER', 'FLINT',
];

export function getRandomWord() {
  return STARTER_WORDS[Math.floor(Math.random() * STARTER_WORDS.length)];
}
