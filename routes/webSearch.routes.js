import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  listApprovedDomains,
  createApprovedDomain,
  updateApprovedDomain,
  deleteApprovedDomain
} from '../controllers/approvedDomain.controller.js';
import {
  listAdminLiveInfoSuggestions,
  createLiveInfoSuggestion,
  updateLiveInfoSuggestion,
  deleteLiveInfoSuggestion
} from '../controllers/liveInfoSuggestion.controller.js';
import { getWebSearchUsage } from '../controllers/webSearchUsage.controller.js';

// Admin CRUD -> mount at /api/v1/admin/approved-domains
export const adminApprovedDomainRouter = Router();
adminApprovedDomainRouter.use(requireAuth('admin'));
adminApprovedDomainRouter.get('/', listApprovedDomains);
adminApprovedDomainRouter.post('/', createApprovedDomain);
adminApprovedDomainRouter.patch('/:domainId', updateApprovedDomain);
adminApprovedDomainRouter.delete('/:domainId', deleteApprovedDomain);

// Admin CRUD -> mount at /api/v1/admin/live-info-suggestions
export const adminLiveInfoSuggestionRouter = Router();
adminLiveInfoSuggestionRouter.use(requireAuth('admin'));
adminLiveInfoSuggestionRouter.get('/', listAdminLiveInfoSuggestions);
adminLiveInfoSuggestionRouter.post('/', createLiveInfoSuggestion);
adminLiveInfoSuggestionRouter.patch('/:suggestionId', updateLiveInfoSuggestion);
adminLiveInfoSuggestionRouter.delete('/:suggestionId', deleteLiveInfoSuggestion);

// Admin read-only -> mount at /api/v1/admin/web-search-usage
export const adminWebSearchUsageRouter = Router();
adminWebSearchUsageRouter.use(requireAuth('admin'));
adminWebSearchUsageRouter.get('/', getWebSearchUsage);
