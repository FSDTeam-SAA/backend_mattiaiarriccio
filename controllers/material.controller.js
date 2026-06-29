import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import Material from '../models/material.model.js';
import { createId } from '../lib/id.js';
import { resolveImageUrl } from '../services/media.service.js';
import { sendSuccess } from '../utils/response.js';
import {
  parseArrayInput,
  parseIntegerInput
} from '../utils/requestParsers.js';
import {
  syncForMaterial,
  cancelForMaterial
} from '../services/reminder.service.js';
import { isPremiumUser } from '../services/premium.service.js';
import { getSetting } from '../services/settings.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parseDateInput = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `${fieldName} is not a valid date`);
  }

  return date;
};

const normalizeReminderRules = (input) => {
  const parsed = parseArrayInput(input);

  if (parsed === undefined) {
    return undefined;
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((rule) => {
      if (rule === null || typeof rule !== 'object') {
        return null;
      }
      const offsetDays = parseIntegerInput(rule.offsetDays);
      const channel = rule.channel === 'push' ? 'push' : 'local';
      return {
        offsetDays: offsetDays === undefined ? 0 : offsetDays,
        channel
      };
    })
    .filter((rule) => rule !== null);
};

/**
 * Recompute inspection.nextInspectionAt from the interval and last-inspected
 * date. Returns the inspection sub-document object (never mutates in place).
 */
const computeInspection = ({ intervalDays, lastInspectedAt }) => {
  const interval = intervalDays;
  const last = lastInspectedAt || null;

  if (!interval || interval <= 0) {
    return {
      intervalDays: interval && interval > 0 ? interval : null,
      lastInspectedAt: last,
      nextInspectionAt: null
    };
  }

  const base = last ? new Date(last) : new Date();
  const nextInspectionAt = new Date(base.getTime() + interval * MS_PER_DAY);

  return {
    intervalDays: interval,
    lastInspectedAt: last,
    nextInspectionAt
  };
};

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

const findOwnedMaterial = async (materialId, userId) => {
  const material = await Material.findOne({ _id: materialId, userId });

  if (!material) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Material not found');
  }

  return material;
};

export const createMaterial = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const name = String(req.body.name || '').trim();

  if (!name) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'name is required');
  }

  const accessRules = await getSetting('accessRules');
  const maxFreeMaterials = Number(accessRules?.maxFreeMaterials ?? 0);
  if (!isPremiumUser(req.auth.user) && maxFreeMaterials > 0) {
    const existingCount = await Material.countDocuments({ userId });
    if (existingCount >= maxFreeMaterials) {
      const err = new ApiError(
        StatusCodes.FORBIDDEN,
        'Upgrade to premium to track more materials'
      );
      err.code = 'PREMIUM_REQUIRED';
      throw err;
    }
  }

  const imageUrl = await resolveImageUrl({
    req,
    folder: 'materials',
    fieldNames: ['image', 'imageFile', 'imageUrl'],
    bodyValue: req.body.imageUrl,
    removeKey: 'removeImageUrl',
    defaultValue: ''
  });

  // Accept inspection fields as a nested object (JSON clients), a dotted key
  // (some multipart clients), or a flat key.
  const nestedInspection =
    req.body.inspection && typeof req.body.inspection === 'object'
      ? req.body.inspection
      : {};
  const expirationDate = parseDateInput(req.body.expirationDate, 'expirationDate');
  const lastInspectedAt = parseDateInput(
    req.body['inspection.lastInspectedAt'] ??
      nestedInspection.lastInspectedAt ??
      req.body.lastInspectedAt,
    'inspection.lastInspectedAt'
  );
  const intervalDays = parseIntegerInput(
    req.body['inspection.intervalDays'] ??
      nestedInspection.intervalDays ??
      req.body.intervalDays
  );
  const reminderRules = normalizeReminderRules(req.body.reminderRules) || [];

  const inspection = computeInspection({
    intervalDays: intervalDays ?? null,
    lastInspectedAt
  });

  const material = await Material.create({
    _id: createId('material'),
    userId,
    name,
    category: String(req.body.category || '').trim(),
    imageUrl,
    expirationDate,
    inspection,
    reminderRules,
    active: true
  });

  await syncForMaterial(material.toObject());

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Material created successfully',
    data: formatMaterial(material.toObject())
  });
});

export const listMaterials = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const materials = await Material.find({ userId })
    .sort({ expirationDate: 1, createdAt: -1 })
    .lean();

  sendSuccess(res, {
    message: 'Materials fetched successfully',
    data: materials.map((material) => formatMaterial(material))
  });
});

export const getMaterial = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const material = await Material.findOne({
    _id: req.params.materialId,
    userId
  }).lean();

  if (!material) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Material not found');
  }

  sendSuccess(res, {
    message: 'Material fetched successfully',
    data: formatMaterial(material)
  });
});

export const updateMaterial = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const material = await findOwnedMaterial(req.params.materialId, userId);

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'name cannot be empty');
    }
    material.name = name;
  }

  if (req.body.category !== undefined) {
    material.category = String(req.body.category).trim();
  }

  material.imageUrl = await resolveImageUrl({
    req,
    folder: 'materials',
    fieldNames: ['image', 'imageFile', 'imageUrl'],
    bodyValue: req.body.imageUrl,
    removeKey: 'removeImageUrl',
    currentValue: material.imageUrl
  });

  if (req.body.expirationDate !== undefined) {
    material.expirationDate = parseDateInput(
      req.body.expirationDate,
      'expirationDate'
    );
  }

  const reminderRules = normalizeReminderRules(req.body.reminderRules);
  if (reminderRules !== undefined) {
    material.reminderRules = reminderRules;
  }

  const nestedInspection =
    req.body.inspection && typeof req.body.inspection === 'object'
      ? req.body.inspection
      : {};
  const intervalRaw =
    req.body['inspection.intervalDays'] ??
    nestedInspection.intervalDays ??
    req.body.intervalDays;
  const lastInspectedRaw =
    req.body['inspection.lastInspectedAt'] ??
    nestedInspection.lastInspectedAt ??
    req.body.lastInspectedAt;

  const intervalProvided = intervalRaw !== undefined;
  const lastInspectedProvided = lastInspectedRaw !== undefined;

  if (intervalProvided || lastInspectedProvided) {
    const intervalDays = intervalProvided
      ? parseIntegerInput(intervalRaw) ?? null
      : material.inspection?.intervalDays ?? null;
    const lastInspectedAt = lastInspectedProvided
      ? parseDateInput(lastInspectedRaw, 'inspection.lastInspectedAt')
      : material.inspection?.lastInspectedAt ?? null;

    material.inspection = computeInspection({ intervalDays, lastInspectedAt });
  }

  if (req.body.active !== undefined) {
    material.active = Boolean(
      req.body.active === true ||
        req.body.active === 'true' ||
        req.body.active === '1'
    );
  }

  await material.save();

  await syncForMaterial(material.toObject());

  sendSuccess(res, {
    message: 'Material updated successfully',
    data: formatMaterial(material.toObject())
  });
});

export const deleteMaterial = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const material = await Material.findOneAndDelete({
    _id: req.params.materialId,
    userId
  });

  if (!material) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Material not found');
  }

  await cancelForMaterial(material._id);

  sendSuccess(res, {
    message: 'Material deleted successfully'
  });
});

export const markInspected = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const material = await findOwnedMaterial(req.params.materialId, userId);

  const now = new Date();
  const intervalDays = material.inspection?.intervalDays ?? null;

  material.inspection = computeInspection({
    intervalDays,
    lastInspectedAt: now
  });

  await material.save();

  await syncForMaterial(material.toObject());

  sendSuccess(res, {
    message: 'Material marked as inspected',
    data: formatMaterial(material.toObject())
  });
});
