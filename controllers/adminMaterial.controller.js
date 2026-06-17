import catchAsync from '../utils/catchAsync.js';
import Material from '../models/material.model.js';
import { sendSuccess, parsePagination } from '../utils/response.js';
import { parseBooleanInput } from '../utils/requestParsers.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_WINDOW_DAYS = 30;

const formatMaterial = (material) => ({
  id: material._id,
  userId: material.userId,
  name: material.name,
  category: material.category || '',
  imageUrl: material.imageUrl || '',
  expirationDate: material.expirationDate || null,
  inspection: {
    intervalDays: material.inspection?.intervalDays ?? null,
    lastInspectedAt: material.inspection?.lastInspectedAt ?? null,
    nextInspectionAt: material.inspection?.nextInspectionAt ?? null
  },
  reminderRules: (material.reminderRules || []).map((rule) => ({
    offsetDays: rule.offsetDays ?? 0,
    channel: rule.channel || 'local'
  })),
  active: material.active !== false,
  createdAt: material.createdAt,
  updatedAt: material.updatedAt
});

/**
 * Read-only oversight across ALL users' materials (admin). Supports an
 * `expiringSoon` filter = materials whose expirationDate falls within the next
 * 30 days. DB-level pagination.
 */
export const listMaterials = catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query, {
    page: 1,
    limit: 20,
    maxLimit: 100
  });

  const filter = {};

  if (parseBooleanInput(req.query.expiringSoon) === true) {
    const now = new Date();
    const horizon = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * MS_PER_DAY);
    filter.expirationDate = { $gte: now, $lte: horizon };
  }

  const userId = String(req.query.userId || '').trim();
  if (userId) {
    filter.userId = userId;
  }

  const [materials, total] = await Promise.all([
    Material.find(filter)
      .sort({ expirationDate: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Material.countDocuments(filter)
  ]);

  sendSuccess(res, {
    message: 'Materials fetched successfully',
    data: materials.map((material) => formatMaterial(material)),
    meta: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit)
    }
  });
});
