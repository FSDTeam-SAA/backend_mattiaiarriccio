import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import { createId } from '../lib/id.js';
import EmergencyResponse from '../models/emergencyResponse.model.js';
import { listActiveEmergencyResponses } from '../services/emergency.service.js';
import { logAudit } from '../services/audit.service.js';
import {
  resolveRequestLanguage,
  ensureSupportedLanguage,
  normalizeLanguageCode
} from '../services/language.service.js';
import {
  parseArrayInput,
  parseBooleanInput,
  parseIntegerInput
} from '../utils/requestParsers.js';

const serializeEmergencyResponse = (response) => ({
  id: response._id,
  title: response.title,
  category: response.category || '',
  triggerKeywords: Array.isArray(response.triggerKeywords)
    ? response.triggerKeywords
    : [],
  responseTemplate: response.responseTemplate,
  language: normalizeLanguageCode(response.language, 'en'),
  order: response.order ?? 0,
  active: response.active !== false,
  createdBy: response.createdBy || null,
  createdAt: response.createdAt,
  updatedAt: response.updatedAt
});

const normalizeTriggerKeywords = (input) => {
  const parsed = parseArrayInput(input);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((keyword) => String(keyword).trim())
    .filter(Boolean);
};

/**
 * Public/user-facing: GET /api/v1/emergency-responses?category=&language=
 * Returns ONLY active responses, ordered by 'order'.
 */
export const listEmergencyResponses = catchAsync(async (req, res) => {
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const responses = await listActiveEmergencyResponses({
    category: req.query.category,
    language
  });

  sendSuccess(res, {
    message: 'Emergency responses fetched successfully',
    data: responses.map(serializeEmergencyResponse)
  });
});

/**
 * Admin: GET /api/v1/admin/emergency-responses?category=&language=&active=
 * Returns all responses (active + inactive), ordered.
 */
export const listAdminEmergencyResponses = catchAsync(async (req, res) => {
  const filter = {};

  const requestedLanguage = String(req.query.language || '').trim();
  if (requestedLanguage) {
    filter.language = normalizeLanguageCode(requestedLanguage, 'en');
  }

  const requestedCategory = String(req.query.category || '').trim();
  if (requestedCategory) {
    filter.category = requestedCategory;
  }

  const activeFilter = parseBooleanInput(req.query.active);
  if (activeFilter !== undefined && req.query.active !== undefined) {
    filter.active = activeFilter;
  }

  const responses = await EmergencyResponse.find(filter)
    .sort({ order: 1, createdAt: 1 })
    .lean();

  sendSuccess(res, {
    message: 'Admin emergency responses fetched successfully',
    data: responses.map(serializeEmergencyResponse)
  });
});

/**
 * Admin: POST /api/v1/admin/emergency-responses
 */
export const createEmergencyResponse = catchAsync(async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'title is required');
  }

  const responseTemplate = String(req.body.responseTemplate || '').trim();
  if (!responseTemplate) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'responseTemplate is required');
  }

  const order = parseIntegerInput(req.body.order);
  const activeValue = parseBooleanInput(req.body.active);

  const response = await EmergencyResponse.create({
    _id: createId('emergency'),
    title,
    category: String(req.body.category || '').trim(),
    triggerKeywords: normalizeTriggerKeywords(req.body.triggerKeywords),
    responseTemplate,
    language: ensureSupportedLanguage(req.body.language || 'en'),
    order: order ?? 0,
    active: activeValue ?? true,
    createdBy: req.auth.user._id
  });

  await logAudit({
    adminId: req.auth.user._id,
    action: 'emergency_response.create',
    meta: { emergencyResponseId: response._id, title: response.title }
  });

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Emergency response created successfully',
    data: serializeEmergencyResponse(response.toObject())
  });
});

/**
 * Admin: PATCH /api/v1/admin/emergency-responses/:emergencyResponseId
 * Supports reordering (order) and active toggle along with content edits.
 */
export const updateEmergencyResponse = catchAsync(async (req, res) => {
  const response = await EmergencyResponse.findById(
    req.params.emergencyResponseId
  );

  if (!response) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Emergency response not found');
  }

  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'title cannot be empty');
    }
    response.title = title;
  }

  if (req.body.category !== undefined) {
    response.category = String(req.body.category).trim();
  }

  if (req.body.triggerKeywords !== undefined) {
    response.triggerKeywords = normalizeTriggerKeywords(req.body.triggerKeywords);
  }

  if (req.body.responseTemplate !== undefined) {
    const responseTemplate = String(req.body.responseTemplate).trim();
    if (!responseTemplate) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'responseTemplate cannot be empty'
      );
    }
    response.responseTemplate = responseTemplate;
  }

  if (req.body.language !== undefined) {
    response.language = ensureSupportedLanguage(req.body.language);
  }

  if (req.body.order !== undefined) {
    const order = parseIntegerInput(req.body.order);
    if (order !== undefined) {
      response.order = order;
    }
  }

  if (req.body.active !== undefined) {
    const activeValue = parseBooleanInput(req.body.active);
    if (activeValue !== undefined) {
      response.active = activeValue;
    }
  }

  await response.save();

  await logAudit({
    adminId: req.auth.user._id,
    action: 'emergency_response.update',
    meta: {
      emergencyResponseId: response._id,
      order: response.order,
      active: response.active
    }
  });

  sendSuccess(res, {
    message: 'Emergency response updated successfully',
    data: serializeEmergencyResponse(response.toObject())
  });
});

/**
 * Admin: DELETE /api/v1/admin/emergency-responses/:emergencyResponseId
 */
export const deleteEmergencyResponse = catchAsync(async (req, res) => {
  const response = await EmergencyResponse.findByIdAndDelete(
    req.params.emergencyResponseId
  );

  if (!response) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Emergency response not found');
  }

  await logAudit({
    adminId: req.auth.user._id,
    action: 'emergency_response.delete',
    meta: { emergencyResponseId: response._id, title: response.title }
  });

  sendSuccess(res, {
    message: 'Emergency response deleted successfully'
  });
});
