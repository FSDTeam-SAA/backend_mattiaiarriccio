import 'dotenv/config';
import { connectToDatabase, disconnectFromDatabase } from '../config/db.js';
import LiveInfoSuggestion from '../models/liveInfoSuggestion.model.js';
import {
  DEFAULT_LIVE_INFO_BUTTONS,
  DEFAULT_SUGGESTED_QUESTIONS
} from '../services/webSearchSeed.service.js';
import { createId } from '../lib/id.js';

/**
 * One-off reset for the chat welcome screen's two prompt lists.
 *
 *   node scripts/reset-live-info.js buttons     # the four Live Information buttons
 *   node scripts/reset-live-info.js questions   # the Suggested Questions
 *   node scripts/reset-live-info.js all
 *
 * The startup seeder deliberately only fills a list that is completely empty,
 * so an install that already has the older shortcuts keeps them forever. This
 * script is the escape hatch for the one migration that needs to happen: it
 * DELETES the chosen list and writes the current defaults in its place.
 *
 * Destructive by design, and never run automatically. Anything the admin has
 * written into the chosen list from the dashboard is discarded.
 */

const TARGETS = {
  buttons: { kind: 'live_info', defaults: DEFAULT_LIVE_INFO_BUTTONS },
  questions: {
    kind: 'suggested_question',
    defaults: DEFAULT_SUGGESTED_QUESTIONS
  }
};

const resetOne = async ({ kind, defaults }) => {
  // Rows written before `kind` existed are Live Information buttons; matching
  // them by absence too is what makes this an actual replacement rather than a
  // second copy alongside the old one.
  const filter =
    kind === 'live_info' ? { kind: { $in: [null, 'live_info'] } } : { kind };

  const { deletedCount = 0 } = await LiveInfoSuggestion.deleteMany(filter);

  await LiveInfoSuggestion.insertMany(
    defaults.map((entry) => ({
      _id: createId('lis'),
      icon: '',
      ...entry,
      kind,
      active: true,
      createdBy: null
    }))
  );

  console.log(
    `[reset-live-info] ${kind}: removed ${deletedCount}, inserted ${defaults.length}`
  );
};

const main = async () => {
  const target = String(process.argv[2] || '').trim().toLowerCase();

  if (!target || (target !== 'all' && !TARGETS[target])) {
    console.error(
      'Usage: node scripts/reset-live-info.js <buttons|questions|all>'
    );
    process.exitCode = 1;
    return;
  }

  await connectToDatabase();

  try {
    const chosen =
      target === 'all' ? Object.values(TARGETS) : [TARGETS[target]];
    for (const entry of chosen) {
      await resetOne(entry);
    }
  } finally {
    await disconnectFromDatabase();
  }
};

main().catch((error) => {
  console.error('[reset-live-info] failed:', error);
  process.exitCode = 1;
});
