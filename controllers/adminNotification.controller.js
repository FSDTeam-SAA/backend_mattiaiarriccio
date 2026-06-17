import catchAsync from '../utils/catchAsync.js';
import NotificationJob from '../models/notificationJob.model.js';
import { sendSuccess, parsePagination } from '../utils/response.js';

const VALID_STATUSES = new Set(['pending', 'sent', 'canceled', 'failed']);
const VALID_TYPES = new Set(['material_expiry', 'inspection', 'custom']);
const VALID_CHANNELS = new Set(['push', 'local']);

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

/**
 * Read-only oversight of the notification engine. Admin can monitor the queue,
 * filter by status/type/channel, and page through results (DB-level pagination).
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
