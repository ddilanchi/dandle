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

const _loadPromise = fetch('./wordnet-data.json')
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

export function isValidWord(word) {
  return /^[A-Z]{2,}$/i.test(word);
}

export function getWordTypes(word) {
  const w = word.toUpperCase();

  // WordNet takes precedence when loaded
  if (_wordnet && _wordnet[w]) {
    const tags = _wordnet[w];
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
  if (_wordnet && _wordnet[w]) return _wordnet[w].includes('v');
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
  return STARTER_WORDS[Math.floor(Math.random() * STARTER_WORDS.length)];
}
