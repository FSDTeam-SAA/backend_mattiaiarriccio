import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import User from '../models/user.model.js';
import Notification from '../models/notification.model.js';
import Checklist from '../models/checklist.model.js';
import ChecklistProgress from '../models/checklistProgress.model.js';
import Conversation from '../models/conversation.model.js';
import LegalDocument from '../models/legalDocument.model.js';
import SafetyTip from '../models/safetyTip.model.js';
import { appConfig } from '../data/appConfig.js';
import { createId } from '../lib/id.js';
import {
  getManagedCategoryNames,
  getManagedCategoryMap,
  localizedCategoryName
} from '../services/category.service.js';
import {
  ensureSupportedLanguage,
  homeCopyFor,
  messageFor,
  resolveRequestLanguage
} from '../services/language.service.js';
import {
  ensurePasswordStrength,
  ensureConfirmedPassword,
  verifyPassword,
  hashPassword
} from '../services/security.service.js';
import { resolveImageUrl } from '../services/media.service.js';
import { sendSuccess } from '../utils/response.js';
import { publicUser } from '../utils/serializers.js';

const getProvidedUserName = (body = {}) => {
  for (const key of ['username', 'userName', 'fullName', 'firstName']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return String(body[key] || '').trim();
    }
  }

  return undefined;
};

const normalizeName = (firstName, lastName) =>
  `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim();

const checklistProgressSummary = (checklists, progressEntries) => {
  const progressMap = new Map(progressEntries.map((entry) => [entry.checklistId, entry]));

  const completedChecklists = checklists.filter((checklist) => {
    const progress = progressMap.get(checklist._id);
    return progress && progress.completedItemIds.length >= checklist.items.length;
  }).length;

  return {
    total: checklists.length,
    completed: completedChecklists
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

const conversationSummary = (conversation) => ({
  id: conversation._id,
  title: conversation.title,
  lastMessagePreview:
    conversation.messages[conversation.messages.length - 1]?.content || '',
  updatedAt: conversation.updatedAt,
  messageCount: conversation.messages.length
});

export const getCurrentUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.auth.user._id).lean();
  const language = resolveRequestLanguage(req, user?.preferredLanguage);

  sendSuccess(res, {
    message: messageFor(language, 'currentUserFetched'),
    data: publicUser(user)
  });
});

export const updateCurrentUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.auth.user._id);

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const providedUserName = getProvidedUserName(req.body);
  const hasExplicitLastName = Object.prototype.hasOwnProperty.call(req.body, 'lastName');
  const nextFirstName = providedUserName !== undefined ? providedUserName : user.firstName;
  let nextLastName = hasExplicitLastName ? String(req.body.lastName || '').trim() : user.lastName;

  // Mobile edit profile currently submits one full-name field only.
  // When that full name is provided without an explicit lastName, clear stale lastName
  // to prevent duplicated display values like "Aliul Akon A Akon".
  if (providedUserName !== undefined && !hasExplicitLastName && /\s/.test(providedUserName)) {
    nextLastName = '';
  }

  if (!nextFirstName) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Username is required');
  }

  user.firstName = nextFirstName;
  user.lastName = nextLastName;
  user.fullName = normalizeName(nextFirstName, nextLastName);

  if (req.body.phoneNumber !== undefined) {
    user.phoneNumber = String(req.body.phoneNumber).trim();
  }

  user.avatarUrl = await resolveImageUrl({
    req,
    folder: 'users/avatars',
    fieldNames: ['avatar', 'avatarImage', 'avatarUrl'],
    bodyValue: req.body.avatarUrl,
    currentValue: user.avatarUrl
  });

  await user.save();
  const language = resolveRequestLanguage(req, user.preferredLanguage);

  sendSuccess(res, {
    message:
      language === 'it'
        ? 'Profilo aggiornato correttamente'
        : 'Profile updated successfully',
    data: publicUser(user.toObject())
  });
});

export const getUserPreferences = catchAsync(async (req, res) => {
  const user = await User.findById(req.auth.user._id).lean();
  const language = resolveRequestLanguage(req, user?.preferredLanguage);

  sendSuccess(res, {
    message: messageFor(language, 'userPreferencesFetched'),
    data: {
      preferredLanguage: user.preferredLanguage,
      notificationsEnabled: user.notificationsEnabled,
      onboardingCompleted: user.onboardingCompleted,
      supportedLanguages: appConfig.supportedLanguages
    }
  });
});

export const updateUserPreferences = catchAsync(async (req, res) => {
  const user = await User.findById(req.auth.user._id);

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  if (req.body.preferredLanguage !== undefined) {
    user.preferredLanguage = ensureSupportedLanguage(req.body.preferredLanguage);
  }

  if (req.body.notificationsEnabled !== undefined) {
    user.notificationsEnabled = Boolean(req.body.notificationsEnabled);
  }

  if (req.body.onboardingCompleted !== undefined) {
    user.onboardingCompleted = Boolean(req.body.onboardingCompleted);
  }

  await user.save();

  sendSuccess(res, {
    message: messageFor(user.preferredLanguage, 'preferencesUpdated'),
    data: {
      preferredLanguage: user.preferredLanguage,
      notificationsEnabled: user.notificationsEnabled,
      onboardingCompleted: user.onboardingCompleted,
      supportedLanguages: appConfig.supportedLanguages
    }
  });
});

export const changePassword = catchAsync(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = ensurePasswordStrength(req.body.newPassword);
  const confirmNewPassword = String(req.body.confirmNewPassword || '');

  ensureConfirmedPassword(newPassword, confirmNewPassword);

  const user = await User.findById(req.auth.user._id);

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const passwordMatches = await verifyPassword(currentPassword, user.passwordHash);

  if (!passwordMatches) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Current password is incorrect');
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  const language = resolveRequestLanguage(req, user.preferredLanguage);

  sendSuccess(res, {
    message:
      language === 'it'
        ? 'Password aggiornata correttamente'
        : 'Password changed successfully'
  });
});

export const getHome = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const language = resolveRequestLanguage(req, req.auth.user.preferredLanguage);
  const copy = homeCopyFor(language);
  const featuredGuideQuery = {
    status: 'published',
    featured: true,
    ...languageQueryFor(language)
  };

  const [
    user,
    checklists,
    progressEntries,
    featuredGuides,
    conversations,
    unreadNotifications,
    categories,
    categoryMap
  ] =
    await Promise.all([
      User.findById(userId).lean(),
      Checklist.find({
        $and: [
          {
            $or: [
              { type: 'template', status: 'published' },
              { type: 'custom', ownerId: userId }
            ]
          },
          languageQueryFor(language)
        ]
      }).lean(),
      ChecklistProgress.find({ userId }).lean(),
      SafetyTip.find(featuredGuideQuery)
        .sort({ updatedAt: -1 })
        .limit(4)
        .lean(),
      Conversation.find({ userId }).sort({ updatedAt: -1 }).limit(5).lean(),
      Notification.countDocuments({ userId, read: false }),
      getManagedCategoryNames(language),
      getManagedCategoryMap()
    ]);
  const hiddenTemplateChecklistIds = new Set(
    progressEntries
      .filter((entry) => entry.hidden)
      .map((entry) => entry.checklistId)
  );
  const visibleChecklists = checklists.filter(
    (checklist) =>
      checklist.type !== 'template' ||
      !hiddenTemplateChecklistIds.has(checklist._id)
  );

  sendSuccess(res, {
    message: messageFor(language, 'homeFetched'),
    data: {
      user: publicUser(user),
      greeting: {
        title: language === 'it' ? `Ciao, ${user.firstName}` : `Hello, ${user.firstName}`,
        subtitle: copy.greetingSubtitle
      },
      quickActions: [
        {
          id: 'quick_ai_chat',
          title: copy.quickActions.quick_ai_chat.title,
          description: copy.quickActions.quick_ai_chat.description,
          route: '/chat/messages'
        },
        {
          id: 'quick_guides',
          title: copy.quickActions.quick_guides.title,
          description: copy.quickActions.quick_guides.description,
          route: '/safety-tips'
        },
        {
          id: 'quick_checklists',
          title: copy.quickActions.quick_checklists.title,
          description: copy.quickActions.quick_checklists.description,
          route: '/checklists'
        }
      ],
      featuredGuides: featuredGuides.map((tip) => {
        const category = categoryMap.get(tip.category);
        return {
          id: tip._id,
          slug: tip.slug,
          title: tip.title,
          category: localizedCategoryName(category, language),
          categorySlug: tip.category,
          summary: tip.summary,
          thumbnailUrl: tip.thumbnailUrl,
          estimatedReadMinutes: tip.estimatedReadMinutes
        };
      }),
      checklistSummary: checklistProgressSummary(visibleChecklists, progressEntries),
      chatHistoryPreview: conversations.map(conversationSummary),
      categories,
      unreadNotifications
    }
  });
});

export const getLegalDocument = catchAsync(async (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  const document = await LegalDocument.findOne({ slug }).lean();

  if (!document) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Legal document not found');
  }

  sendSuccess(res, {
    message: 'Legal document fetched successfully',
    data: {
      id: document._id,
      slug: document.slug,
      title: document.title,
      body: document.body,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt
    }
  });
});

export const listNotifications = catchAsync(async (req, res) => {
  const notifications = await Notification.find({ userId: req.auth.user._id })
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, {
    message: 'Notifications fetched successfully',
    data: notifications.map((notification) => ({
      id: notification._id,
      userId: notification.userId,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      read: notification.read,
      createdAt: notification.createdAt
    }))
  });
});

export const markNotificationRead = catchAsync(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: req.params.notificationId,
      userId: req.auth.user._id
    },
    {
      $set: {
        read: true
      }
    },
    {
      new: true
    }
  ).lean();

  if (!notification) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found');
  }

  sendSuccess(res, {
    message: 'Notification marked as read',
    data: {
      id: notification._id,
      userId: notification.userId,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      read: notification.read,
      createdAt: notification.createdAt
    }
  });
});

export const createNotification = catchAsync(async (req, res) => {
  const notification = await Notification.create({
    _id: createId('notif'),
    userId: req.auth.user._id,
    title: String(req.body.title || 'Custom notification').trim(),
    body: String(req.body.body || 'No details provided').trim(),
    type: String(req.body.type || 'general').trim(),
    read: false
  });

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Notification created successfully',
    data: {
      id: notification._id,
      userId: notification.userId,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      read: notification.read,
      createdAt: notification.createdAt
    }
  });
});
