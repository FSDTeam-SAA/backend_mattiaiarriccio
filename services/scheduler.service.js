import { getMongoUri } from '../config/db.js';
import { dispatchDueJobs } from './reminder.service.js';

/**
 * MongoDB-backed scheduler (Agenda — NOT Redis). It persists its own jobs in the
 * `agenda_jobs` collection inside the SAME database the app uses (MONGODB_URI),
 * and runs a single recurring 'dispatch-notifications' job that drains due
 * NotificationJobs through reminder.service.dispatchDueJobs().
 *
 * server.js should `import { initScheduler } from './services/scheduler.service.js'`
 * and call it AFTER the DB connection is established.
 */

const DISPATCH_JOB = 'dispatch-notifications';
const DISPATCH_INTERVAL = '2 minutes';

let agenda = null;
let starting = null;

export const getAgenda = () => agenda;

export const initScheduler = async () => {
  if (agenda) {
    return agenda;
  }

  if (starting) {
    return starting;
  }

  starting = (async () => {
    const agendaModule = await import('agenda');
    const Agenda = agendaModule.Agenda || agendaModule.default || agendaModule;

    const mongoUri = getMongoUri();

    const instance = new Agenda({
      db: {
        address: mongoUri,
        collection: 'agenda_jobs'
      },
      processEvery: '1 minute'
    });

    instance.define(DISPATCH_JOB, async () => {
      try {
        await dispatchDueJobs();
      } catch (error) {
        console.error(
          '[scheduler.service] dispatch-notifications run failed:',
          error?.message || error
        );
      }
    });

    instance.on('error', (error) => {
      console.error('[scheduler.service] agenda error:', error?.message || error);
    });

    await instance.start();
    // Idempotent: agenda.every upserts a single job with this name + interval.
    await instance.every(DISPATCH_INTERVAL, DISPATCH_JOB);

    agenda = instance;
    console.log(
      `[scheduler.service] Agenda started; '${DISPATCH_JOB}' every ${DISPATCH_INTERVAL}.`
    );
    return agenda;
  })();

  try {
    return await starting;
  } catch (error) {
    starting = null;
    console.error(
      '[scheduler.service] Failed to initialize scheduler:',
      error?.message || error
    );
    throw error;
  }
};

export const stopScheduler = async () => {
  if (agenda) {
    await agenda.stop();
    agenda = null;
    starting = null;
  }
};
