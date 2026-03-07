// scripts/build-wordnet.js
// Processes WordNet 3.1 index files into a compact JSON for the game.
// Output: js/wordnet-data.json  →  { "ROCK": ["n","v"], "LIGHT": ["n","v","a"], ... }
// Run: node scripts/build-wordnet.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const wn = require('wordnet-db');

const DICT = wn.path;

// Map WordNet POS tags to our short codes
const POS_FILES = [
  { file: 'index.noun', tag: 'n' },
  { file: 'index.verb', tag: 'v' },
  { file: 'index.adj',  tag: 'a' },
  // skipping adverbs — not useful for gameplay
];

async function parseIndex(filepath, tag, wordMap) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filepath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // Comment lines start with spaces
    if (line.startsWith(' ') || line.trim() === '') continue;

    // First token is the lemma (underscores for multi-word, we skip those)
    const lemma = line.split(' ')[0];
    if (lemma.includes('_') || lemma.includes('-')) continue; // single words only
    if (!/^[a-z]+$/.test(lemma)) continue; // letters only

    const word = lemma.toUpperCase();
    if (!wordMap.has(word)) wordMap.set(word, new Set());
    wordMap.get(word).add(tag);
  }
}

async function main() {
  console.log('Parsing WordNet index files...');
  const wordMap = new Map();

  for (const { file, tag } of POS_FILES) {
    const filepath = path.join(DICT, file);
    await parseIndex(filepath, tag, wordMap);
    console.log(`  ${file}: done`);
  }

  // Convert to plain object with sorted type arrays
  const result = {};
  // Define preferred order for types
  const ORDER = ['n', 'v', 'a'];
  for (const [word, types] of wordMap) {
    result[word] = ORDER.filter(t => types.has(t));
  }

  const outPath = path.join(__dirname, '..', 'js', 'wordnet-data.json');
  const json = JSON.stringify(result);
  fs.writeFileSync(outPath, json);

  const wordCount = Object.keys(result).length;
  const sizeKB = Math.round(json.length / 1024);
  console.log(`\nDone! ${wordCount.toLocaleString()} words → js/wordnet-data.json (${sizeKB} KB)`);

  // Quick sanity check
  const checks = ['ROCK', 'LIGHT', 'RUN', 'FAST', 'TABLE', 'BEAUTIFUL'];
  console.log('\nSample lookups:');
  for (const w of checks) {
    console.log(`  ${w}: [${(result[w] || []).join(', ')}]`);
  }
}

main().catch(console.error);
