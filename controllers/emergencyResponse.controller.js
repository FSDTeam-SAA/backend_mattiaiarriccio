import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import { createId } from '../lib/id.js';
import EmergencyResponse from '../models/emergencyResponse.model.js';
import { listActiveEmergencyResponses } from '../services/emergency.service.js';
import { logAudit } from '../services/audit.service.js';
import {
  normalizeEmergencyPlaybook,
  normalizeIntentKey,
  routeEmergencyResponse
} from '../services/emergency.service.js';
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

const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const RESPONSE_MODES = new Set([
  'stored_high_confidence',
  'ai_with_context',
  'ai_only'
]);
const FOLLOW_UP_POLICIES = new Set([
  'ai_when_needed',
  'always_ai',
  'stored_only'
]);

const serializeEmergencyResponse = (response) => {
  const playbook = normalizeEmergencyPlaybook(response);

  return {
    id: playbook._id,
    title: playbook.title,
    category: playbook.category || '',
    triggerKeywords: playbook.triggerKeywords,
    matchPhrases: playbook.matchPhrases,
    negativeKeywords: playbook.negativeKeywords,
    responseTemplate: playbook.responseTemplate,
    language: normalizeLanguageCode(playbook.language, 'en'),
    intentKey: playbook.intentKey,
    severity: playbook.severity,
    responseMode: playbook.responseMode,
    followUpPolicy: playbook.followUpPolicy,
    aiContext: playbook.aiContext,
    order: playbook.order ?? 0,
    active: playbook.active !== false,
    createdBy: response.createdBy || null,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt
  };
};

const normalizeTriggerKeywords = (input) => {
  const parsed = parseArrayInput(input);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((keyword) => String(keyword).trim())
    .filter(Boolean);
};

const normalizeStringArray = normalizeTriggerKeywords;

const enumValue = (value, allowed, fallback) => {
  const normalized = String(value || '').trim();
  return allowed.has(normalized) ? normalized : fallback;
};

const buildEmergencyPayload = (body, { existing = null } = {}) => {
  const title = String(body.title ?? existing?.title ?? '').trim();
  const category = String(body.category ?? existing?.category ?? '').trim();
  const intentInput = String(body.intentKey ?? existing?.intentKey ?? '').trim();

  return {
    title,
    category,
    triggerKeywords:
      body.triggerKeywords !== undefined
        ? normalizeStringArray(body.triggerKeywords)
        : normalizeStringArray(existing?.triggerKeywords),
    matchPhrases:
      body.matchPhrases !== undefined
        ? normalizeStringArray(body.matchPhrases)
        : normalizeStringArray(existing?.matchPhrases),
    negativeKeywords:
      body.negativeKeywords !== undefined
        ? normalizeStringArray(body.negativeKeywords)
        : normalizeStringArray(existing?.negativeKeywords),
    responseTemplate: String(
      body.responseTemplate ?? existing?.responseTemplate ?? ''
    ).trim(),
    language: ensureSupportedLanguage(body.language ?? existing?.language ?? 'en'),
    intentKey: intentInput
      ? normalizeIntentKey(intentInput)
      : normalizeIntentKey(category || title),
    severity: enumValue(body.severity ?? existing?.severity, SEVERITIES, 'medium'),
    responseMode: enumValue(
      body.responseMode ?? existing?.responseMode,
      RESPONSE_MODES,
      'stored_high_confidence'
    ),
    followUpPolicy: enumValue(
      body.followUpPolicy ?? existing?.followUpPolicy,
      FOLLOW_UP_POLICIES,
      'ai_when_needed'
    ),
    aiContext: String(body.aiContext ?? existing?.aiContext ?? '').trim()
  };
};

const serializeRoutingPreview = (decision) => ({
  routingSource: decision.source,
  routingConfidence: decision.confidence,
  matchedPlaybookId: decision.matchedPlaybookId || '',
  matchedPlaybookTitle: decision.matchedPlaybook?.title || '',
  routingReason: decision.reason,
  followUp: Boolean(decision.followUp),
  topMatches: decision.scores || []
});

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
  const payload = buildEmergencyPayload(req.body);
  if (!payload.title) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'title is required');
  }

  if (!payload.responseTemplate) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'responseTemplate is required');
  }

  const order = parseIntegerInput(req.body.order);
  const activeValue = parseBooleanInput(req.body.active);

  const response = await EmergencyResponse.create({
    _id: createId('emergency'),
    ...payload,
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
  }

  if (req.body.responseTemplate !== undefined && !String(req.body.responseTemplate).trim()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'responseTemplate cannot be empty'
    );
  }

  const payload = buildEmergencyPayload(req.body, { existing: response });
  Object.assign(response, payload);

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
 * Admin: POST /api/v1/admin/emergency-responses/preview-route
 * Tests how a draft/current playbook would route a sample user message.
 */
export const previewEmergencyRoute = catchAsync(async (req, res) => {
  const text = String(req.body.text || req.body.message || '').trim();
  if (!text) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'text is required');
  }

  const draftInput = req.body.playbook || req.body.draft || null;
  const extraResponses = [];

  if (draftInput && typeof draftInput === 'object') {
    const payload = buildEmergencyPayload(
      {
        ...draftInput,
        title: draftInput.title || 'Draft playbook',
        responseTemplate:
          draftInput.responseTemplate || 'Draft emergency response'
      },
      {}
    );
    extraResponses.push({
      _id: draftInput.id || draftInput._id || 'draft',
      ...payload,
      order: parseIntegerInput(draftInput.order) ?? -1,
      active: true
    });
  }

  const decision = await routeEmergencyResponse({
    text,
    language: req.body.language || draftInput?.language,
    emergencyType: req.body.emergencyType || draftInput?.category || draftInput?.title,
    extraResponses
  });

  sendSuccess(res, {
    message: 'Emergency route preview generated successfully',
    data: serializeRoutingPreview(decision)
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
