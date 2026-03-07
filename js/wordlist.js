// POS lookup — hardcoded sets guarantee the spinner always works.
// WordNet enhances coverage if it loads; falls back gracefully.

export const VERBS = new Set([
  'RUN', 'PUSH', 'PULL', 'JUMP', 'KICK', 'SLAM', 'DASH', 'RUSH',
  'BOLT', 'DART', 'FLING', 'HURL', 'TOSS', 'CAST', 'THROW',
  'DRIVE', 'SLIDE', 'GLIDE', 'DRIFT', 'FLOAT', 'SURGE', 'BLAST',
  'CRASH', 'SMASH', 'CRUSH', 'SHOVE', 'NUDGE', 'BUDGE', 'SHIFT',
  'MOVE', 'SPIN', 'ROLL', 'FLIP', 'TURN', 'TWIST', 'SWING',
  'CARRY', 'DRAG', 'HAUL', 'LIFT', 'DROP', 'FALL', 'RISE',
  'SOAR', 'DIVE', 'CLIMB', 'CRAWL', 'CREEP', 'SNEAK', 'PROWL',
  'WALK', 'STEP', 'MARCH', 'STOMP', 'STAMP', 'POUND', 'BEAT',
  'HIT', 'SLAP', 'WHIP', 'LASH', 'SNAP', 'CRACK', 'BANG',
  'BLOW', 'GUST', 'SWEEP', 'SWIRL', 'WHIRL', 'CHURN', 'STIR',
  'SHAKE', 'RATTLE', 'JOLT', 'BUMP', 'RAM', 'JAM', 'CRAM',
  'PACK', 'FILL', 'POUR', 'FLOW', 'STREAM', 'FLOOD', 'LAUNCH',
  'SPLASH', 'SPRAY', 'BURST', 'ERUPT', 'SPARK', 'FLASH', 'BLAZE',
  'BURN', 'MELT', 'BOIL', 'FREEZE', 'SHOOT', 'AIM', 'PROPEL',
  'FLY', 'ZOOM', 'RACE', 'SPEED', 'HURRY', 'FLEE', 'ESCAPE',
  'CHASE', 'HUNT', 'GRAB', 'CATCH', 'SNATCH', 'SEND', 'PASS',
  'CHUCK', 'HEAVE', 'YANK', 'TUG', 'RIP', 'TEAR', 'SHRED',
  'CUT', 'SLICE', 'CHOP', 'HACK', 'DIG', 'SCRATCH', 'GRIND',
  'LEAP', 'BOUND', 'HOP', 'SKIP', 'DANCE', 'SWIM', 'SURF',
  'SAIL', 'ROW', 'STEER', 'GUIDE', 'LEAD', 'OPEN', 'LOCK',
  'BLOCK', 'CRANE', 'PLANT', 'ROAST', 'MARCH', 'DRIFT', 'LIGHT',
  'ROLL', 'STAMP', 'ROCK', 'FIRE', 'CHARGE', 'DRIVE', 'STRIKE',
]);

export const ADJECTIVES = new Set([
  'BIG', 'HOT', 'COLD', 'FAST', 'SLOW', 'HARD', 'SOFT', 'TALL', 'WIDE',
  'LONG', 'DEEP', 'HIGH', 'LOW', 'DARK', 'BOLD', 'WILD', 'CALM', 'COOL',
  'WARM', 'FLAT', 'SHARP', 'THICK', 'THIN', 'ROUGH', 'SMOOTH', 'BRIGHT',
  'CLEAR', 'DENSE', 'FIERCE', 'GIANT', 'GRAND', 'GREAT', 'HARSH', 'HEAVY',
  'HUGE', 'KEEN', 'LARGE', 'LIGHT', 'LOUD', 'MILD', 'NEAT', 'OBESE',
  'PALE', 'PLAIN', 'PURE', 'QUICK', 'QUIET', 'RAPID', 'RAW', 'REAL',
  'RICH', 'RIGID', 'ROUND', 'SAFE', 'SHORT', 'SLEEK', 'SLIM', 'OPEN',
  'SMALL', 'SMART', 'SOLID', 'SOUR', 'STARK', 'STEEP', 'STERN',
  'STIFF', 'STILL', 'STOUT', 'STRONG', 'SWEET', 'SWIFT', 'TIGHT', 'TOUGH',
  'VAST', 'VIVID', 'WEAK', 'WET', 'DRY', 'ODD', 'OLD', 'NEW', 'YOUNG',
  'BLUNT', 'BRIEF', 'BRISK', 'CRISP', 'CRUDE', 'CRUEL', 'DULL', 'EAGER',
  'FAINT', 'FRESH', 'GRIM', 'GROSS', 'LEAN', 'LOOSE', 'PRIME', 'PROUD',
  'RARE', 'RIPE', 'RUDE', 'SHEER', 'SNUG', 'SPARE', 'TENSE',
  'TIDY', 'TRIM', 'TRUE', 'VAGUE', 'WARY', 'WHOLE', 'WISE', 'LUCID',
]);

// WordNet enhances coverage when available
let _wordnet = null;
let _loadProgress = 0;
let _loadDone = false;
let _loadError = null;

const _loadPromise = fetch('./js/wordnet-data.json')
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(data => { _wordnet = data; _loadProgress = 1; })
  .catch(e => { _loadError = e; _loadProgress = 1; })
  .finally(() => { _loadDone = true; });

export function getLoadProgress() { return _loadProgress; }
export function isLoadDone() { return _loadDone; }
export function loadFailed() { return !!_loadError; }

export async function initWordNet() {
  await _loadPromise;
}

// Try to find the base form of a word by stripping common suffixes
function _findBase(w) {
  if (_wordnet[w]) return w;
  // Plurals: TOYS→TOY, BOXES→BOX, CHURCHES→CHURCH, BABIES→BABY
  if (w.endsWith('IES') && w.length > 4) { const b = w.slice(0, -3) + 'Y'; if (_wordnet[b]) return b; }
  if (w.endsWith('SES') || w.endsWith('XES') || w.endsWith('ZES') || w.endsWith('CHES') || w.endsWith('SHES')) {
    const b = w.endsWith('CHES') || w.endsWith('SHES') ? w.slice(0, -2) : w.slice(0, -2);
    if (_wordnet[b]) return b;
    const b2 = w.slice(0, -1); if (_wordnet[b2]) return b2;
  }
  if (w.endsWith('S') && !w.endsWith('SS')) { const b = w.slice(0, -1); if (_wordnet[b]) return b; }
  // Past tense / -ing: JUMPED→JUMP, RUNNING→RUN
  if (w.endsWith('ING')) {
    const b = w.slice(0, -3); if (_wordnet[b]) return b;
    const b2 = b + 'E'; if (_wordnet[b2]) return b2; // DANCING→DANCE
    if (b.length > 1 && b[b.length - 1] === b[b.length - 2]) { const b3 = b.slice(0, -1); if (_wordnet[b3]) return b3; } // RUNNING→RUN
  }
  if (w.endsWith('ED')) {
    const b = w.slice(0, -2); if (_wordnet[b]) return b;
    const b2 = w.slice(0, -1); if (_wordnet[b2]) return b2; // DANCED→DANCE
    if (b.length > 1 && b[b.length - 1] === b[b.length - 2]) { const b3 = b.slice(0, -1); if (_wordnet[b3]) return b3; } // STOPPED→STOP
    const b4 = w.slice(0, -3); if (w.endsWith('IED') && _wordnet[b4 + 'Y']) return b4 + 'Y'; // CARRIED→CARRY
  }
  // Comparatives: BIGGER→BIG, FASTER→FAST
  if (w.endsWith('ER')) {
    const b = w.slice(0, -2); if (_wordnet[b]) return b;
    const b2 = w.slice(0, -1); if (_wordnet[b2]) return b2;
    if (b.length > 1 && b[b.length - 1] === b[b.length - 2]) { const b3 = b.slice(0, -1); if (_wordnet[b3]) return b3; }
  }
  if (w.endsWith('EST')) {
    const b = w.slice(0, -3); if (_wordnet[b]) return b;
    const b2 = w.slice(0, -2); if (_wordnet[b2]) return b2;
  }
  if (w.endsWith('LY') && w.length > 4) { const b = w.slice(0, -2); if (_wordnet[b]) return b; }
  return null;
}

export function isValidWord(word) {
  if (!/^[A-Z]{2,}$/i.test(word)) return false;
  const w = word.toUpperCase();
  if (_wordnet) return !!_wordnet[w] || !!_findBase(w);
  return true;
}

export function getWordTypes(word) {
  const w = word.toUpperCase();

  // WordNet takes precedence when loaded
  const key = _wordnet ? (_wordnet[w] ? w : _findBase(w)) : null;
  if (key && _wordnet[key]) {
    const tags = _wordnet[key];
    const types = [];
    if (tags.includes('n')) types.push('NOUN');
    if (tags.includes('v')) types.push('VERB');
    if (tags.includes('a')) types.push('ADJ');
    if (types.length > 0) return types;
  }

  // Fall back to hardcoded sets
  const types = ['NOUN'];
  if (VERBS.has(w)) types.push('VERB');
  if (ADJECTIVES.has(w)) types.push('ADJ');
  return types;
}

export function isVerb(word) {
  const w = word.toUpperCase();
  const key = _wordnet ? (_wordnet[w] ? w : _findBase(w)) : null;
  if (key && _wordnet[key]) return _wordnet[key].includes('v');
  return VERBS.has(w);
}

export const STARTER_WORDS = [
  'BLOCK', 'CRANE', 'DRIFT', 'FLAME', 'GLOBE',
  'HASTE', 'JOINT', 'LEMON', 'MANGO',
  'OLIVE', 'PLANT', 'ROAST', 'STONE',
  'TRAIL', 'VALOR', 'WHEAT', 'YACHT',
  'BLAZE', 'CRUST', 'FROST', 'GRASP',
  'HOUSE', 'IVORY', 'JUMBO', 'LUCID',
  'NERVE', 'ORBIT', 'PRISM',
  'RIDGE', 'SPEAR', 'THINK', 'VIGOR',
  'WORLD', 'EXTRA', 'YOUTH', 'ZEBRA', 'AMBER',
  'BIRCH', 'COMET', 'DELTA', 'EMBER', 'FLINT',
];

export function getRandomWord() {
  const nounsOnly = STARTER_WORDS.filter(w => !VERBS.has(w) && !ADJECTIVES.has(w));
  const pool = nounsOnly.length > 0 ? nounsOnly : STARTER_WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}
