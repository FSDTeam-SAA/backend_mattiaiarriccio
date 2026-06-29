import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import Checklist from '../models/checklist.model.js';
import ChecklistProgress from '../models/checklistProgress.model.js';
import { createId } from '../lib/id.js';
import {
  getManagedCategoryNames,
  getManagedCategoryMap,
  localizedCategoryName,
  resolveManagedCategorySlug
} from '../services/category.service.js';
import {
  ensureSupportedLanguage,
  normalizeLanguageCode,
  resolveRequestLanguage
} from '../services/language.service.js';
import { getUploadedFile, resolveImageUrl } from '../services/media.service.js';
import { isPremiumUser } from '../services/premium.service.js';
import { getSetting } from '../services/settings.service.js';
import { sendSuccess } from '../utils/response.js';
import { parseArrayInput } from '../utils/requestParsers.js';

const parseOptionalDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Multipart/form-data sends every field as a string, so "false" arrives as a
// truthy string. Parse booleans defensively to support both JSON and form data.
const parseBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return fallback;
};

// notificationPreferences may arrive as an object (JSON body) or a JSON-encoded
// string (multipart field). Normalize both into a plain object.
const parseMaybeJson = (value) => {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const normalizeNotificationPreferences = (value = {}) => {
  const prefs = parseMaybeJson(value);
  return {
    push: prefs.push === undefined ? true : parseBoolean(prefs.push, true),
    email: prefs.email === undefined ? false : parseBoolean(prefs.email, false)
  };
};

const mapItemDetails = (item = {}) => ({
  description: String(item.description || '').trim(),
  imageUrl: String(item.imageUrl || item.itemImageUrl || '').trim(),
  expirationDate: parseOptionalDate(item.expirationDate),
  inspectionDate: parseOptionalDate(item.inspectionDate),
  reminderEnabled: parseBoolean(item.reminderEnabled, false),
  reminderDaysBefore:
    Number.isFinite(Number(item.reminderDaysBefore)) && Number(item.reminderDaysBefore) >= 0
      ? Math.round(Number(item.reminderDaysBefore))
      : 7,
  notificationPreferences: normalizeNotificationPreferences(item.notificationPreferences || {})
});

const normalizeItems = (items = []) =>
  items
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
        _id: createId('item'),
        text: item.trim(),
        order: index + 1,
        icon: '',
        ...mapItemDetails()
      };
    }

      return {
        _id: item._id || item.id || createId('item'),
        text: String(item.text || '').trim(),
        order: Number.isFinite(item.order) ? item.order : index + 1,
        icon: String(item.icon || '').trim(),
        ...mapItemDetails(item)
      };
    })
    .filter((item) => item.text);

const isSharedChecklist = (checklist) =>
  checklist && checklist.status === 'published' && !checklist.ownerId;

const userCanAccessChecklist = (checklist, userId) =>
  checklist && (isSharedChecklist(checklist) || checklist.ownerId === userId);

const userCanEditChecklist = (checklist, userId) =>
  checklist && checklist.type === 'custom' && checklist.ownerId === userId;

const isChecklistHiddenForUser = (checklist, progress) =>
  isSharedChecklist(checklist) && Boolean(progress?.hidden);

const languageQueryFor = (language) =>
  language === 'en'
    ? {
        $or: [
          { language: 'en' },
          { language: { $exists: false } },
          { language: '' },
          { language: null }
        ]
      }
    : { language };

const isChecklistVisibleForLanguage = (checklist, language) => {
  const checklistLanguage = normalizeLanguageCode(checklist?.language, 'en');
  return checklistLanguage === language;
};

const cloneChecklistItems = (items = []) =>
  items.map((item, index) => ({
    _id: item._id || item.id || createId('item'),
    text: String(item.text || '').trim(),
    order: Number.isFinite(item.order) ? item.order : index + 1,
    icon: String(item.icon || '').trim(),
    ...mapItemDetails(item)
  }));

const createPersonalizedChecklistFromTemplate = async ({
  templateChecklist,
  userId
}) => {
  const personalizedChecklist = await Checklist.create({
    _id: createId('checklist'),
    type: 'custom',
    ownerId: userId,
    sourceChecklistId: templateChecklist._id,
    title: templateChecklist.title,
    category: templateChecklist.category,
    description: templateChecklist.description,
    language: normalizeLanguageCode(templateChecklist.language, 'en'),
    iconUrl: templateChecklist.iconUrl,
    icon: templateChecklist.icon || '',
    coverImageUrl: templateChecklist.coverImageUrl,
    status: 'published',
    createdBy: userId,
    items: cloneChecklistItems(templateChecklist.items)
  });

  const templateProgress = await ChecklistProgress.findOne({
    userId,
    checklistId: templateChecklist._id
  }).lean();

  if (templateProgress) {
    await ChecklistProgress.updateOne(
      { userId, checklistId: personalizedChecklist._id },
      {
        $set: {
          completedItemIds: templateProgress.completedItemIds || [],
          hidden: false
        },
        $setOnInsert: {
          _id: createId('progress'),
          userId,
          checklistId: personalizedChecklist._id
        }
      },
      { upsert: true }
    );
  }

  return personalizedChecklist;
};

const resolveChecklistForRead = async ({ checklistId, userId, lean = true }) => {
  const checklistQuery = Checklist.findById(checklistId);
  const checklist = lean ? await checklistQuery.lean() : await checklistQuery;

  if (!checklist) {
    return null;
  }

  if (isSharedChecklist(checklist)) {
    const personalizedChecklistQuery = Checklist.findOne({
      type: 'custom',
      ownerId: userId,
      sourceChecklistId: checklist._id
    });
    const personalizedChecklist = lean
      ? await personalizedChecklistQuery.lean()
      : await personalizedChecklistQuery;

    if (personalizedChecklist) {
      return personalizedChecklist;
    }
  }

  return checklist;
};

const resolveChecklistForEdit = async ({ checklistId, userId }) => {
  const checklist = await Checklist.findById(checklistId);

  if (!checklist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
  }

  if (userCanEditChecklist(checklist, userId)) {
    return checklist;
  }

  if (!isSharedChecklist(checklist)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Only your own checklist or a shared default can be edited');
  }

  const existingPersonalizedChecklist = await Checklist.findOne({
    type: 'custom',
    ownerId: userId,
    sourceChecklistId: checklist._id
  });

  if (existingPersonalizedChecklist) {
    return existingPersonalizedChecklist;
  }

  return createPersonalizedChecklistFromTemplate({
    templateChecklist: checklist.toObject(),
    userId
  });
};

const formatChecklist = (checklist, progress, categoryMap, language = 'en') => {
  const completedItemIds = new Set(progress?.completedItemIds || []);
  const items = checklist.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      id: item._id,
      text: item.text,
      order: item.order,
      icon: item.icon || '',
      description: item.description || '',
      imageUrl: item.imageUrl || '',
      expirationDate: item.expirationDate || null,
      inspectionDate: item.inspectionDate || null,
      reminderEnabled: Boolean(item.reminderEnabled),
      reminderDaysBefore: Number.isFinite(item.reminderDaysBefore)
        ? item.reminderDaysBefore
        : 7,
      notificationPreferences: normalizeNotificationPreferences(
        item.notificationPreferences || {}
      ),
      completed: completedItemIds.has(item._id)
    }));
  const completedCount = items.filter((item) => item.completed).length;
  const totalCount = items.length;
  const category = categoryMap?.get(checklist.category);

  return {
    id: checklist._id,
    type: checklist.type,
    ownerId: checklist.ownerId,
    sourceChecklistId: checklist.sourceChecklistId || null,
    isSharedDefault: isSharedChecklist(checklist),
    title: checklist.title,
    category: category
      ? localizedCategoryName(category, language)
      : checklist.category,
    categorySlug: checklist.category,
    description: checklist.description,
    language: normalizeLanguageCode(checklist.language, 'en'),
    iconUrl: checklist.iconUrl,
    icon: checklist.icon || '',
    coverImageUrl: checklist.coverImageUrl,
    status: checklist.status,
    premiumOnly: Boolean(checklist.premiumOnly),
    createdBy: checklist.createdBy,
    createdAt: checklist.createdAt,
    updatedAt: checklist.updatedAt,
    items,
    progress: {
      completedCount,
      totalCount,
      percentage: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)
    }
  };
};

const formatLockedChecklist = (checklist, categoryMap, language = 'en') => {
  const category = categoryMap?.get(checklist.category);

  return {
    id: checklist._id,
    type: checklist.type,
    ownerId: checklist.ownerId,
    sourceChecklistId: checklist.sourceChecklistId || null,
    isSharedDefault: isSharedChecklist(checklist),
    title: checklist.title,
    category: category
      ? localizedCategoryName(category, language)
      : checklist.category,
    categorySlug: checklist.category,
    description: checklist.description,
    language: normalizeLanguageCode(checklist.language, 'en'),
    iconUrl: checklist.iconUrl,
    icon: checklist.icon || '',
    coverImageUrl: checklist.coverImageUrl,
    status: checklist.status,
    premiumOnly: true,
    locked: true,
    items: [],
    progress: {
      completedCount: 0,
      totalCount: 0,
      percentage: 0
    }
  };
};

const shouldLockPremiumChecklists = async () => {
  const accessRules = await getSetting('accessRules');
  return accessRules?.premiumChecklistsLocked !== false;
};

const isChecklistLockedForUser = (checklist, user, lockPremiumChecklists = true) =>
  lockPremiumChecklists && Boolean(checklist?.premiumOnly) && !isPremiumUser(user);

const getOrCreateChecklistProgress = async (userId, checklistId) => {
  let progress = await ChecklistProgress.findOne({ userId, checklistId });

  if (!progress) {
    progress = await ChecklistProgress.create({
      _id: createId('progress'),
      userId,
      checklistId,
      completedItemIds: []
    });
  }

  return progress;
};

export const listChecklists = catchAsync(async (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim().toLowerCase();
  const userId = req.auth.user._id;
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);

  const [
    fetchedChecklists,
    progressEntries,
    categoryMap,
    managedCategoryNames,
    lockPremiumChecklists
  ] =
    await Promise.all([
      Checklist.find({
        $and: [
          {
            $or: [
              { ownerId: null, status: 'published' },
              { ownerId: userId }
            ]
          },
          languageQueryFor(language)
        ]
      })
        .sort({ updatedAt: -1 })
        .lean(),
      ChecklistProgress.find({ userId }).lean(),
      getManagedCategoryMap(),
      getManagedCategoryNames(language),
      shouldLockPremiumChecklists()
    ]);
  const progressMap = new Map(progressEntries.map((entry) => [entry.checklistId, entry]));
  const personalizedTemplateIds = new Set(
    fetchedChecklists
      .filter((checklist) => checklist.type === 'custom' && checklist.sourceChecklistId)
      .map((checklist) => checklist.sourceChecklistId)
  );
  let checklists = fetchedChecklists.filter((checklist) => {
    if (checklist.type !== 'template') return true;
    if (personalizedTemplateIds.has(checklist._id)) return false;
    return !isChecklistHiddenForUser(checklist, progressMap.get(checklist._id));
  });

  if (category) {
    checklists = checklists.filter((checklist) => {
      const categoryDoc = categoryMap.get(checklist.category);
      const localizedName = localizedCategoryName(categoryDoc, language).toLowerCase();
      return (
        checklist.category.toLowerCase() === category ||
        localizedName === category
      );
    });
  }

  if (search) {
    checklists = checklists.filter((checklist) => {
      const categoryDoc = categoryMap.get(checklist.category);
      const localizedName = localizedCategoryName(categoryDoc, language);
      return [checklist.title, checklist.description, localizedName]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  }

  const user = req.auth.user;

  sendSuccess(res, {
    message: 'Checklists fetched successfully',
    data: checklists.map((checklist) =>
      isChecklistLockedForUser(checklist, user, lockPremiumChecklists)
        ? formatLockedChecklist(checklist, categoryMap, language)
        : formatChecklist(checklist, progressMap.get(checklist._id), categoryMap, language)
    ),
    meta: {
      categories: managedCategoryNames
    }
  });
});

export const getChecklistById = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const checklist = await resolveChecklistForRead({
    checklistId: req.params.checklistId,
    userId
  });

  if (
    !userCanAccessChecklist(checklist, userId) ||
    !isChecklistVisibleForLanguage(checklist, language)
  ) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
  }

  if (isChecklistLockedForUser(checklist, req.auth.user, await shouldLockPremiumChecklists())) {
    const err = new ApiError(
      StatusCodes.FORBIDDEN,
      'This checklist is available to premium members only'
    );
    err.code = 'PREMIUM_REQUIRED';
    throw err;
  }

  const [progress, categoryMap] = await Promise.all([
    ChecklistProgress.findOne({
      userId,
      checklistId: checklist._id
    }).lean(),
    getManagedCategoryMap()
  ]);

  if (isChecklistHiddenForUser(checklist, progress)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
  }

  sendSuccess(res, {
    message: 'Checklist fetched successfully',
    data: formatChecklist(checklist, progress, categoryMap, language)
  });
});

export const createChecklist = catchAsync(async (req, res) => {
  const title = String(req.body.title || '').trim();

  if (!title) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'title is required');
  }

  const itemsInput = parseArrayInput(req.body.items) || [];
  const iconUrl = await resolveImageUrl({
    req,
    folder: 'checklists/icons',
    fieldNames: ['icon', 'iconImage', 'iconImageFile', 'iconUrl'],
    bodyValue: req.body.iconUrl,
    removeKey: 'removeIconUrl',
    defaultValue: 'https://placehold.co/128x128/png?text=CUSTOM'
  });
  const coverImageUrl = await resolveImageUrl({
    req,
    folder: 'checklists/covers',
    fieldNames: ['coverImage', 'cover', 'coverImageFile', 'coverImageUrl'],
    bodyValue: req.body.coverImageUrl,
    removeKey: 'removeCoverImageUrl',
    defaultValue: 'https://placehold.co/1200x800/png?text=Custom+Checklist'
  });

  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const categorySlug = await resolveManagedCategorySlug(req.body.category);

  const checklist = await Checklist.create({
    _id: createId('checklist'),
    type: 'custom',
    ownerId: req.auth.user._id,
    sourceChecklistId: null,
    title,
    category: categorySlug,
    description: String(req.body.description || '').trim(),
    language: ensureSupportedLanguage(req.body.language || language),
    iconUrl,
    icon: String(req.body.iconEmoji || req.body.icon_text || '').trim(),
    coverImageUrl,
    status: 'published',
    createdBy: req.auth.user._id,
    items: normalizeItems(itemsInput)
  });

  const categoryMap = await getManagedCategoryMap();

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Checklist created successfully',
    data: formatChecklist(checklist.toObject(), null, categoryMap, language)
  });
});

export const updateChecklist = catchAsync(async (req, res) => {
  const checklist = await resolveChecklistForEdit({
    checklistId: req.params.checklistId,
    userId: req.auth.user._id
  });

  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'title cannot be empty');
    }
    checklist.title = title;
  }

  if (req.body.description !== undefined) {
    checklist.description = String(req.body.description).trim();
  }

  if (req.body.category !== undefined) {
    checklist.category = await resolveManagedCategorySlug(req.body.category);
  }

  if (req.body.language !== undefined) {
    checklist.language = ensureSupportedLanguage(req.body.language);
  }

  checklist.iconUrl = await resolveImageUrl({
    req,
    folder: 'checklists/icons',
    fieldNames: ['icon', 'iconImage', 'iconImageFile', 'iconUrl'],
    bodyValue: req.body.iconUrl,
    removeKey: 'removeIconUrl',
    currentValue: checklist.iconUrl
  });

  checklist.coverImageUrl = await resolveImageUrl({
    req,
    folder: 'checklists/covers',
    fieldNames: ['coverImage', 'cover', 'coverImageFile', 'coverImageUrl'],
    bodyValue: req.body.coverImageUrl,
    removeKey: 'removeCoverImageUrl',
    currentValue: checklist.coverImageUrl
  });

  if (req.body.iconEmoji !== undefined || req.body.icon_text !== undefined) {
    const nextIcon = String(
      req.body.iconEmoji !== undefined ? req.body.iconEmoji : req.body.icon_text
    ).trim();
    checklist.icon = nextIcon;
  }

  if (req.body.items !== undefined) {
    checklist.items = normalizeItems(parseArrayInput(req.body.items) || []);
  }

  await checklist.save();

  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const [progress, categoryMap] = await Promise.all([
    ChecklistProgress.findOne({
      userId: req.auth.user._id,
      checklistId: checklist._id
    }).lean(),
    getManagedCategoryMap()
  ]);

  sendSuccess(res, {
    message: 'Checklist updated successfully',
    data: formatChecklist(checklist.toObject(), progress, categoryMap, language)
  });
});

export const deleteChecklist = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const checklist = await Checklist.findById(req.params.checklistId);

  if (!checklist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
  }

  if (checklist.type === 'custom') {
    if (!userCanEditChecklist(checklist, userId)) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Only your custom checklists can be deleted');
    }

    await Checklist.deleteOne({ _id: checklist._id });
    await ChecklistProgress.deleteMany({ checklistId: checklist._id });

    sendSuccess(res, {
      message: 'Checklist deleted successfully'
    });
    return;
  }

  if (isSharedChecklist(checklist)) {
    await ChecklistProgress.updateOne(
      { userId, checklistId: checklist._id },
      {
        $set: {
          hidden: true
        },
        $setOnInsert: {
          _id: createId('progress'),
          userId,
          checklistId: checklist._id,
          completedItemIds: []
        }
      },
      { upsert: true }
    );

    sendSuccess(res, {
      message: 'Checklist removed from your list'
    });
    return;
  }

  throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
});

export const addChecklistItem = catchAsync(async (req, res) => {
  const text = String(req.body.text || '').trim();

  if (!text) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'text is required');
  }

  const checklist = await resolveChecklistForEdit({
    checklistId: req.params.checklistId,
    userId: req.auth.user._id
  });

  checklist.items.push({
    _id: createId('item'),
    text,
    order: checklist.items.length + 1,
    icon: String(req.body.icon || req.body.iconEmoji || '').trim(),
    ...mapItemDetails(req.body)
  });
  await checklist.save();

  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const [progress, categoryMap] = await Promise.all([
    ChecklistProgress.findOne({
      userId: req.auth.user._id,
      checklistId: checklist._id
    }).lean(),
    getManagedCategoryMap()
  ]);

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Checklist item added successfully',
    data: formatChecklist(checklist.toObject(), progress, categoryMap, language)
  });
});

export const updateChecklistItem = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  let checklist = await resolveChecklistForRead({
    checklistId: req.params.checklistId,
    userId,
    lean: false
  });

  if (!userCanAccessChecklist(checklist, userId)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
  }

  let progress = await ChecklistProgress.findOne({
    userId,
    checklistId: checklist._id
  });

  if (isChecklistHiddenForUser(checklist, progress)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
  }

  let item = checklist.items.find((entry) => entry._id === req.params.itemId);

  if (!item) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist item not found');
  }

  if (req.body.text !== undefined) {
    if (!userCanEditChecklist(checklist, userId)) {
      checklist = await resolveChecklistForEdit({
        checklistId: checklist._id,
        userId
      });
      item = checklist.items.find((entry) => entry._id === req.params.itemId);
      if (!item) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist item not found');
      }
    }

    const nextText = String(req.body.text).trim();

    if (!nextText) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'text cannot be empty');
    }

    item.text = nextText;
  }

  if (req.body.icon !== undefined || req.body.iconEmoji !== undefined) {
    if (!userCanEditChecklist(checklist, userId)) {
      checklist = await resolveChecklistForEdit({
        checklistId: checklist._id,
        userId
      });
      item = checklist.items.find((entry) => entry._id === req.params.itemId);
      if (!item) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist item not found');
      }
    }
    item.icon = String(
      req.body.icon !== undefined ? req.body.icon : req.body.iconEmoji
    ).trim();
  }

  const itemImageFieldNames = ['image', 'itemImage', 'itemImageFile', 'imageUrl'];
  const hasItemImageUpload = Boolean(getUploadedFile(req, ...itemImageFieldNames));
  const detailFields = [
    'description',
    'imageUrl',
    'itemImageUrl',
    'removeItemImage',
    'expirationDate',
    'inspectionDate',
    'reminderEnabled',
    'reminderDaysBefore',
    'notificationPreferences'
  ];
  if (hasItemImageUpload || detailFields.some((field) => req.body[field] !== undefined)) {
    if (!userCanEditChecklist(checklist, userId)) {
      checklist = await resolveChecklistForEdit({
        checklistId: checklist._id,
        userId
      });
      item = checklist.items.find((entry) => entry._id === req.params.itemId);
      if (!item) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist item not found');
      }
    }
    // Resolve the item image: a newly uploaded file is sent to Cloudinary, a
    // `removeItemImage` signal clears it, otherwise the existing URL is kept.
    const resolvedItemImageUrl = await resolveImageUrl({
      req,
      folder: 'checklists/items',
      fieldNames: itemImageFieldNames,
      bodyValue: req.body.imageUrl !== undefined ? req.body.imageUrl : req.body.itemImageUrl,
      currentValue: item.imageUrl || '',
      removeKey: 'removeItemImage'
    });
    const details = mapItemDetails({ ...item.toObject?.(), ...req.body });
    item.description = details.description;
    item.imageUrl = resolvedItemImageUrl;
    item.expirationDate = details.expirationDate;
    item.inspectionDate = details.inspectionDate;
    item.reminderEnabled = details.reminderEnabled;
    item.reminderDaysBefore = details.reminderDaysBefore;
    item.notificationPreferences = details.notificationPreferences;
  }

  if (!progress) {
    progress = await getOrCreateChecklistProgress(userId, checklist._id);
  }

  if (req.body.completed !== undefined || req.body.toggle === true) {
    const completedSet = new Set(progress.completedItemIds);
    const shouldComplete =
      req.body.completed === undefined ? !completedSet.has(item._id) : Boolean(req.body.completed);

    if (shouldComplete) {
      completedSet.add(item._id);
    } else {
      completedSet.delete(item._id);
    }

    progress.completedItemIds = [...completedSet];
    await progress.save();
  }

  await checklist.save();

  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const categoryMap = await getManagedCategoryMap();

  sendSuccess(res, {
    message: 'Checklist item updated successfully',
    data: formatChecklist(checklist.toObject(), progress.toObject(), categoryMap, language)
  });
});

export const deleteChecklistItem = catchAsync(async (req, res) => {
  const checklist = await resolveChecklistForEdit({
    checklistId: req.params.checklistId,
    userId: req.auth.user._id
  });

  const itemExists = checklist.items.some((entry) => entry._id === req.params.itemId);

  if (!itemExists) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist item not found');
  }

  checklist.items = checklist.items
    .filter((entry) => entry._id !== req.params.itemId)
    .map((entry, index) => ({
      _id: entry._id,
      text: entry.text,
      order: index + 1,
      icon: entry.icon || '',
      ...mapItemDetails(entry)
    }));
  await checklist.save();

  const progress = await ChecklistProgress.findOne({
    userId: req.auth.user._id,
    checklistId: checklist._id
  });

  if (progress) {
    progress.completedItemIds = progress.completedItemIds.filter(
      (itemId) => itemId !== req.params.itemId
    );
    await progress.save();
  }

  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const categoryMap = await getManagedCategoryMap();

  sendSuccess(res, {
    message: 'Checklist item deleted successfully',
    data: formatChecklist(
      checklist.toObject(),
      progress ? progress.toObject() : null,
      categoryMap,
      language
    )
  });
});
