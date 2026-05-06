import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import SafetyTip from '../models/safetyTip.model.js';
import {
  getManagedCategoryNames,
  getManagedCategoryMap,
  localizedCategoryName
} from '../services/category.service.js';
import {
  normalizeLanguageCode,
  resolveRequestLanguage
} from '../services/language.service.js';
import { paginate, parsePagination, sendSuccess } from '../utils/response.js';

const mapSafetyTipCard = (tip, categoryMap, language) => {
  const category = categoryMap.get(tip.category);
  return {
    id: tip._id,
    slug: tip.slug,
    title: tip.title,
    category: localizedCategoryName(category, language),
    categorySlug: tip.category,
    summary: tip.summary,
    estimatedReadMinutes: tip.estimatedReadMinutes,
    thumbnailUrl: tip.thumbnailUrl,
    coverImageUrl: tip.coverImageUrl,
    tags: tip.tags,
    language: normalizeLanguageCode(tip.language, 'en'),
    featured: tip.featured,
    updatedAt: tip.updatedAt
  };
};

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

export const listSafetyTips = catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query, {
    page: 1,
    limit: 10,
    maxLimit: 50
  });

  const search = String(req.query.search || '').trim().toLowerCase();
  const categoryFilter = String(req.query.category || '').trim().toLowerCase();
  const featuredOnly = String(req.query.featured || '').trim().toLowerCase() === 'true';
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);

  const [allTips, categoryMap, managedCategoryNames] = await Promise.all([
    SafetyTip.find({
      status: 'published',
      ...languageQueryFor(language)
    })
      .sort({ updatedAt: -1 })
      .lean(),
    getManagedCategoryMap(),
    getManagedCategoryNames(language)
  ]);

  let tips = allTips;

  if (categoryFilter) {
    tips = tips.filter((tip) => {
      const category = categoryMap.get(tip.category);
      const localizedName = localizedCategoryName(category, language).toLowerCase();
      return (
        tip.category.toLowerCase() === categoryFilter ||
        localizedName === categoryFilter
      );
    });
  }

  if (featuredOnly) {
    tips = tips.filter((tip) => tip.featured);
  }

  if (search) {
    tips = tips.filter((tip) => {
      const category = categoryMap.get(tip.category);
      const localizedName = localizedCategoryName(category, language);
      return [tip.title, tip.summary, localizedName, ...(tip.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  }

  const paged = paginate(
    tips.map((tip) => mapSafetyTipCard(tip, categoryMap, language)),
    page,
    limit
  );

  sendSuccess(res, {
    message: 'Safety tips fetched successfully',
    data: paged.items,
    meta: {
      ...paged.meta,
      categories: managedCategoryNames
    }
  });
});

export const getSafetyTipById = catchAsync(async (req, res) => {
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const tip = await SafetyTip.findOne({
    $or: [{ _id: req.params.tipId }, { slug: req.params.tipId }],
    status: 'published',
    ...languageQueryFor(language)
  }).lean();

  if (!tip) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Safety tip not found');
  }

  const [relatedTips, categoryMap] = await Promise.all([
    SafetyTip.find({
      _id: { $ne: tip._id },
      status: 'published',
      category: tip.category,
      ...languageQueryFor(language)
    })
      .limit(3)
      .lean(),
    getManagedCategoryMap()
  ]);

  const category = categoryMap.get(tip.category);

  sendSuccess(res, {
    message: 'Safety tip fetched successfully',
    data: {
      id: tip._id,
      slug: tip.slug,
      title: tip.title,
      category: localizedCategoryName(category, language),
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
      language: normalizeLanguageCode(tip.language, 'en'),
      featured: tip.featured,
      createdAt: tip.createdAt,
      updatedAt: tip.updatedAt,
      relatedTips: relatedTips.map((related) =>
        mapSafetyTipCard(related, categoryMap, language)
      )
    }
  });
});
