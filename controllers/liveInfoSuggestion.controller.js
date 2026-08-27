import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import { createId } from '../lib/id.js';
import LiveInfoSuggestion, {
  SUGGESTION_KINDS,
  normalizeLocationPlaceholder
} from '../models/liveInfoSuggestion.model.js';
import { logAudit } from '../services/audit.service.js';
import {
  ensureSupportedLanguage,
  normalizeLanguageCode
} from '../services/language.service.js';
import {
  parseBooleanInput,
  parseIntegerInput
} from '../utils/requestParsers.js';

/**
 * Rows written before `kind` existed are all Live Information buttons, so an
 * absent value reads as 'live_info' rather than as a validation error.
 */
const normalizeKind = (value, fallback = 'live_info') => {
  const kind = String(value || '').trim();
  return SUGGESTION_KINDS.includes(kind) ? kind : fallback;
};

export const serializeLiveInfoSuggestion = (doc) => ({
  id: doc._id,
  title: doc.title,
  prompt: normalizeLocationPlaceholder(doc.prompt),
  icon: doc.icon || '',
  kind: normalizeKind(doc.kind),
  requiresLocation: doc.requiresLocation === true,
  language: normalizeLanguageCode(doc.language, 'en'),
  order: doc.order ?? 0,
  active: doc.active !== false,
  createdBy: doc.createdBy || null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt
});

/**
 * Active rows of one kind for one language, ordered. Used by GET /chat/config.
 *
 * The `kind` filter accepts the legacy documents that predate the field: they
 * were all Live Information buttons, so they are matched when that is what was
 * asked for and ignored otherwise.
 */
export const listActiveLiveInfoSuggestions = async (
  language,
  kind = 'live_info'
) => {
  const lang = normalizeLanguageCode(language, 'en');
  const wanted = normalizeKind(kind);
  const kindFilter =
    wanted === 'live_info'
      ? { $in: [null, 'live_info'] }
      : wanted;

  return LiveInfoSuggestion.find({
    language: lang,
    active: true,
    kind: kindFilter
  })
    .sort({ order: 1, createdAt: 1 })
    .lean();
};

/**
 * Admin: GET /api/v1/admin/live-info-suggestions?language=&active=
 */
export const listAdminLiveInfoSuggestions = catchAsync(async (req, res) => {
  const filter = {};

  const requestedLanguage = String(req.query.language || '').trim();
  if (requestedLanguage) {
    filter.language = normalizeLanguageCode(requestedLanguage, 'en');
  }

  const activeFilter = parseBooleanInput(req.query.active);
  if (activeFilter !== undefined && req.query.active !== undefined) {
    filter.active = activeFilter;
  }

  const requestedKind = String(req.query.kind || '').trim();
  if (requestedKind) {
    filter.kind =
      normalizeKind(requestedKind) === 'live_info'
        ? { $in: [null, 'live_info'] }
        : normalizeKind(requestedKind);
  }

  const suggestions = await LiveInfoSuggestion.find(filter)
    .sort({ kind: 1, language: 1, order: 1, createdAt: 1 })
    .lean();

  sendSuccess(res, {
    message: 'Live information suggestions fetched successfully',
    data: suggestions.map(serializeLiveInfoSuggestion)
  });
});

/**
 * Admin: POST /api/v1/admin/live-info-suggestions
 */
export const createLiveInfoSuggestion = catchAsync(async (req, res) => {
  const title = String(req.body.title || '').trim();
  const prompt = normalizeLocationPlaceholder(req.body.prompt).trim();

  if (!title) throw new ApiError(StatusCodes.BAD_REQUEST, 'title is required');
  if (!prompt) throw new ApiError(StatusCodes.BAD_REQUEST, 'prompt is required');

  const order = parseIntegerInput(req.body.order);
  const activeValue = parseBooleanInput(req.body.active);

  const requiresLocation = parseBooleanInput(req.body.requiresLocation);

  const created = await LiveInfoSuggestion.create({
    _id: createId('lis'),
    title,
    prompt,
    icon: String(req.body.icon || '').trim(),
    kind: normalizeKind(req.body.kind),
    requiresLocation: requiresLocation ?? false,
    language: ensureSupportedLanguage(req.body.language ?? 'en'),
    order: order ?? 0,
    active: activeValue ?? true,
    createdBy: req.auth.user._id
  });

  await logAudit({
    adminId: req.auth.user._id,
    action: 'live_info_suggestion.create',
    meta: { suggestionId: created._id, title: created.title }
  });

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Live information suggestion created successfully',
    data: serializeLiveInfoSuggestion(created.toObject())
  });
});

/**
 * Admin: PATCH /api/v1/admin/live-info-suggestions/:suggestionId
 * Supports reordering and the enable/disable toggle along with content edits.
 */
export const updateLiveInfoSuggestion = catchAsync(async (req, res) => {
  const doc = await LiveInfoSuggestion.findById(req.params.suggestionId);
  if (!doc) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Live information suggestion not found'
    );
  }

  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'title cannot be empty');
    }
    doc.title = title;
  }

  if (req.body.prompt !== undefined) {
    const prompt = normalizeLocationPlaceholder(req.body.prompt).trim();
    if (!prompt) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'prompt cannot be empty');
    }
    doc.prompt = prompt;
  }

  if (req.body.icon !== undefined) {
    doc.icon = String(req.body.icon).trim();
  }

  if (req.body.kind !== undefined) {
    doc.kind = normalizeKind(req.body.kind, doc.kind);
  }

  if (req.body.requiresLocation !== undefined) {
    const requiresLocation = parseBooleanInput(req.body.requiresLocation);
    if (requiresLocation !== undefined) doc.requiresLocation = requiresLocation;
  }

  if (req.body.language !== undefined) {
    doc.language = ensureSupportedLanguage(req.body.language);
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

  await logAudit({
    adminId: req.auth.user._id,
    action: 'live_info_suggestion.update',
    meta: { suggestionId: doc._id, title: doc.title, active: doc.active }
  });

  sendSuccess(res, {
    message: 'Live information suggestion updated successfully',
    data: serializeLiveInfoSuggestion(doc.toObject())
  });
});

/**
 * Admin: DELETE /api/v1/admin/live-info-suggestions/:suggestionId
 */
export const deleteLiveInfoSuggestion = catchAsync(async (req, res) => {
  const deleted = await LiveInfoSuggestion.findByIdAndDelete(
    req.params.suggestionId
  );
  if (!deleted) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Live information suggestion not found'
    );
  }

  await logAudit({
    adminId: req.auth.user._id,
    action: 'live_info_suggestion.delete',
    meta: { suggestionId: deleted._id, title: deleted.title }
  });

  sendSuccess(res, {
    message: 'Live information suggestion deleted successfully'
  });
});
