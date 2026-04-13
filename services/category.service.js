import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import Category from '../models/category.model.js';
import Checklist from '../models/checklist.model.js';
import SafetyTip from '../models/safetyTip.model.js';
import { appConfig } from '../data/appConfig.js';
import { createSlug } from './security.service.js';

export const normalizeCategoryName = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const buildCategorySeedPayload = async () => {
  const [tips, checklists] = await Promise.all([
    SafetyTip.find().sort({ createdAt: 1, title: 1 }).select('category').lean(),
    Checklist.find({ type: 'template' })
      .sort({ createdAt: 1, title: 1 })
      .select('category')
      .lean()
  ]);

  const orderedNames = [];
  const seen = new Set();

  for (const name of [
    ...(appConfig.emergencyCategories || []),
    ...tips.map((tip) => tip.category),
    ...checklists.map((checklist) => checklist.category)
  ]) {
    const normalizedName = normalizeCategoryName(name);

    if (!normalizedName) {
      continue;
    }

    const slug = createSlug(normalizedName);

    if (!slug || seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    orderedNames.push(normalizedName);
  }

  return orderedNames.map((name, index) => ({
    name,
    slug: createSlug(name),
    description: '',
    sortOrder: index + 1
  }));
};

export const syncManagedCategoriesFromContentIfEmpty = async () => {
  const existingCount = await Category.countDocuments();

  if (existingCount > 0) {
    return;
  }

  const seedPayload = await buildCategorySeedPayload();

  if (seedPayload.length === 0) {
    return;
  }

  try {
    await Category.insertMany(seedPayload, { ordered: false });
  } catch (error) {
    if (error?.code !== 11000 && error?.name !== 'BulkWriteError') {
      throw error;
    }
  }
};

export const listManagedCategories = async () => {
  await syncManagedCategoriesFromContentIfEmpty();

  return Category.find().sort({ sortOrder: 1, name: 1 }).lean();
};

export const getManagedCategoryNames = async () => {
  const categories = await listManagedCategories();
  return categories.map((category) => category.name);
};

export const resolveManagedCategoryName = async (value) => {
  const normalizedName = normalizeCategoryName(value);

  if (!normalizedName) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'category is required');
  }

  await syncManagedCategoriesFromContentIfEmpty();

  const category = await Category.findOne({
    slug: createSlug(normalizedName)
  }).lean();

  if (!category) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Unknown category. Create it from the dashboard first'
    );
  }

  return category.name;
};
