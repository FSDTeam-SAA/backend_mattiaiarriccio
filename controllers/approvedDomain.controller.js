import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import { createId } from '../lib/id.js';
import ApprovedDomain, {
  DOMAIN_CATEGORIES,
  MAX_ALLOWED_DOMAINS,
  normalizeDomain,
  isValidDomain
} from '../models/approvedDomain.model.js';
import { invalidateApprovedDomainCache } from '../services/webSearch.service.js';
import { logAudit } from '../services/audit.service.js';
import {
  parseBooleanInput,
  parseIntegerInput
} from '../utils/requestParsers.js';

const serializeApprovedDomain = (doc) => ({
  id: doc._id,
  domain: doc.domain,
  label: doc.label || '',
  category: doc.category || 'official',
  order: doc.order ?? 0,
  active: doc.active !== false,
  createdBy: doc.createdBy || null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt
});

const assertValidDomain = (input) => {
  const domain = normalizeDomain(input);

  if (!domain) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'domain is required');
  }

  if (!isValidDomain(domain)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `"${domain}" is not a valid domain. Use a bare hostname such as protezionecivile.gov.it`
    );
  }

  return domain;
};

const assertValidCategory = (value, fallback = 'official') => {
  const category = String(value ?? fallback).trim();
  if (!DOMAIN_CATEGORIES.includes(category)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `category must be one of: ${DOMAIN_CATEGORIES.join(', ')}`
    );
  }
  return category;
};

const countActive = () => ApprovedDomain.countDocuments({ active: true });

/**
 * Admin: GET /api/v1/admin/approved-domains?active=
 *
 * `activeCount` and `maxAllowed` are returned so the dashboard can warn when the
 * approved list exceeds what OpenAI will accept in a single search.
 */
export const listApprovedDomains = catchAsync(async (req, res) => {
  const filter = {};
  const activeFilter = parseBooleanInput(req.query.active);
  if (activeFilter !== undefined && req.query.active !== undefined) {
    filter.active = activeFilter;
  }

  const [domains, activeCount] = await Promise.all([
    ApprovedDomain.find(filter).sort({ order: 1, createdAt: 1 }).lean(),
    countActive()
  ]);

  sendSuccess(res, {
    message: 'Approved domains fetched successfully',
    data: {
      domains: domains.map(serializeApprovedDomain),
      activeCount,
      maxAllowed: MAX_ALLOWED_DOMAINS,
      overLimit: activeCount > MAX_ALLOWED_DOMAINS
    }
  });
});

/**
 * Admin: POST /api/v1/admin/approved-domains
 */
export const createApprovedDomain = catchAsync(async (req, res) => {
  const domain = assertValidDomain(req.body.domain);
  const category = assertValidCategory(req.body.category);

  const existing = await ApprovedDomain.findOne({ domain }).lean();
  if (existing) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      `${domain} is already in the approved list`
    );
  }

  const order = parseIntegerInput(req.body.order);
  const activeValue = parseBooleanInput(req.body.active);

  const created = await ApprovedDomain.create({
    _id: createId('dom'),
    domain,
    label: String(req.body.label || '').trim(),
    category,
    order: order ?? 0,
    active: activeValue ?? true,
    createdBy: req.auth.user._id
  });

  invalidateApprovedDomainCache();

  await logAudit({
    adminId: req.auth.user._id,
    action: 'approved_domain.create',
    meta: { domainId: created._id, domain: created.domain }
  });

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Approved domain created successfully',
    data: serializeApprovedDomain(created.toObject())
  });
});

/**
 * Admin: PATCH /api/v1/admin/approved-domains/:domainId
 * Covers rename, recategorise, reorder and the enable/disable toggle.
 */
export const updateApprovedDomain = catchAsync(async (req, res) => {
  const doc = await ApprovedDomain.findById(req.params.domainId);
  if (!doc) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Approved domain not found');
  }

  if (req.body.domain !== undefined) {
    const domain = assertValidDomain(req.body.domain);
    if (domain !== doc.domain) {
      const clash = await ApprovedDomain.findOne({
        domain,
        _id: { $ne: doc._id }
      }).lean();
      if (clash) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          `${domain} is already in the approved list`
        );
      }
    }
    doc.domain = domain;
  }

  if (req.body.label !== undefined) {
    doc.label = String(req.body.label).trim();
  }

  if (req.body.category !== undefined) {
    doc.category = assertValidCategory(req.body.category, doc.category);
  }

  if (req.body.order !== undefined) {
    const order = parseIntegerInput(req.body.order);
    if (order !== undefined) doc.order = order;
  }

  if (req.body.active !== undefined) {
    const activeValue = parseBooleanInput(req.body.active);
    if (activeValue !== undefined) doc.active = activeValue;
  }

  await doc.save();
  invalidateApprovedDomainCache();

  await logAudit({
    adminId: req.auth.user._id,
    action: 'approved_domain.update',
    meta: { domainId: doc._id, domain: doc.domain, active: doc.active }
  });

  sendSuccess(res, {
    message: 'Approved domain updated successfully',
    data: serializeApprovedDomain(doc.toObject())
  });
});

/**
 * Admin: DELETE /api/v1/admin/approved-domains/:domainId
 */
export const deleteApprovedDomain = catchAsync(async (req, res) => {
  const deleted = await ApprovedDomain.findByIdAndDelete(req.params.domainId);
  if (!deleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Approved domain not found');
  }

  invalidateApprovedDomainCache();

  await logAudit({
    adminId: req.auth.user._id,
    action: 'approved_domain.delete',
    meta: { domainId: deleted._id, domain: deleted.domain }
  });

  sendSuccess(res, { message: 'Approved domain deleted successfully' });
});
