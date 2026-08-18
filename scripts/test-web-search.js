import 'dotenv/config';
import { connectToDatabase, disconnectFromDatabase } from '../config/db.js';
import { seedSettings, getSetting } from '../services/settings.service.js';
import { seedWebSearchDefaults } from '../services/webSearchSeed.service.js';
import { requestAiReplyWithSearch } from '../services/ai.service.js';
import {
  shouldConsiderWebSearch,
  getAllowedDomains,
  getWebSearchUsageSummary,
  recordWebSearch,
  MAX_SOURCES_SHOWN
} from '../services/webSearch.service.js';

/**
 * Manual harness for the Web Search feature. Run with:
 *   node scripts/test-web-search.js
 *
 * Proves the two things the client actually cares about:
 *  1. ordinary questions never reach the search path (no cost),
 *  2. live questions do, restricted to approved domains, with sources.
 */

const GATE_CASES = [
  // [message, language, expected]
  ['What should I put in a 72-hour kit?', 'en', false],
  ['How do I treat a burn?', 'en', false],
  ['Cosa devo mettere in un kit 72h?', 'it', false],
  ['Are there any weather alerts today in Naples?', 'en', true],
  ['What is the weather right now?', 'en', true],
  ['Ci sono allerte meteo oggi a Napoli?', 'it', true],
  ['È previsto maltempo nelle prossime ore?', 'it', true]
];

const run = async () => {
  await connectToDatabase();
  await seedSettings();
  await seedWebSearchDefaults();

  /* ---- 1. The cost gate ---- */
  console.log('\n==== trigger gate ====');
  let failures = 0;
  for (const [message, language, expected] of GATE_CASES) {
    const actual = await shouldConsiderWebSearch({ text: message, language });
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  [${language}] search=${String(actual).padEnd(5)} ` +
        `expected=${String(expected).padEnd(5)} "${message}"`
    );
  }
  console.log(failures === 0 ? '\nGate: all cases passed' : `\nGate: ${failures} FAILED`);

  /* ---- 2. Config ---- */
  const domains = await getAllowedDomains();
  console.log('\n==== config ====');
  console.log('enabled          :', await getSetting('webSearchEnabled'));
  console.log('context size     :', await getSetting('webSearchContextSize'));
  console.log('free daily limit :', await getSetting('webSearchFreeDailyLimit'));
  console.log('prem daily limit :', await getSetting('webSearchPremiumDailyLimit'));
  console.log('allowed domains  :', domains);

  if (domains.length === 0) {
    console.log('\nNo approved domains active - skipping the live call.');
    await disconnectFromDatabase();
    return;
  }

  /* ---- 3. A real live call ---- */
  console.log('\n==== live call ====');
  const startedAt = Date.now();
  try {
    const result = await requestAiReplyWithSearch({
      query: 'Ci sono allerte meteo oggi a Napoli?',
      emergencyType: 'General Emergency',
      language: 'it',
      caller: null,
      location: { city: 'Napoli', region: 'Campania', country: 'IT' },
      onStatus: async (state) => console.log(`  [status] ${state}`),
      onDelta: async () => {}
    });

    console.log(`\n--- reply (${Date.now() - startedAt} ms) ---`);
    console.log(result.reply);
    console.log('\nusedWebSearch:', result.usedWebSearch);
    console.log('sources:');
    for (const source of result.sources) {
      console.log(`  - [${source.domain}] ${source.title}\n    ${source.url}`);
    }

    const offApproved = result.sources.filter(
      (source) =>
        source.domain &&
        !domains.some(
          (allowed) =>
            source.domain === allowed || source.domain.endsWith(`.${allowed}`)
        )
    );
    console.log(
      offApproved.length === 0
        ? '\nPASS: every source is on the approved list'
        : `\nFAIL: ${offApproved.length} source(s) outside the approved list`
    );
    console.log(
      result.sources.length <= MAX_SOURCES_SHOWN
        ? `PASS: ${result.sources.length} sources shown (cap ${MAX_SOURCES_SHOWN})`
        : `FAIL: ${result.sources.length} sources exceeds the cap of ${MAX_SOURCES_SHOWN}`
    );

    // The controller records usage after a real search; do the same here so the
    // counters below prove the write path works, not just the read path.
    if (result.usedWebSearch) {
      const before = await getWebSearchUsageSummary({ days: 1 });
      await recordWebSearch({ userId: 'test-user-web-search', premium: false });
      const after = await getWebSearchUsageSummary({ days: 1 });
      console.log(
        after.today === before.today + 1
          ? `PASS: usage counter incremented (${before.today} -> ${after.today})`
          : `FAIL: usage counter did not increment (${before.today} -> ${after.today})`
      );
    }
  } catch (error) {
    console.error('\nLive call failed:', error?.message || error);
    console.error('(chat would have fallen back to the ordinary reply path)');
  }

  /* ---- 4. Counters ---- */
  console.log('\n==== usage counters ====');
  console.dir(await getWebSearchUsageSummary({ days: 7 }), { depth: 4 });

  await disconnectFromDatabase();
};

run().catch(async (error) => {
  console.error('test-web-search failed:', error);
  await disconnectFromDatabase().catch(() => {});
  process.exit(1);
});
