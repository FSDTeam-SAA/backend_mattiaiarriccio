import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import Checklist from '../models/checklist.model.js';
import ChecklistProgress from '../models/checklistProgress.model.js';
import { createId } from '../lib/id.js';
import { getManagedCategoryNames } from '../services/category.service.js';
import { resolveImageUrl } from '../services/media.service.js';
import { sendSuccess } from '../utils/response.js';
import { parseArrayInput } from '../utils/requestParsers.js';

const normalizeItems = (items = []) =>
  items
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          _id: createId('item'),
          text: item.trim(),
          order: index + 1
        };
      }

      return {
        _id: item._id || item.id || createId('item'),
        text: String(item.text || '').trim(),
        order: Number.isFinite(item.order) ? item.order : index + 1
      };
    })
    .filter((item) => item.text);

const userCanAccessChecklist = (checklist, userId) =>
  checklist &&
  ((checklist.type === 'template' && checklist.status === 'published') ||
    checklist.ownerId === userId);

const userCanEditChecklist = (checklist, userId) =>
  checklist && checklist.type === 'custom' && checklist.ownerId === userId;

const formatChecklist = (checklist, progress) => {
  const completedItemIds = new Set(progress?.completedItemIds || []);
  const items = checklist.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      id: item._id,
      text: item.text,
      order: item.order,
      completed: completedItemIds.has(item._id)
    }));
  const completedCount = items.filter((item) => item.completed).length;
  const totalCount = items.length;

  return {
    id: checklist._id,
    type: checklist.type,
    ownerId: checklist.ownerId,
    title: checklist.title,
    category: checklist.category,
    description: checklist.description,
    iconUrl: checklist.iconUrl,
    coverImageUrl: checklist.coverImageUrl,
    status: checklist.status,
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

  let checklists = await Checklist.find({
    $or: [
      { type: 'template', status: 'published' },
      { type: 'custom', ownerId: userId }
    ]
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (category) {
    checklists = checklists.filter(
      (checklist) => checklist.category.toLowerCase() === category
    );
  }

  if (search) {
    checklists = checklists.filter((checklist) =>
      [checklist.title, checklist.description, checklist.category]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }

  const [progressEntries, managedCategories] = await Promise.all([
    ChecklistProgress.find({ userId }).lean(),
    getManagedCategoryNames()
  ]);
  const progressMap = new Map(progressEntries.map((entry) => [entry.checklistId, entry]));
  const categories = [...new Set([...managedCategories, ...checklists.map((item) => item.category)])]
    .filter(Boolean)
    .sort();

  sendSuccess(res, {
    message: 'Checklists fetched successfully',
    data: checklists.map((checklist) =>
      formatChecklist(checklist, progressMap.get(checklist._id))
    ),
    meta: {
      categories
    }
  });
});

export const getChecklistById = catchAsync(async (req, res) => {
  const checklist = await Checklist.findById(req.params.checklistId).lean();

  if (!userCanAccessChecklist(checklist, req.auth.user._id)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
  }

  const progress = await ChecklistProgress.findOne({
    userId: req.auth.user._id,
    checklistId: checklist._id
  }).lean();

  sendSuccess(res, {
    message: 'Checklist fetched successfully',
    data: formatChecklist(checklist, progress)
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
    fieldNames: ['icon', 'iconImage', 'iconUrl'],
    bodyValue: req.body.iconUrl,
    defaultValue: 'https://placehold.co/128x128/png?text=CUSTOM'
  });
  const coverImageUrl = await resolveImageUrl({
    req,
    folder: 'checklists/covers',
    fieldNames: ['coverImage', 'cover', 'coverImageUrl'],
    bodyValue: req.body.coverImageUrl,
    defaultValue: 'https://placehold.co/1200x800/png?text=Custom+Checklist'
  });

  const checklist = await Checklist.create({
    _id: createId('checklist'),
    type: 'custom',
    ownerId: req.auth.user._id,
    title,
    category: String(req.body.category || 'Custom').trim(),
    description: String(req.body.description || '').trim(),
    iconUrl,
    coverImageUrl,
    status: 'published',
    createdBy: req.auth.user._id,
    items: normalizeItems(itemsInput)
  });

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Checklist created successfully',
    data: formatChecklist(checklist.toObject(), null)
  });
});

export const updateChecklist = catchAsync(async (req, res) => {
  const checklist = await Checklist.findById(req.params.checklistId);

  if (!userCanEditChecklist(checklist, req.auth.user._id)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Only your custom checklists can be edited');
  }

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
    checklist.category = String(req.body.category).trim() || checklist.category;
  }

  checklist.iconUrl = await resolveImageUrl({
    req,
    folder: 'checklists/icons',
    fieldNames: ['icon', 'iconImage', 'iconUrl'],
    bodyValue: req.body.iconUrl,
    currentValue: checklist.iconUrl
  });

  checklist.coverImageUrl = await resolveImageUrl({
    req,
    folder: 'checklists/covers',
    fieldNames: ['coverImage', 'cover', 'coverImageUrl'],
    bodyValue: req.body.coverImageUrl,
    currentValue: checklist.coverImageUrl
  });

  if (req.body.items !== undefined) {
    checklist.items = normalizeItems(parseArrayInput(req.body.items) || []);
  }

  await checklist.save();

  const progress = await ChecklistProgress.findOne({
    userId: req.auth.user._id,
    checklistId: checklist._id
  }).lean();

  sendSuccess(res, {
    message: 'Checklist updated successfully',
    data: formatChecklist(checklist.toObject(), progress)
  });
});

export const deleteChecklist = catchAsync(async (req, res) => {
  const checklist = await Checklist.findById(req.params.checklistId);

  if (!userCanEditChecklist(checklist, req.auth.user._id)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Only your custom checklists can be deleted');
  }

  await Checklist.deleteOne({ _id: checklist._id });
  await ChecklistProgress.deleteMany({ checklistId: checklist._id });

  sendSuccess(res, {
    message: 'Checklist deleted successfully'
  });
});

export const addChecklistItem = catchAsync(async (req, res) => {
  const text = String(req.body.text || '').trim();

  if (!text) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'text is required');
  }

  const checklist = await Checklist.findById(req.params.checklistId);

  if (!userCanEditChecklist(checklist, req.auth.user._id)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Only your custom checklists can be edited');
  }

  checklist.items.push({
    _id: createId('item'),
    text,
    order: checklist.items.length + 1
  });
  await checklist.save();

  const progress = await ChecklistProgress.findOne({
    userId: req.auth.user._id,
    checklistId: checklist._id
  }).lean();

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Checklist item added successfully',
    data: formatChecklist(checklist.toObject(), progress)
  });
});

export const updateChecklistItem = catchAsync(async (req, res) => {
  const checklist = await Checklist.findById(req.params.checklistId);

  if (!userCanAccessChecklist(checklist, req.auth.user._id)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist not found');
  }

  const item = checklist.items.find((entry) => entry._id === req.params.itemId);

  if (!item) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist item not found');
  }

  if (req.body.text !== undefined) {
    if (!userCanEditChecklist(checklist, req.auth.user._id)) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Only custom checklist items can be edited');
    }

    const nextText = String(req.body.text).trim();

    if (!nextText) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'text cannot be empty');
    }

    item.text = nextText;
  }

  let progress = await getOrCreateChecklistProgress(req.auth.user._id, checklist._id);

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

  sendSuccess(res, {
    message: 'Checklist item updated successfully',
    data: formatChecklist(checklist.toObject(), progress.toObject())
  });
});

export const deleteChecklistItem = catchAsync(async (req, res) => {
  const checklist = await Checklist.findById(req.params.checklistId);

  if (!userCanEditChecklist(checklist, req.auth.user._id)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Only your custom checklists can be edited');
  }

  const itemExists = checklist.items.some((entry) => entry._id === req.params.itemId);

  if (!itemExists) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Checklist item not found');
  }

  checklist.items = checklist.items
    .filter((entry) => entry._id !== req.params.itemId)
    .map((entry, index) => ({
      _id: entry._id,
      text: entry.text,
      order: index + 1
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

  sendSuccess(res, {
    message: 'Checklist item deleted successfully',
    data: formatChecklist(
      checklist.toObject(),
      progress ? progress.toObject() : null
    )
  });
});
