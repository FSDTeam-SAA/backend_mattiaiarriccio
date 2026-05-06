import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import Category from '../models/category.model.js';
import { appConfig } from '../data/appConfig.js';
import { createSlug } from './security.service.js';
import { normalizeLanguageCode } from './language.service.js';

const SUPPORTED_LANGS = appConfig.supportedLanguages.map((lang) => lang.code);

export const localizedCategoryName = (category, language) => {
  if (!category) return '';
  const lang = normalizeLanguageCode(language, 'en');
  const names = category.names || {};
  return String(names[lang] || names.en || '').trim();
};

export const localizedCategoryDescription = (category, language) => {
  if (!category) return '';
  const lang = normalizeLanguageCode(language, 'en');
  const descriptions = category.descriptions || {};
  return String(descriptions[lang] || descriptions.en || '').trim();
};

export const normalizeLocalizedField = (input, fallback = {}) => {
  const result = {};
  for (const lang of SUPPORTED_LANGS) {
    const fromInput =
      typeof input === 'object' && input !== null ? input[lang] : undefined;
    const value =
      fromInput !== undefined ? fromInput : fallback[lang];
    result[lang] = String(value || '').trim();
  }
  return result;
};

const buildSeedCategoryPayload = () =>
  appConfig.emergencyCategories.map((entry, index) => {
    const slug = entry.slug || createSlug(entry?.names?.en || '');
    return {
      slug,
      names: normalizeLocalizedField(entry.names),
      descriptions: normalizeLocalizedField(entry.descriptions),
      sortOrder: index + 1
    };
  });

export const syncManagedCategoriesFromContentIfEmpty = async () => {
  const existingCount = await Category.countDocuments();

  if (existingCount > 0) {
    return;
  }

  const seedPayload = buildSeedCategoryPayload();

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

  return Category.find().sort({ sortOrder: 1, 'names.en': 1 }).lean();
};

export const getManagedCategoryNames = async (language = 'en') => {
  const categories = await listManagedCategories();
  return categories.map((category) => localizedCategoryName(category, language));
};

export const getManagedCategoryMap = async () => {
  const categories = await listManagedCategories();
  const map = new Map();
  for (const category of categories) {
    map.set(category.slug, category);
  }
  return map;
};

export const resolveManagedCategorySlug = async (value) => {
  const slug = String(value || '').trim();

  if (!slug) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'category is required');
  }

  await syncManagedCategoriesFromContentIfEmpty();

  const category = await Category.findOne({ slug }).lean();

  if (!category) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Unknown category. Create it from the dashboard first'
    );
  }

  return category.slug;
};
