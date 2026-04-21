import 'dotenv/config';
import { connectToDatabase, disconnectFromDatabase } from '../config/db.js';
import {
  requestAiReply,
  fetchAiPrompt,
  updateAiPrompt,
  getAiServiceInfo
} from '../services/ai.service.js';

const log = (label, value) => {
  console.log('\n====', label, '====');
  console.dir(value, { depth: 4 });
};

const run = async () => {
  await connectToDatabase();
  log('service info', getAiServiceInfo());

  const prompt = await fetchAiPrompt();
  log('fetchAiPrompt()', {
    welcomeMessage: prompt.welcomeMessage.slice(0, 80) + '...',
    systemInstruction: prompt.systemInstruction.slice(0, 80) + '...',
    fallbackMessage: prompt.fallbackMessage
  });

  const timed = async (label, fn) => {
    const t0 = Date.now();
    const result = await fn();
    const ms = Date.now() - t0;
    console.log(`\n---- ${label} (${ms} ms) ----`);
    console.log(result.reply);
    return { result, ms };
  };

  await timed('Fire (EN)', () =>
    requestAiReply({
      userId: 'test-user-1',
      query:
        'Selected emergency type: Fire.\n\nLatest user request:\nThere is a fire in the kitchen, what do I do?',
      emergencyType: 'Fire',
      language: 'en'
    })
  );

  await timed('Earthquake (IT)', () =>
    requestAiReply({
      userId: 'test-user-1',
      query:
        "Tipo di emergenza selezionato: Terremoto.\n\nRichiesta più recente:\nSto avvertendo una forte scossa, cosa devo fare?",
      emergencyType: 'Earthquake',
      language: 'it'
    })
  );

  await timed('CPR (EN)', () =>
    requestAiReply({
      userId: 'test-user-1',
      query:
        'Selected emergency type: CPR.\n\nLatest user request:\nAdult collapsed and not breathing.',
      emergencyType: 'CPR',
      language: 'en'
    })
  );

  await timed('Blackout (IT)', () =>
    requestAiReply({
      userId: 'test-user-1',
      query:
        "Tipo di emergenza selezionato: Blackout.\n\nRichiesta più recente:\nTutta la casa è senza corrente, cosa controllo prima?",
      emergencyType: 'Blackout',
      language: 'it'
    })
  );

  const updated = await updateAiPrompt({
    fallbackMessage:
      "I'm sorry, I can only assist with emergency situations..."
  });
  log('updateAiPrompt() result', {
    welcomeMessage: updated.welcomeMessage.slice(0, 60) + '...',
    fallbackMessage: updated.fallbackMessage
  });

  await disconnectFromDatabase();
};

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
