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
import { isPremiumUser } from '../services/premium.service.js';
import { getSetting } from '../services/settings.service.js';
import { paginate, parsePagination, sendSuccess } from '../utils/response.js';

const mapSafetyTipCard = (tip, categoryMap, language, { locked = false } = {}) => {
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
    premiumOnly: Boolean(tip.premiumOnly),
    locked,
    updatedAt: tip.updatedAt
  };
};

const shouldLockPremiumGuides = async () => {
  const accessRules = await getSetting('accessRules');
  return accessRules?.premiumGuidesLocked !== false;
};

const isSafetyTipLockedForUser = (tip, user, lockPremiumGuides = true) =>
  lockPremiumGuides && Boolean(tip?.premiumOnly) && !isPremiumUser(user);

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

  const [allTips, categoryMap, managedCategoryNames, lockPremiumGuides] = await Promise.all([
    SafetyTip.find({
      status: 'published',
      ...languageQueryFor(language)
    })
      .sort({ updatedAt: -1 })
      .lean(),
    getManagedCategoryMap(),
    getManagedCategoryNames(language),
    shouldLockPremiumGuides()
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

  const user = req.auth.user;
  const paged = paginate(
    tips.map((tip) =>
      mapSafetyTipCard(tip, categoryMap, language, {
        locked: isSafetyTipLockedForUser(tip, user, lockPremiumGuides)
      })
    ),
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
    status: 'published',
    $and: [
      { $or: [{ _id: req.params.tipId }, { slug: req.params.tipId }] },
      languageQueryFor(language)
    ]
  }).lean();

  if (!tip) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Safety tip not found');
  }

  const lockPremiumGuides = await shouldLockPremiumGuides();

  if (isSafetyTipLockedForUser(tip, req.auth.user, lockPremiumGuides)) {
    const err = new ApiError(
      StatusCodes.FORBIDDEN,
      'This guide is available to premium members only'
    );
    err.code = 'PREMIUM_REQUIRED';
    throw err;
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
  const user = req.auth.user;

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
      premiumOnly: Boolean(tip.premiumOnly),
      locked: false,
      createdAt: tip.createdAt,
      updatedAt: tip.updatedAt,
      relatedTips: relatedTips.map((related) =>
        mapSafetyTipCard(related, categoryMap, language, {
          locked: isSafetyTipLockedForUser(related, user, lockPremiumGuides)
        })
      )
    }
  });
});
