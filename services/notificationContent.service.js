/**
 * Localized notification copy (en/it) for system-generated notifications
 * (reminders + premium lifecycle). A job stores a `contentKey` + `contentParams`
 * and the dispatcher renders the copy in the recipient's language at send time,
 * so the same job reads correctly for English and Italian users.
 *
 * Params that vary by locale formatting (dates) are pre-formatted by the caller
 * and passed through as strings.
 */

const CONTENT = {
  checklist_item_reminder: {
    en: (p) => ({
      title: 'Checklist reminder',
      body: `"${p.item}" is due on ${p.date}.`
    }),
    it: (p) => ({
      title: 'Promemoria checklist',
      body: `"${p.item}" scade il ${p.date}.`
    })
  },
  material_expiry: {
    en: (p) => ({
      title: 'Material expiring soon',
      body: `${p.name} expires on ${p.date}.`
    }),
    it: (p) => ({
      title: 'Materiale in scadenza',
      body: `${p.name} scade il ${p.date}.`
    })
  },
  material_inspection: {
    en: (p) => ({
      title: 'Inspection due',
      body: `It's time to inspect ${p.name}.`
    }),
    it: (p) => ({
      title: 'Ispezione in scadenza',
      body: `È il momento di ispezionare ${p.name}.`
    })
  },
  premium_activated: {
    en: () => ({
      title: "You're Premium!",
      body: 'Your WeSafe Premium subscription is now active. Enjoy every unlocked feature!'
    }),
    it: () => ({
      title: 'Sei Premium!',
      body: 'Il tuo abbonamento WeSafe Premium è ora attivo. Goditi tutte le funzioni sbloccate!'
    })
  },
  premium_expiring: {
    en: (p) => ({
      title: 'Premium ending soon',
      body:
        Number(p.days) <= 0
          ? 'Your Premium subscription expires today.'
          : `Your Premium subscription expires in ${p.days} day${Number(p.days) === 1 ? '' : 's'}.`
    }),
    it: (p) => ({
      title: 'Premium in scadenza',
      body:
        Number(p.days) <= 0
          ? 'Il tuo abbonamento Premium scade oggi.'
          : `Il tuo abbonamento Premium scade tra ${p.days} ${Number(p.days) === 1 ? 'giorno' : 'giorni'}.`
    })
  },
  premium_expired: {
    en: () => ({
      title: 'Premium expired',
      body: 'Your Premium subscription has expired. Renew to keep your premium features.'
    }),
    it: () => ({
      title: 'Premium scaduto',
      body: 'Il tuo abbonamento Premium è scaduto. Rinnova per mantenere le funzioni premium.'
    })
  },
  premium_renewed: {
    en: () => ({
      title: 'Premium renewed',
      body: 'Your Premium subscription has been renewed. Thank you for staying with WeSafe!'
    }),
    it: () => ({
      title: 'Premium rinnovato',
      body: 'Il tuo abbonamento Premium è stato rinnovato. Grazie per essere con WeSafe!'
    })
  },
  premium_canceled: {
    en: (p) => ({
      title: 'Premium canceled',
      body: p.date
        ? `Your Premium subscription will end on ${p.date}.`
        : 'Auto-renew for your Premium subscription has been turned off.'
    }),
    it: (p) => ({
      title: 'Premium annullato',
      body: p.date
        ? `Il tuo abbonamento Premium terminerà il ${p.date}.`
        : 'Il rinnovo automatico del tuo abbonamento Premium è stato disattivato.'
    })
  },
  premium_payment_failed: {
    en: () => ({
      title: 'Premium renewal failed',
      body: "We couldn't renew your Premium subscription. Please update your payment details to keep premium."
    }),
    it: () => ({
      title: 'Rinnovo Premium non riuscito',
      body: 'Non è stato possibile rinnovare il tuo abbonamento Premium. Aggiorna i dati di pagamento per mantenere il premium.'
    })
  }
};

/**
 * Render a localized {title, body} for a content key, falling back to English
 * for unknown languages and returning null for an unknown key (caller then uses
 * the job's stored title/body).
 */
export const renderNotificationContent = (key, params = {}, language = 'en') => {
  const entry = CONTENT[key];
  if (!entry) return null;
  const build = entry[language] || entry.en;
  return build(params || {});
};

export const NOTIFICATION_CONTENT_KEYS = Object.keys(CONTENT);
