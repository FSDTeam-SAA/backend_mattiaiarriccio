import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import User from '../models/user.model.js';
import Category from '../models/category.model.js';
import Checklist from '../models/checklist.model.js';
import ChecklistProgress from '../models/checklistProgress.model.js';
import SafetyTip from '../models/safetyTip.model.js';
import Conversation from '../models/conversation.model.js';
import Activity from '../models/activity.model.js';
import {
  fetchAiPrompt,
  fetchAllAiPrompts,
  updateAiPrompt
} from '../services/ai.service.js';
import {
  listManagedCategories,
  getManagedCategoryMap,
  resolveManagedCategorySlug,
  localizedCategoryName,
  localizedCategoryDescription,
  normalizeLocalizedField
} from '../services/category.service.js';
import { resolveImageUrl } from '../services/media.service.js';
import { createSlug } from '../services/security.service.js';
import { publicUser } from '../utils/serializers.js';
import { sendSuccess } from '../utils/response.js';
import { createId } from '../lib/id.js';
import { logActivity } from '../services/activity.service.js';
import {
  ensureSupportedLanguage,
  normalizeLanguageCode
} from '../services/language.service.js';
import {
  parseArrayInput,
  parseBooleanInput,
  parseIntegerInput
} from '../utils/requestParsers.js';

const normalizeItems = (items = []) =>
  items
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          _id: createId('item'),
          text: item.trim(),
          order: index + 1,
          icon: ''
        };
      }

      return {
        _id: item._id || item.id || createId('item'),
        text: String(item.text || '').trim(),
        order: Number.isFinite(item.order) ? item.order : index + 1,
        icon: String(item.icon || '').trim()
      };
    })
    .filter((item) => item.text);

const normalizeContentSections = (sections = [], fallbackBody = '') => {
  if (Array.isArray(sections) && sections.length > 0) {
    return sections
      .map((section) => ({
        heading: String(section.heading || '').trim(),
        body: String(section.body || '').trim()
      }))
      .filter((section) => section.heading || section.body);
  }

  if (!fallbackBody) {
    return [];
  }

  return [
    {
      heading: 'Overview',
      body: String(fallbackBody).trim()
    }
  ];
};

const mapChecklistPayload = (checklist, categoryMap) => {
  const category = categoryMap?.get(checklist.category);
  return {
    id: checklist._id,
    type: checklist.type,
    title: checklist.title,
    category: category
      ? localizedCategoryName(category, 'en')
      : checklist.category,
    categorySlug: checklist.category,
    description: checklist.description,
    language: normalizeLanguageCode(checklist.language, 'en'),
    iconUrl: checklist.iconUrl,
    icon: checklist.icon || '',
    coverImageUrl: checklist.coverImageUrl,
    status: checklist.status,
    createdBy: checklist.createdBy,
    itemCount: checklist.items.length,
    items: checklist.items.map((item) => ({
      id: item._id,
      text: item.text,
      order: item.order,
      icon: item.icon || ''
    })),
    createdAt: checklist.createdAt,
    updatedAt: checklist.updatedAt
  };
};

const mapSafetyTipPayload = (tip, categoryMap) => {
  const category = categoryMap?.get(tip.category);
  return {
    id: tip._id,
    slug: tip.slug,
    title: tip.title,
    category: category ? localizedCategoryName(category, 'en') : tip.category,
    categorySlug: tip.category,
    summary: tip.summary,
    contentSections: tip.contentSections,
    doList: tip.doList,
    dontList: tip.dontList,
    tags: tip.tags,
    estimatedReadMinutes: tip.estimatedReadMinutes,
    coverImageUrl: tip.coverImageUrl,
    thumbnailUrl: tip.thumbnailUrl,
    status: tip.status,
    language: tip.language,
    featured: tip.featured,
    createdAt: tip.createdAt,
    updatedAt: tip.updatedAt
  };
};

const getCategoryUsageMaps = async () => {
  const [templateChecklistCounts, safetyTipCounts] = await Promise.all([
    Checklist.aggregate([
      {
        $match: {
          type: 'template'
        }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]),
    SafetyTip.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  return {
    checklistCounts: new Map(
      templateChecklistCounts.map((entry) => [entry._id, entry.count])
    ),
    safetyTipCounts: new Map(
      safetyTipCounts.map((entry) => [entry._id, entry.count])
    )
  };
};

const mapCategoryPayload = (category, usageMaps) => {
  const checklistsCount = usageMaps.checklistCounts.get(category.slug) || 0;
  const safetyTipsCount = usageMaps.safetyTipCounts.get(category.slug) || 0;

  return {
    id: category._id,
    slug: category.slug,
    name: localizedCategoryName(category, 'en'),
    description: localizedCategoryDescription(category, 'en'),
    names: {
      en: category.names?.en || '',
      it: category.names?.it || ''
    },
    descriptions: {
      en: category.descriptions?.en || '',
      it: category.descriptions?.it || ''
    },
    sortOrder: category.sortOrder,
    checklistsCount,
    safetyTipsCount,
    usageCount: checklistsCount + safetyTipsCount,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt
  };
};

export const getAdminDashboard = catchAsync(async (req, res) => {
  const [
    totalUsers,
    totalCategories,
    totalChecklists,
    totalSafetyTips,
    totalChats,
    publishedSafetyTips,
    recentActivity,
    aiPrompt
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    listManagedCategories().then((categories) => categories.length),
    Checklist.countDocuments({ type: 'template' }),
    SafetyTip.countDocuments(),
    Conversation.countDocuments(),
    SafetyTip.countDocuments({ status: 'published' }),
    Activity.find().sort({ createdAt: -1 }).limit(10).lean(),
    fetchAllAiPrompts().catch(() => null)
  ]);

  const templatesPreview = await Checklist.find({ type: 'template' })
    .sort({ updatedAt: -1 })
    .limit(5)
    .lean();

  sendSuccess(res, {
    message: 'Admin dashboard fetched successfully',
    data: {
      summary: {
        totalUsers,
        totalCategories,
        totalChecklists,
        totalSafetyTips,
        totalChats,
        publishedSafetyTips
      },
      recentActivity: recentActivity.map((item) => ({
        id: item._id,
        type: item.type,
        actorId: item.actorId,
        title: item.title,
        description: item.description,
        createdAt: item.createdAt
      })),
      aiPrompt,
      templatesPreview: templatesPreview.map((checklist) => ({
        id: checklist._id,
        title: checklist.title,
        status: checklist.status,
        itemCount: checklist.items.length,
        updatedAt: checklist.updatedAt
      }))
    }
  });
});

export const getAdminSettings = catchAsync(async (req, res) => {
  const admin = await User.findById(req.auth.user._id).lean();

  sendSuccess(res, {
    message: 'Admin settings fetched successfully',
    data: publicUser(admin)
  });
});

export const updateAdminSettings = catchAsync(async (req, res) => {
  const admin = await User.findById(req.auth.user._id);

  if (!admin || admin.role !== 'admin') {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin account not found');
  }

  if (req.body.firstName !== undefined) {
    admin.firstName = String(req.body.firstName).trim();
  }

  if (req.body.lastName !== undefined) {
    admin.lastName = String(req.body.lastName).trim();
  }

  admin.fullName = `${admin.firstName} ${admin.lastName}`.trim();

  if (req.body.phoneNumber !== undefined) {
    admin.phoneNumber = String(req.body.phoneNumber).trim();
  }

  admin.avatarUrl = await resolveImageUrl({
    req,
    folder: 'admins/avatars',
    fieldNames: ['avatar', 'avatarImage', 'avatarImageFile', 'avatarUrl'],
    bodyValue: req.body.avatarUrl,
    removeKey: 'removeAvatarUrl',
    currentValue: admin.avatarUrl
  });

  await admin.save();

  sendSuccess(res, {
    message: 'Admin settings updated successfully',
    data: publicUser(admin.toObject())
  });
});

export const getAiPromptConfig = catchAsync(async (req, res) => {
  const requestedLanguage = String(req.query.language || '').trim();

  if (requestedLanguage) {
    const prompt = await fetchAiPrompt(requestedLanguage);
    sendSuccess(res, {
      message: 'AI prompt fetched successfully',
      data: prompt
    });
    return;
  }

  const prompts = await fetchAllAiPrompts();

  sendSuccess(res, {
    message: 'AI prompts fetched successfully',
    data: prompts
  });
});

export const patchAiPromptConfig = catchAsync(async (req, res) => {
  const language = String(req.body.language || req.query.language || 'en');
  const prompt = await updateAiPrompt({
    language,
    welcomeMessage:
      req.body.welcomeMessage !== undefined
        ? req.body.welcomeMessage
        : req.body.welcome_message,
    systemInstruction:
      req.body.systemInstruction !== undefined
        ? req.body.systemInstruction
        : req.body.system_instruction,
    fallbackMessage:
      req.body.fallbackMessage !== undefined
        ? req.body.fallbackMessage
        : req.body.fallback_message
  });

  await logActivity({
    type: 'ai.prompt.updated',
    actorId: req.auth.user._id,
    title: `AI prompt updated (${prompt.language})`,
    description: `Prompt settings were updated for the ${prompt.language} locale.`
  });

  sendSuccess(res, {
    message: 'AI prompt updated successfully',
    data: prompt
  });
});

export const listAdminChecklists = catchAsync(async (req, res) => {
  const [checklists, categoryMap] = await Promise.all([
    Checklist.find({ type: 'template' }).sort({ updatedAt: -1 }).lean(),
    getManagedCategoryMap()
  ]);

  sendSuccess(res, {
    message: 'Admin checklists fetched successfully',
    data: checklists.map((checklist) => mapChecklistPayload(checklist, categoryMap))
  });
});

export const createAdminChecklist = catchAsync(async (req, res) => {
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
    defaultValue: 'https://placehold.co/128x128/png?text=TEMPLATE'
  });
  const coverImageUrl = await resolveImageUrl({
    req,
    folder: 'checklists/covers',
    fieldNames: ['coverImage', 'cover', 'coverImageFile', 'coverImageUrl'],
    bodyValue: req.body.coverImageUrl,
    removeKey: 'removeCoverImageUrl',
    defaultValue: 'https://placehold.co/1200x800/png?text=Checklist'
  });

  const checklist = await Checklist.create({
    _id: createId('checklist'),
    type: 'template',
    ownerId: null,
    title,
    category: await resolveManagedCategorySlug(req.body.category),
    description: String(req.body.description || '').trim(),
    language: ensureSupportedLanguage(req.body.language || 'en'),
    iconUrl,
    icon: String(req.body.iconEmoji || req.body.icon_text || '').trim(),
    coverImageUrl,
    status: String(req.body.status || 'published').trim(),
    createdBy: req.auth.user._id,
    items: normalizeItems(itemsInput)
  });

  await logActivity({
    type: 'checklist.created',
    actorId: req.auth.user._id,
    title: `New checklist: ${checklist.title}`,
    description: 'A new admin checklist template was created.'
  });

  const categoryMap = await getManagedCategoryMap();

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Admin checklist created successfully',
    data: mapChecklistPayload(checklist, categoryMap)
  });
});

export const updateAdminChecklist = catchAsync(async (req, res) => {
  const checklist = await Checklist.findOne({
    _id: req.params.checklistId,
    type: 'template'
  });

  if (!checklist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist template not found');
  }

  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'title cannot be empty');
    }
    checklist.title = title;
  }

  if (req.body.category !== undefined) {
    checklist.category = await resolveManagedCategorySlug(req.body.category);
  }

  if (req.body.description !== undefined) {
    checklist.description = String(req.body.description).trim();
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

  if (req.body.status !== undefined) {
    checklist.status = String(req.body.status).trim();
  }

  if (req.body.items !== undefined) {
    checklist.items = normalizeItems(parseArrayInput(req.body.items) || []);
  }

  await checklist.save();

  await logActivity({
    type: 'checklist.updated',
    actorId: req.auth.user._id,
    title: `Checklist updated: ${checklist.title}`,
    description: 'A template checklist was updated from the admin console.'
  });

  const categoryMap = await getManagedCategoryMap();

  sendSuccess(res, {
    message: 'Admin checklist updated successfully',
    data: mapChecklistPayload(checklist, categoryMap)
  });
});

export const deleteAdminChecklist = catchAsync(async (req, res) => {
  const checklist = await Checklist.findOneAndDelete({
    _id: req.params.checklistId,
    type: 'template'
  });

  if (!checklist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist template not found');
  }

  await ChecklistProgress.deleteMany({ checklistId: checklist._id });

  await logActivity({
    type: 'checklist.deleted',
    actorId: req.auth.user._id,
    title: `Checklist deleted: ${checklist.title}`,
    description: 'A template checklist was removed.'
  });

  sendSuccess(res, {
    message: 'Admin checklist deleted successfully'
  });
});

export const listAdminSafetyTips = catchAsync(async (req, res) => {
  const [tips, categoryMap] = await Promise.all([
    SafetyTip.find().sort({ updatedAt: -1 }).lean(),
    getManagedCategoryMap()
  ]);

  sendSuccess(res, {
    message: 'Admin safety tips fetched successfully',
    data: tips.map((tip) => mapSafetyTipPayload(tip, categoryMap))
  });
});

export const createAdminSafetyTip = catchAsync(async (req, res) => {
  const title = String(req.body.title || '').trim();

  if (!title) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'title is required');
  }

  const contentSectionsInput = parseArrayInput(req.body.contentSections);
  const doListInput = parseArrayInput(req.body.doList);
  const dontListInput = parseArrayInput(req.body.dontList);
  const tagsInput = parseArrayInput(req.body.tags);
  const estimatedReadMinutes =
    parseIntegerInput(req.body.estimatedReadMinutes) ?? 4;
  const coverImageUrl = await resolveImageUrl({
    req,
    folder: 'safety-tips/covers',
    fieldNames: ['coverImage', 'cover', 'coverImageFile', 'coverImageUrl'],
    bodyValue: req.body.coverImageUrl,
    removeKey: 'removeCoverImageUrl',
    defaultValue: 'https://placehold.co/1200x800/png?text=Safety+Tip'
  });
  const thumbnailUrl = await resolveImageUrl({
    req,
    folder: 'safety-tips/thumbnails',
    fieldNames: ['thumbnail', 'thumbnailImage', 'thumbnailImageFile', 'thumbnailUrl'],
    bodyValue: req.body.thumbnailUrl,
    removeKey: 'removeThumbnailUrl',
    defaultValue: 'https://placehold.co/600x400/png?text=Safety+Tip'
  });

  const tip = await SafetyTip.create({
    _id: createId('tip'),
    slug: createSlug(title),
    title,
    category: await resolveManagedCategorySlug(req.body.category),
    summary: String(req.body.summary || '').trim(),
    contentSections: normalizeContentSections(
      contentSectionsInput,
      req.body.content || req.body.body || ''
    ),
    doList: Array.isArray(doListInput)
      ? doListInput.map((item) => String(item).trim()).filter(Boolean)
      : [],
    dontList: Array.isArray(dontListInput)
      ? dontListInput.map((item) => String(item).trim()).filter(Boolean)
      : [],
    tags: Array.isArray(tagsInput)
      ? tagsInput.map((item) => String(item).trim()).filter(Boolean)
      : [],
    estimatedReadMinutes,
    coverImageUrl,
    thumbnailUrl,
    status: String(req.body.status || 'published').trim(),
    language: ensureSupportedLanguage(req.body.language || 'en'),
    featured: parseBooleanInput(req.body.featured) ?? false
  });

  await logActivity({
    type: 'guide.created',
    actorId: req.auth.user._id,
    title: `New guide: ${tip.title}`,
    description: 'A new safety guide was published from the admin console.'
  });

  const categoryMap = await getManagedCategoryMap();

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Admin safety tip created successfully',
    data: mapSafetyTipPayload(tip, categoryMap)
  });
});

export const updateAdminSafetyTip = catchAsync(async (req, res) => {
  const tip = await SafetyTip.findById(req.params.tipId);

  if (!tip) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Safety tip not found');
  }

  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'title cannot be empty');
    }
    tip.title = title;
    tip.slug = createSlug(title);
  }

  if (req.body.category !== undefined) {
    tip.category = await resolveManagedCategorySlug(req.body.category);
  }

  if (req.body.summary !== undefined) {
    tip.summary = String(req.body.summary).trim();
  }

  if (
    req.body.contentSections !== undefined ||
    req.body.content !== undefined ||
    req.body.body !== undefined
  ) {
    tip.contentSections = normalizeContentSections(
      parseArrayInput(req.body.contentSections),
      req.body.content || req.body.body || ''
    );
  }

  if (req.body.doList !== undefined) {
    const doListInput = parseArrayInput(req.body.doList);
    tip.doList = Array.isArray(doListInput)
      ? doListInput.map((item) => String(item).trim()).filter(Boolean)
      : [];
  }

  if (req.body.dontList !== undefined) {
    const dontListInput = parseArrayInput(req.body.dontList);
    tip.dontList = Array.isArray(dontListInput)
      ? dontListInput.map((item) => String(item).trim()).filter(Boolean)
      : [];
  }

  if (req.body.tags !== undefined) {
    const tagsInput = parseArrayInput(req.body.tags);
    tip.tags = Array.isArray(tagsInput)
      ? tagsInput.map((item) => String(item).trim()).filter(Boolean)
      : [];
  }

  if (req.body.estimatedReadMinutes !== undefined) {
    tip.estimatedReadMinutes =
      parseIntegerInput(req.body.estimatedReadMinutes) ?? tip.estimatedReadMinutes;
  }

  tip.coverImageUrl = await resolveImageUrl({
    req,
    folder: 'safety-tips/covers',
    fieldNames: ['coverImage', 'cover', 'coverImageFile', 'coverImageUrl'],
    bodyValue: req.body.coverImageUrl,
    removeKey: 'removeCoverImageUrl',
    currentValue: tip.coverImageUrl
  });

  tip.thumbnailUrl = await resolveImageUrl({
    req,
    folder: 'safety-tips/thumbnails',
    fieldNames: ['thumbnail', 'thumbnailImage', 'thumbnailImageFile', 'thumbnailUrl'],
    bodyValue: req.body.thumbnailUrl,
    removeKey: 'removeThumbnailUrl',
    currentValue: tip.thumbnailUrl
  });

  if (req.body.status !== undefined) {
    tip.status = String(req.body.status).trim();
  }

  if (req.body.language !== undefined) {
    tip.language = ensureSupportedLanguage(req.body.language);
  }

  if (req.body.featured !== undefined) {
    tip.featured = parseBooleanInput(req.body.featured) ?? tip.featured;
  }

  await tip.save();

  await logActivity({
    type: 'guide.updated',
    actorId: req.auth.user._id,
    title: `Guide updated: ${tip.title}`,
    description: 'A safety guide was edited from the admin console.'
  });

  const categoryMap = await getManagedCategoryMap();

  sendSuccess(res, {
    message: 'Admin safety tip updated successfully',
    data: mapSafetyTipPayload(tip, categoryMap)
  });
});

export const listAdminCategories = catchAsync(async (req, res) => {
  const [categories, usageMaps] = await Promise.all([
    listManagedCategories(),
    getCategoryUsageMaps()
  ]);

  sendSuccess(res, {
    message: 'Admin categories fetched successfully',
    data: categories.map((category) => mapCategoryPayload(category, usageMaps))
  });
});

const buildCategoryNamesPayload = (input, fallback = {}) => {
  const names = normalizeLocalizedField(input, fallback);
  if (!names.en) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'names.en is required');
  }
  return names;
};

export const createAdminCategory = catchAsync(async (req, res) => {
  const namesInput =
    req.body.names && typeof req.body.names === 'object'
      ? req.body.names
      : { en: req.body.name };
  const names = buildCategoryNamesPayload(namesInput);
  const descriptionsInput =
    req.body.descriptions && typeof req.body.descriptions === 'object'
      ? req.body.descriptions
      : { en: req.body.description };
  const descriptions = normalizeLocalizedField(descriptionsInput);

  const requestedSlug = String(req.body.slug || '').trim();
  const slug = requestedSlug || createSlug(names.en);

  if (!slug) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'name must include letters or numbers');
  }

  await listManagedCategories();

  const existingCategory = await Category.findOne({ slug }).lean();
  if (existingCategory) {
    throw new ApiError(StatusCodes.CONFLICT, 'A category with this slug already exists');
  }

  const lastCategory = await Category.findOne().sort({ sortOrder: -1, createdAt: -1 }).lean();
  const requestedSortOrder = parseIntegerInput(req.body.sortOrder);

  const category = await Category.create({
    slug,
    names,
    descriptions,
    sortOrder: requestedSortOrder ?? (lastCategory?.sortOrder || 0) + 1,
    createdBy: req.auth.user._id,
    updatedBy: req.auth.user._id
  });

  await logActivity({
    type: 'category.created',
    actorId: req.auth.user._id,
    title: `Category created: ${names.en}`,
    description: 'A new content category was added from the admin console.'
  });

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Admin category created successfully',
    data: mapCategoryPayload(category.toObject(), {
      checklistCounts: new Map(),
      safetyTipCounts: new Map()
    })
  });
});

export const updateAdminCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.categoryId);

  if (!category) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Category not found');
  }

  const currentNames = {
    en: category.names?.en || '',
    it: category.names?.it || ''
  };
  const currentDescriptions = {
    en: category.descriptions?.en || '',
    it: category.descriptions?.it || ''
  };

  if (req.body.names !== undefined || req.body.name !== undefined) {
    const namesInput =
      req.body.names && typeof req.body.names === 'object'
        ? req.body.names
        : { en: req.body.name };
    const names = buildCategoryNamesPayload(namesInput, currentNames);
    category.names = names;
  }

  if (req.body.descriptions !== undefined || req.body.description !== undefined) {
    const descriptionsInput =
      req.body.descriptions && typeof req.body.descriptions === 'object'
        ? req.body.descriptions
        : { en: req.body.description };
    category.descriptions = normalizeLocalizedField(
      descriptionsInput,
      currentDescriptions
    );
  }

  if (req.body.slug !== undefined) {
    const nextSlug = String(req.body.slug || '').trim();
    if (!nextSlug) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'slug cannot be empty');
    }
    if (nextSlug !== category.slug) {
      const conflict = await Category.findOne({
        slug: nextSlug,
        _id: { $ne: category._id }
      }).lean();
      if (conflict) {
        throw new ApiError(StatusCodes.CONFLICT, 'A category with this slug already exists');
      }
      category.slug = nextSlug;
    }
  }

  if (req.body.sortOrder !== undefined) {
    category.sortOrder = parseIntegerInput(req.body.sortOrder) ?? category.sortOrder;
  }

  category.updatedBy = req.auth.user._id;
  await category.save();

  await logActivity({
    type: 'category.updated',
    actorId: req.auth.user._id,
    title: `Category updated: ${category.names?.en || category.slug}`,
    description: 'A content category was updated from the admin console.'
  });

  const usageMaps = await getCategoryUsageMaps();

  sendSuccess(res, {
    message: 'Admin category updated successfully',
    data: mapCategoryPayload(category.toObject(), usageMaps)
  });
});

export const deleteAdminCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.categoryId);

  if (!category) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Category not found');
  }

  const [templateChecklistCount, safetyTipCount] = await Promise.all([
    Checklist.countDocuments({
      type: 'template',
      category: category.slug
    }),
    SafetyTip.countDocuments({
      category: category.slug
    })
  ]);

  if (templateChecklistCount > 0 || safetyTipCount > 0) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'This category is still used by checklists or safety tips. Reassign that content first'
    );
  }

  await Category.deleteOne({ _id: category._id });

  await logActivity({
    type: 'category.deleted',
    actorId: req.auth.user._id,
    title: `Category deleted: ${category.names?.en || category.slug}`,
    description: 'An unused content category was removed from the admin console.'
  });

  sendSuccess(res, {
    message: 'Admin category deleted successfully'
  });
});

export const deleteAdminSafetyTip = catchAsync(async (req, res) => {
  const tip = await SafetyTip.findByIdAndDelete(req.params.tipId);

  if (!tip) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Safety tip not found');
  }

  await logActivity({
    type: 'guide.deleted',
    actorId: req.auth.user._id,
    title: `Guide deleted: ${tip.title}`,
    description: 'A safety guide was removed from the admin console.'
  });

  sendSuccess(res, {
    message: 'Admin safety tip deleted successfully'
  });
});

export const listAdminActivity = catchAsync(async (req, res) => {
  const items = await Activity.find().sort({ createdAt: -1 }).lean();

  sendSuccess(res, {
    message: 'Admin activity fetched successfully',
    data: items.map((item) => ({
      id: item._id,
      type: item.type,
      actorId: item.actorId,
      title: item.title,
      description: item.description,
      createdAt: item.createdAt
    }))
  });
});
