import 'dotenv/config';
import { connectToDatabase, disconnectFromDatabase } from '../config/db.js';
import { requestAiReplyWithSearch } from '../services/ai.service.js';

const run = async () => {
  await connectToDatabase();

  try {
    const result = await requestAiReplyWithSearch({
      query:
        'Which earthquakes have been recorded by INGV near Apice, Italy during the previous 24 hours?',
      emergencyType: 'Earthquake',
      language: 'en',
      caller: null,
      location: {
        city: 'Apice',
        region: 'Campania',
        country: 'IT',
        timezone: 'Europe/Rome'
      },
      onStatus: async (state) => console.log(`[status] ${state}`),
      onDelta: async () => {}
    });

    console.log('\n==== earthquake Web Search smoke test ====');
    console.log('usedWebSearch:', result.usedWebSearch);
    console.log('\nreply:\n', result.reply);
    console.log('\nsources:');
    for (const source of result.sources) {
      console.log(`- [${source.domain}] ${source.title}\n  ${source.url}`);
    }

    if (!result.usedWebSearch) {
      throw new Error('The earthquake shortcut did not activate Web Search');
    }
    if (
      !result.sources.some(
        (source) => source.domain === 'terremoti.ingv.it'
      )
    ) {
      throw new Error('The earthquake result did not include an INGV source');
    }

    console.log('\nPASS: earthquake search ran and returned an INGV source.');
  } finally {
    await disconnectFromDatabase();
  }
};

run().catch((error) => {
  console.error('\nFAIL:', error?.message || error);
  process.exitCode = 1;
});
