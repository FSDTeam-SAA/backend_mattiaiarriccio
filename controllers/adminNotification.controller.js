import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess, parsePagination } from '../utils/response.js';
import { createId } from '../lib/id.js';
import NotificationJob from '../models/notificationJob.model.js';
import NotificationTemplate from '../models/notificationTemplate.model.js';
import User from '../models/user.model.js';
import Category from '../models/category.model.js';
import Material from '../models/material.model.js';
import Checklist from '../models/checklist.model.js';
import { notifyUser } from '../services/notify.service.js';
import { sendReminderEmail } from '../services/email.service.js';
import { logAudit } from '../services/audit.service.js';

const VALID_STATUSES = new Set(['pending', 'sent', 'canceled', 'failed']);
const VALID_TYPES = new Set([
  'material_expiry',
  'inspection',
  'checklist_item',
  'premium_expiry',
  'custom'
]);
const VALID_CHANNELS = new Set(['push', 'local', 'email']);
const ADMIN_SEND_CHANNELS = new Set(['push', 'email']);
const AUDIENCE_TYPES = new Set(['all', 'free', 'premium', 'category']);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const normalizeAudience = (body = {}, fallback = { type: 'all', categorySlug: '' }) => {
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

  return {
    type,
    categorySlug: type === 'category' ? categorySlug : ''
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

  if (audience.type === 'free' || audience.type === 'premium') {
    return User.find({ ...baseFilter, tier: audience.type })
      .select('_id fullName email notificationsEnabled')
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

const createJobRecord = async ({
  userId,
  title,
  body,
  channel,
  status = 'sent',
  error = '',
  sentAt = new Date()
}) =>
  NotificationJob.create({
    _id: createId('notifjob'),
    userId,
    type: 'custom',
    title,
    body,
    scheduledAt: new Date(),
    channel,
    status,
    sentAt,
    error
  });

const deliverToUser = async ({ user, title, body, channel }) => {
  if (user.notificationsEnabled === false) {
    await createJobRecord({
      userId: user._id,
      title,
      body,
      channel,
      error: `${channel} skipped: user opted out`
    });
    return { sent: 0, skipped: 1, failed: 0 };
  }

  try {
    if (channel === 'push') {
      const result = await notifyUser(user._id, {
        title,
        body,
        type: 'custom',
        data: { type: 'custom', screen: 'notifications' }
      });
      await createJobRecord({
        userId: user._id,
        title,
        body,
        channel,
        error: result?.skipped ? `push skipped: ${result.reason || 'unknown'}` : ''
      });
      return result?.skipped
        ? { sent: 0, skipped: 1, failed: 0 }
        : { sent: 1, skipped: 0, failed: 0 };
    }

    const result = await sendReminderEmail({
      toEmail: user.email,
      toName: user.fullName,
      title,
      body
    });
    await createJobRecord({
      userId: user._id,
      title,
      body,
      channel,
      error: result?.skipped ? `email skipped: ${result.reason || 'unknown'}` : ''
    });
    return result?.skipped
      ? { sent: 0, skipped: 1, failed: 0 }
      : { sent: 1, skipped: 0, failed: 0 };
  } catch (error) {
    await createJobRecord({
      userId: user._id,
      title,
      body,
      channel,
      status: 'failed',
      error: String(error?.message || error).slice(0, 500),
      sentAt: null
    });
    return { sent: 0, skipped: 0, failed: 1 };
  }
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
  const audience = normalizeAudience(req.body, template?.audience || { type: 'all', categorySlug: '' });

  if (!title) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Notification title is required');
  }
  if (!body) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Notification message is required');
  }

  const users = await resolveAudienceUsers(audience);
  const summary = {
    recipients: users.length,
    channels,
    audience,
    push: { sent: 0, skipped: 0, failed: 0 },
    email: { sent: 0, skipped: 0, failed: 0 }
  };

  for (const user of users) {
    for (const channel of channels) {
      const result = await deliverToUser({ user, title, body, channel });
      summary[channel].sent += result.sent;
      summary[channel].skipped += result.skipped;
      summary[channel].failed += result.failed;
    }
  }

  await logAudit({
    adminId,
    action: 'notification.send',
    meta: {
      templateId,
      title,
      channels,
      audience,
      recipients: users.length,
      summary
    }
  });

  sendSuccess(res, {
    message:
      users.length === 0
        ? 'No users matched this notification audience'
        : 'Notification sent successfully',
    data: summary
  });
});
