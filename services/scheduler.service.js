import { getMongoUri } from '../config/db.js';
import { dispatchDueJobs, cleanupOldJobs } from './reminder.service.js';
import { syncPremiumExpiryReminders } from './subscriptionNotifications.service.js';

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
const PREMIUM_SCAN_JOB = 'premium-expiry-scan';
const PREMIUM_SCAN_INTERVAL = '6 hours';
const CLEANUP_JOB = 'cleanup-notifications';
const CLEANUP_INTERVAL = '1 day';
// Terminal jobs older than this are pruned by the cleanup job.
const JOB_RETENTION_DAYS = 30;

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

    // Materializes premium-expiry reminder jobs (7/3/1/0 days before lapse).
    instance.define(PREMIUM_SCAN_JOB, async () => {
      try {
        await syncPremiumExpiryReminders();
      } catch (error) {
        console.error(
          '[scheduler.service] premium-expiry-scan run failed:',
          error?.message || error
        );
      }
    });

    // Prunes old terminal jobs so notification_jobs does not grow unbounded.
    instance.define(CLEANUP_JOB, async () => {
      try {
        await cleanupOldJobs(JOB_RETENTION_DAYS);
      } catch (error) {
        console.error(
          '[scheduler.service] cleanup-notifications run failed:',
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
    await instance.every(PREMIUM_SCAN_INTERVAL, PREMIUM_SCAN_JOB);
    await instance.every(CLEANUP_INTERVAL, CLEANUP_JOB);

    agenda = instance;
    console.log(
      `[scheduler.service] Agenda started; '${DISPATCH_JOB}' every ${DISPATCH_INTERVAL}, ` +
        `'${PREMIUM_SCAN_JOB}' every ${PREMIUM_SCAN_INTERVAL}, ` +
        `'${CLEANUP_JOB}' every ${CLEANUP_INTERVAL}.`
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
