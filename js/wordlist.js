export const STARTER_WORDS = [
  'BLOCK', 'CRANE', 'DRIFT', 'FLAME', 'GLOBE',
  'HASTE', 'JOINT', 'KNELT', 'LEMON', 'MANGO',
  'OLIVE', 'PLANT', 'QUIRK', 'ROAST', 'STONE',
  'TRAIL', 'ULTRA', 'VALOR', 'WHEAT', 'YACHT',
  'BLAZE', 'CRUST', 'DWELT', 'FROST', 'GRASP',
  'HOUSE', 'IVORY', 'JUMBO', 'KNACK', 'LUCID',
  'MARCH', 'NERVE', 'ORBIT', 'PRISM', 'QUILT',
  'RIDGE', 'SPEAR', 'THINK', 'UNITY', 'VIGOR',
  'WORLD', 'EXTRA', 'YOUTH', 'ZEBRA', 'AMBER',
  'BIRCH', 'COMET', 'DELTA', 'EMBER', 'FLINT',
];

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
  'PACK', 'STUFF', 'FILL', 'POUR', 'FLOW', 'STREAM', 'FLOOD',
  'SPLASH', 'SPRAY', 'BURST', 'ERUPT', 'SPARK', 'FLASH', 'BLAZE',
  'BURN', 'MELT', 'BOIL', 'STEAM', 'FREEZE', 'CHILL', 'COOL',
  'HEAT', 'WARM', 'FIRE', 'SHOOT', 'AIM', 'LAUNCH', 'PROPEL',
  'FLY', 'ZOOM', 'RACE', 'SPEED', 'HURRY', 'FLEE', 'ESCAPE',
  'CHASE', 'HUNT', 'SEEK', 'FIND', 'GRAB', 'CATCH', 'SNATCH',
  'STEAL', 'TAKE', 'GIVE', 'SEND', 'PASS', 'PITCH', 'LOB',
  'CHUCK', 'HEAVE', 'YANK', 'TUG', 'RIP', 'TEAR', 'SHRED',
  'CUT', 'SLICE', 'CHOP', 'HACK', 'SAW', 'DRILL', 'BORE',
  'DIG', 'CARVE', 'ETCH', 'SCRATCH', 'SCRAPE', 'GRIND', 'CRUSH',
  'EAT', 'BITE', 'CHEW', 'GULP', 'SIP', 'DRINK', 'SWALLOW',
  'SPIT', 'COUGH', 'SNEEZE', 'YELL', 'SHOUT', 'SCREAM', 'ROAR',
  'GROWL', 'BARK', 'HOWL', 'SING', 'HUM', 'CLAP', 'TAP',
  'KNOCK', 'RING', 'BUZZ', 'CLICK', 'POP', 'BOOM', 'CRASH',
  'BUILD', 'MAKE', 'FORM', 'SHAPE', 'MOLD', 'CRAFT', 'FORGE',
  'WELD', 'FUSE', 'BIND', 'TIE', 'KNOT', 'WRAP', 'FOLD',
  'BEND', 'FLEX', 'STRETCH', 'EXPAND', 'GROW', 'SHRINK', 'FADE',
  'VANISH', 'APPEAR', 'EMERGE', 'SPRING', 'LEAP', 'BOUND', 'HOP',
  'SKIP', 'DANCE', 'PRANCE', 'STRUT', 'WADE', 'SWIM', 'SURF',
  'SAIL', 'ROW', 'PADDLE', 'STEER', 'GUIDE', 'LEAD', 'FOLLOW',
]);

export function getRandomWord() {
  return STARTER_WORDS[Math.floor(Math.random() * STARTER_WORDS.length)];
}

// Words that are commonly both noun and verb — treat as noun (no force)
const ALSO_NOUNS = new Set([
  'BLOCK', 'BOLT', 'DART', 'BLAST', 'CRASH', 'BEAT', 'BANG', 'BLOW',
  'SNAP', 'CRACK', 'BUMP', 'RAM', 'JAM', 'PACK', 'STREAM', 'FLOOD',
  'SPLASH', 'SPRAY', 'BURST', 'SPARK', 'FLASH', 'BLAZE', 'STEAM',
  'FIRE', 'DRILL', 'BORE', 'BITE', 'GULP', 'SIP', 'DRINK', 'SPIT',
  'BARK', 'HOWL', 'HUM', 'CLAP', 'TAP', 'KNOCK', 'RING', 'BUZZ',
  'CLICK', 'POP', 'BOOM', 'FORM', 'SHAPE', 'MOLD', 'CRAFT', 'FORGE',
  'KNOT', 'WRAP', 'FOLD', 'BEND', 'SPRING', 'BOUND', 'HOP', 'SKIP',
  'DANCE', 'WADE', 'SWIM', 'SURF', 'SAIL', 'ROW', 'PADDLE', 'LEAD',
  'MARCH', 'STEP', 'STOMP', 'STAMP', 'POUND', 'CAST', 'PITCH',
  'GUST', 'SWEEP', 'SWIRL', 'WHIRL', 'CHURN', 'STIR', 'JOLT',
  'PASS', 'CUT', 'SLICE', 'CHOP', 'HACK', 'SAW', 'DIG', 'HUNT',
  'RACE', 'SPEED', 'CHASE', 'CATCH', 'GRAB', 'STEAL', 'TAKE',
  'SLIDE', 'DRIFT', 'FLOAT', 'CRUSH', 'ROAR', 'SCREAM', 'SHOUT',
  'YELL', 'SHOOT', 'AIM', 'LAUNCH', 'LOB', 'TEAR', 'RIP',
]);

export function isVerb(word) {
  const w = word.toUpperCase();
  if (ALSO_NOUNS.has(w)) return false;
  return VERBS.has(w);
}
