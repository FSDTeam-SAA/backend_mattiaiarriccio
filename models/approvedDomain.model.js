import mongoose from 'mongoose';

export const DOMAIN_CATEGORIES = [
  'civil_protection',
  'weather',
  'official',
  'other'
];

/**
 * Admin-managed allow-list of sources the AI may search. Fed straight into the
 * OpenAI web_search tool as `filters.allowed_domains`, which is why entries are
 * stored as bare hostnames (no scheme, no www., no path) - that is the only
 * shape the tool accepts. Subdomains of a listed domain are allowed by OpenAI.
 *
 * NOTE: OpenAI caps allowed_domains at 20 entries per request. More than 20
 * ACTIVE domains cannot all be applied; webSearch.service.js truncates by
 * `order` and warns. Keep the active list under that cap.
 */
export const MAX_ALLOWED_DOMAINS = 20;

/**
 * Reduces anything an admin might paste ("https://www.protezionecivile.gov.it/en/")
 * to the bare host OpenAI expects ("protezionecivile.gov.it").
 */
export const normalizeDomain = (value) => {
  let text = String(value || '').trim().toLowerCase();
  if (!text) return '';

  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip scheme
  text = text.split('/')[0]; // strip path
  text = text.split('?')[0].split('#')[0];
  text = text.split('@').pop(); // strip any userinfo
  text = text.split(':')[0]; // strip port
  text = text.replace(/^www\./, '');
  text = text.replace(/\.+$/, '');

  return text;
};

export const isValidDomain = (value) =>
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(
    String(value || '')
  );

const approvedDomainSchema = new mongoose.Schema(
  {
    _id: {
      type: String
    },
    domain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    label: {
      type: String,
      default: '',
      trim: true
    },
    category: {
      type: String,
      enum: DOMAIN_CATEGORIES,
      default: 'official'
    },
    order: {
      type: Number,
      default: 0
    },
    active: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: String,
      default: null
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'approved_domains'
  }
);

approvedDomainSchema.index({ domain: 1 }, { unique: true });
approvedDomainSchema.index({ active: 1, order: 1 });

const ApprovedDomain =
  mongoose.models.ApprovedDomain ||
  mongoose.model('ApprovedDomain', approvedDomainSchema);

export default ApprovedDomain;
