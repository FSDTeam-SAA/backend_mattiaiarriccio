import catchAsync from '../utils/catchAsync.js';
import {
  listManagedCategories,
  localizedCategoryName,
  localizedCategoryDescription
} from '../services/category.service.js';
import { resolveRequestLanguage } from '../services/language.service.js';
import { sendSuccess } from '../utils/response.js';

export const listCategoriesForUser = catchAsync(async (req, res) => {
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const categories = await listManagedCategories();

  sendSuccess(res, {
    message: 'Categories fetched successfully',
    data: categories.map((category) => ({
      id: category._id,
      slug: category.slug,
      name: localizedCategoryName(category, language),
      description: localizedCategoryDescription(category, language),
      sortOrder: category.sortOrder
    }))
  });
});
