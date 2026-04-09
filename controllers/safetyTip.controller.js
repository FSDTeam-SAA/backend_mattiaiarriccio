import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import SafetyTip from '../models/safetyTip.model.js';
import { paginate, parsePagination, sendSuccess } from '../utils/response.js';

const mapSafetyTipCard = (tip) => ({
  id: tip._id,
  slug: tip.slug,
  title: tip.title,
  category: tip.category,
  summary: tip.summary,
  estimatedReadMinutes: tip.estimatedReadMinutes,
  thumbnailUrl: tip.thumbnailUrl,
  coverImageUrl: tip.coverImageUrl,
  tags: tip.tags,
  featured: tip.featured,
  updatedAt: tip.updatedAt
});

export const listSafetyTips = catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query, {
    page: 1,
    limit: 10,
    maxLimit: 50
  });

  const search = String(req.query.search || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim();
  const featuredOnly = String(req.query.featured || '').trim().toLowerCase() === 'true';

  const allTips = await SafetyTip.find({ status: 'published' }).sort({ updatedAt: -1 }).lean();

  let tips = allTips;

  if (category) {
    tips = tips.filter((tip) => tip.category.toLowerCase() === category.toLowerCase());
  }

  if (featuredOnly) {
    tips = tips.filter((tip) => tip.featured);
  }

  if (search) {
    tips = tips.filter((tip) =>
      [tip.title, tip.summary, tip.category, ...(tip.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }

  const paged = paginate(tips.map(mapSafetyTipCard), page, limit);

  sendSuccess(res, {
    message: 'Safety tips fetched successfully',
    data: paged.items,
    meta: {
      ...paged.meta,
      categories: [...new Set(allTips.map((tip) => tip.category))].sort()
    }
  });
});

export const getSafetyTipById = catchAsync(async (req, res) => {
  const tip = await SafetyTip.findOne({
    $or: [{ _id: req.params.tipId }, { slug: req.params.tipId }],
    status: 'published'
  }).lean();

  if (!tip) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Safety tip not found');
  }

  const relatedTips = await SafetyTip.find({
    _id: { $ne: tip._id },
    status: 'published',
    category: tip.category
  })
    .limit(3)
    .lean();

  sendSuccess(res, {
    message: 'Safety tip fetched successfully',
    data: {
      id: tip._id,
      slug: tip.slug,
      title: tip.title,
      category: tip.category,
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
      updatedAt: tip.updatedAt,
      relatedTips: relatedTips.map(mapSafetyTipCard)
    }
  });
});
