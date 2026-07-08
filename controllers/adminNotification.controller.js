import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess, parsePagination } from '../utils/response.js';
import { createId } from '../lib/id.js';
import NotificationJob from '../models/notificationJob.model.js';
import NotificationTemplate from '../models/notificationTemplate.model.js';
import NotificationCampaign from '../models/notificationCampaign.model.js';
import User from '../models/user.model.js';
import Category from '../models/category.model.js';
import Material from '../models/material.model.js';
import Checklist from '../models/checklist.model.js';
import { requeueJob, dispatchDueJobs } from '../services/reminder.service.js';
import { logAudit } from '../services/audit.service.js';

const VALID_STATUSES = new Set(['pending', 'sent', 'skipped', 'canceled', 'failed']);
const VALID_TYPES = new Set([
  'material_expiry',
  'inspection',
  'checklist_item',
  'premium_expiry',
  'premium',
  'custom'
]);
const VALID_CHANNELS = new Set(['push', 'local', 'email']);
const ADMIN_SEND_CHANNELS = new Set(['push', 'email']);
const AUDIENCE_TYPES = new Set(['all', 'free', 'premium', 'category', 'specific']);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Substitute supported {{variables}} in an admin notification with the
 * recipient's data. Unknown placeholders are left untouched; missing values
 * render as empty strings. Applies to both push and email copy.
 *   {{name}} {{email}} {{expiryDate}} {{daysRemaining}} {{planName}}
 */
const renderTemplateVars = (text, user = {}) => {
  const source = String(text || '');
  if (!source.includes('{{')) return source;

  const expiry = user.premiumExpiresAt ? new Date(user.premiumExpiresAt) : null;
  const daysRemaining =
    expiry && !Number.isNaN(expiry.getTime())
      ? Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / MS_PER_DAY))
      : '';

  const values = {
    name: user.fullName || '',
    email: user.email || '',
    expiryDate: expiry && !Number.isNaN(expiry.getTime()) ? expiry.toISOString().slice(0, 10) : '',
    daysRemaining: daysRemaining === '' ? '' : String(daysRemaining),
    planName: user.tier === 'premium' ? 'Premium' : 'Free'
  };

  return source.replace(
    /\{\{\s*(name|email|expiryDate|daysRemaining|planName)\s*\}\}/g,
    (_, key) => values[key] ?? ''
  );
};

const formatJob = (job) => ({
  id: job._id,
  userId: job.userId,
  type: job.type,
  refId: job.refId || null,
  title: job.title,
  body: job.body || '',
  scheduledAt: job.scheduledAt,
  channel: job.channel,
  status: job.status,
  sentAt: job.sentAt || null,
  error: job.error || '',
  attempts: job.attempts || 0,
  maxAttempts: job.maxAttempts || 3,
  campaignId: job.campaignId || null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt
});

const formatTemplate = (template) => ({
  id: template._id,
  name: template.name,
  title: template.title,
  body: template.body,
  channels: Array.isArray(template.channels) ? template.channels : ['push'],
  audienceType: template.audience?.type || 'all',
  categorySlug: template.audience?.categorySlug || '',
  createdAt: template.createdAt,
  updatedAt: template.updatedAt
});

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [trimmed];
      }
    }
    return trimmed.split(',').map((item) => item.trim());
  }
  if (value === undefined || value === null) return [];
  return [value];
};

const normalizeChannels = (value, fallback = ['push']) => {
  const requested = parseArray(value).map((item) => String(item || '').trim().toLowerCase());
  const unique = [...new Set((requested.length ? requested : fallback).filter(Boolean))];

  if (unique.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'At least one channel is required');
  }

  const invalid = unique.find((channel) => !ADMIN_SEND_CHANNELS.has(channel));
  if (invalid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Unsupported notification channel: ${invalid}`);
  }

  return unique;
};

const normalizeAudience = (
  body = {},
  fallback = { type: 'all', categorySlug: '' },
  { allowSpecific = false } = {}
) => {
  const rawAudience = body.audience && typeof body.audience === 'object' ? body.audience : {};
  const requestedType =
    body.audienceType ??
    body.targetAudience ??
    rawAudience.type ??
    fallback.type ??
    'all';
  const type = String(requestedType || 'all').trim().toLowerCase();

  if (!AUDIENCE_TYPES.has(type)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid notification audience');
  }

  const categorySlug = String(
    body.categorySlug ?? rawAudience.categorySlug ?? fallback.categorySlug ?? ''
  )
    .trim()
    .toLowerCase();

  if (type === 'category' && !categorySlug) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Category is required for category audience');
  }

  if (type === 'specific') {
    // 'specific' targets an explicit user list — only valid for direct sends,
    // never persisted as a reusable template.
    if (!allowSpecific) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Specific-user audience can only be used when sending, not saved as a template'
      );
    }
    const userIds = [
      ...new Set(
        parseArray(body.userIds ?? body.targetUserIds ?? rawAudience.userIds)
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    ];
    if (userIds.length === 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Select at least one user');
    }
    return { type, categorySlug: '', userIds };
  }

  return {
    type,
    categorySlug: type === 'category' ? categorySlug : '',
    userIds: []
  };
};

const buildCategoryValueQuery = (category) => {
  const values = [
    category.slug,
    category.names?.en,
    category.names?.it
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const uniqueValues = [...new Set(values)];
  return {
    $in: uniqueValues.map((value) => new RegExp(`^${escapeRegExp(value)}$`, 'i'))
  };
};

const resolveAudienceUsers = async (audience) => {
  const baseFilter = { role: 'user' };

  if (audience.type === 'specific') {
    const ids = Array.isArray(audience.userIds) ? audience.userIds : [];
    if (ids.length === 0) return [];
    return User.find({ ...baseFilter, _id: { $in: ids } })
      .select('_id fullName email notificationsEnabled premiumExpiresAt tier')
      .lean();
  }

  if (audience.type === 'free' || audience.type === 'premium') {
    return User.find({ ...baseFilter, tier: audience.type })
      .select('_id fullName email notificationsEnabled premiumExpiresAt tier')
      .lean();
  }

  if (audience.type !== 'category') {
    return User.find(baseFilter).select('_id fullName email notificationsEnabled').lean();
  }

  const category = await Category.findOne({ slug: audience.categorySlug }).lean();
  if (!category) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Selected category was not found');
  }

  const categoryQuery = buildCategoryValueQuery(category);
  const [materialUserIds, checklistOwnerIds] = await Promise.all([
    Material.distinct('userId', { category: categoryQuery }),
    Checklist.distinct('ownerId', {
      type: 'custom',
      category: categoryQuery,
      ownerId: { $nin: [null, ''] }
    })
  ]);

  const userIds = [...new Set([...materialUserIds, ...checklistOwnerIds].filter(Boolean))];
  if (userIds.length === 0) {
    return [];
  }

  return User.find({ ...baseFilter, _id: { $in: userIds } })
    .select('_id fullName email notificationsEnabled')
    .lean();
};

/**
 * Oversight of the notification engine. Admin can monitor the queue,
 * filter by status/type/channel, and page through results.
 */
export const listNotifications = catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query, {
    page: 1,
    limit: 20,
    maxLimit: 100
  });

  const filter = {};

  const status = String(req.query.status || '').trim();
  if (status && VALID_STATUSES.has(status)) {
    filter.status = status;
  }

  const type = String(req.query.type || '').trim();
  if (type && VALID_TYPES.has(type)) {
    filter.type = type;
  }

  const channel = String(req.query.channel || '').trim();
  if (channel && VALID_CHANNELS.has(channel)) {
    filter.channel = channel;
  }

  const userId = String(req.query.userId || '').trim();
  if (userId) {
    filter.userId = userId;
  }

  const [jobs, total] = await Promise.all([
    NotificationJob.find(filter)
      .sort({ scheduledAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationJob.countDocuments(filter)
  ]);

  sendSuccess(res, {
    message: 'Notifications fetched successfully',
    data: jobs.map((job) => formatJob(job)),
    meta: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit)
    }
  });
});

export const listNotificationTemplates = catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query, {
    page: 1,
    limit: 100,
    maxLimit: 100
  });

  const [templates, total] = await Promise.all([
    NotificationTemplate.find({})
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationTemplate.countDocuments({})
  ]);

  sendSuccess(res, {
    message: 'Notification templates fetched successfully',
    data: templates.map((template) => formatTemplate(template)),
    meta: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit)
    }
  });
});

const templatePayloadFromRequest = (req, existing = null) => {
  const fallbackAudience = existing?.audience || { type: 'all', categorySlug: '' };
  const name = String(req.body.name ?? existing?.name ?? '').trim();
  const title = String(req.body.title ?? existing?.title ?? '').trim();
  const body = String(req.body.body ?? req.body.message ?? existing?.body ?? '').trim();
  const channels = normalizeChannels(req.body.channels ?? existing?.channels, existing?.channels || ['push']);
  const audience = normalizeAudience(req.body, fallbackAudience);

  if (!name) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Template name is required');
  }
  if (!title) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Notification title is required');
  }
  if (!body) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Notification message is required');
  }

  return {
    name,
    title,
    body,
    channels,
    audience
  };
};

export const createNotificationTemplate = catchAsync(async (req, res) => {
  const payload = templatePayloadFromRequest(req);
  const adminId = req.auth.user._id;

  const template = await NotificationTemplate.create({
    _id: createId('notiftemplate'),
    ...payload,
    createdBy: adminId,
    updatedBy: adminId
  });

  await logAudit({
    adminId,
    action: 'notification_template.create',
    meta: { templateId: template._id }
  });

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Notification template created successfully',
    data: formatTemplate(template)
  });
});

export const updateNotificationTemplate = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const template = await NotificationTemplate.findById(req.params.templateId);

  if (!template) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification template not found');
  }

  const payload = templatePayloadFromRequest(req, template);
  template.name = payload.name;
  template.title = payload.title;
  template.body = payload.body;
  template.channels = payload.channels;
  template.audience = payload.audience;
  template.updatedBy = adminId;

  await template.save();
  await logAudit({
    adminId,
    action: 'notification_template.update',
    meta: { templateId: template._id }
  });

  sendSuccess(res, {
    message: 'Notification template updated successfully',
    data: formatTemplate(template)
  });
});

export const deleteNotificationTemplate = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const template = await NotificationTemplate.findByIdAndDelete(req.params.templateId).lean();

  if (!template) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification template not found');
  }

  await logAudit({
    adminId,
    action: 'notification_template.delete',
    meta: { templateId: template._id }
  });

  sendSuccess(res, {
    message: 'Notification template deleted successfully'
  });
});

export const sendAdminNotification = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const templateId = req.params.templateId || req.body.templateId || null;
  const template = templateId ? await NotificationTemplate.findById(templateId).lean() : null;

  if (templateId && !template) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification template not found');
  }

  const title = String(req.body.title ?? template?.title ?? '').trim();
  const body = String(req.body.body ?? req.body.message ?? template?.body ?? '').trim();
  const channels = normalizeChannels(req.body.channels ?? template?.channels, template?.channels || ['push']);
  const audience = normalizeAudience(
    req.body,
    template?.audience || { type: 'all', categorySlug: '' },
    { allowSpecific: true }
  );

  if (!title) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Notification title is required');
  }
  if (!body) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Notification message is required');
  }

  const idempotencyKey =
    typeof req.body.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : null;

  const existingSummary = (campaign) => ({
    campaignId: campaign._id,
    recipients: campaign.recipients,
    channels: campaign.channels,
    audience,
    queued: campaign.jobCount,
    idempotent: true
  });

  // Idempotency: a re-submitted send (double click / retry) with the same key
  // resolves to the already-created campaign instead of enqueueing again.
  if (idempotencyKey) {
    const existing = await NotificationCampaign.findOne({ idempotencyKey }).lean();
    if (existing) {
      sendSuccess(res, {
        message: 'Notification already queued',
        data: existingSummary(existing)
      });
      return;
    }
  }

  const users = await resolveAudienceUsers(audience);
  const jobCount = users.length * channels.length;

  // Reserve the campaign first; its unique idempotencyKey guards against a
  // concurrent duplicate request (the loser gets a duplicate-key error and
  // returns the winning campaign).
  let campaign;
  try {
    campaign = await NotificationCampaign.create({
      _id: createId('campaign'),
      idempotencyKey,
      createdBy: adminId,
      title,
      body,
      channels,
      audienceType: audience.type,
      recipients: users.length,
      jobCount,
      status: 'queued'
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await NotificationCampaign.findOne({ idempotencyKey }).lean();
      if (existing) {
        sendSuccess(res, {
          message: 'Notification already queued',
          data: existingSummary(existing)
        });
        return;
      }
    }
    throw error;
  }

  // Queue-based delivery: one pending NotificationJob per (user, channel), with
  // per-recipient template variables resolved up front. The dispatcher applies
  // per-user channel preferences and retry.
  const now = new Date();
  const jobs = [];
  for (const user of users) {
    const renderedTitle = renderTemplateVars(title, user);
    const renderedBody = renderTemplateVars(body, user);
    for (const channel of channels) {
      jobs.push({
        _id: createId('notifjob'),
        userId: user._id,
        type: 'custom',
        refId: null,
        title: renderedTitle,
        body: renderedBody,
        scheduledAt: now,
        channel,
        status: 'pending',
        campaignId: campaign._id
      });
    }
  }

  if (jobs.length > 0) {
    try {
      await NotificationJob.insertMany(jobs);
    } catch (error) {
      await NotificationCampaign.updateOne(
        { _id: campaign._id },
        { $set: { status: 'failed' } }
      );
      throw error;
    }

    // Deliver right away instead of waiting for the ~2-minute scheduler tick, so
    // admin-sent notifications reach users in real time. Fire-and-forget: never
    // block or fail the admin request on delivery.
    dispatchDueJobs().catch((error) =>
      console.error(
        '[adminNotification] immediate dispatch failed:',
        error?.message || error
      )
    );
  }

  await logAudit({
    adminId,
    action: 'notification.send',
    meta: {
      templateId,
      campaignId: campaign._id,
      idempotencyKey,
      title,
      channels,
      audience,
      recipients: users.length,
      queued: jobs.length
    }
  });

  sendSuccess(res, {
    message:
      users.length === 0
        ? 'No users matched this notification audience'
        : 'Notification queued for delivery',
    data: {
      campaignId: campaign._id,
      recipients: users.length,
      channels,
      audience,
      queued: jobs.length
    }
  });
});

/**
 * Re-queue a single job for immediate re-delivery (manual admin retry). Works on
 * failed jobs and, defensively, on any other status.
 */
export const retryNotification = catchAsync(async (req, res) => {
  const job = await requeueJob(req.params.jobId);

  if (!job) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification job not found');
  }

  await logAudit({
    adminId: req.auth.user._id,
    action: 'notification.retry',
    meta: { jobId: job._id }
  });

  sendSuccess(res, {
    message: 'Notification re-queued for delivery',
    data: formatJob(job)
  });
});
