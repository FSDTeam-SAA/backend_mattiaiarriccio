import { getAiServiceInfo } from '../services/ai.service.js';

const aiInfo = getAiServiceInfo();

export const apiCatalog = {
  title: 'We Safe Backend API',
  version: '1.0.0',
  basePath: '/api/v1',
  aiService: aiInfo,
  sampleAccounts: {
    user: {
      email: 'madiha.aroa@example.com',
      password: 'Password123!'
    },
    admin: {
      email: 'admin@wesafe.app',
      password: 'Admin123!'
    }
  },
  notes: [
    'All authenticated routes expect a Bearer token returned by login or registration.',
    'This backend proxies AI answers from the hosted Python service at the URL above.',
    'Password reset OTP responses include a debug OTP outside production so the mobile team can complete the flow without email infrastructure.',
    'User registration and profile updates accept a single `username` or `userName` field; legacy `firstName` and `lastName` payloads still work.',
    'Image-bearing create/update endpoints accept multipart/form-data directly. When multipart also includes arrays such as items or contentSections, send those structured fields as JSON strings.'
  ],
  groups: [
    {
      name: 'Auth',
      routes: [
        { method: 'POST', path: '/auth/register', description: 'Create a user account and return an access token. Accepts a single `username` or `userName` field and supports multipart avatar upload via field `avatar`.' },
        { method: 'POST', path: '/auth/login', description: 'User email/password login.' },
        { method: 'POST', path: '/auth/admin/login', description: 'Admin email/password login.' },
        { method: 'POST', path: '/auth/social-login', description: 'Issue a local session after client-side provider sign-in. Supports multipart avatar upload via field `avatar`.' },
        { method: 'POST', path: '/auth/password-reset/request', description: 'Request OTP for user password reset.' },
        { method: 'POST', path: '/auth/password-reset/verify', description: 'Verify OTP and receive reset token.' },
        { method: 'POST', path: '/auth/password-reset/reset', description: 'Reset password using verified reset token.' },
        { method: 'POST', path: '/auth/logout', description: 'Invalidate the current session token.' }
      ]
    },
    {
      name: 'User App',
      routes: [
        { method: 'GET', path: '/home', description: 'Home screen payload: cards, featured guides, checklist summary, and recent chats.' },
        { method: 'GET', path: '/users/me', description: 'Current user profile.' },
        { method: 'PATCH', path: '/users/me', description: 'Update profile fields shown in the mobile settings flow. Accepts a single `username` or `userName` field and supports multipart avatar upload via field `avatar`.' },
        { method: 'GET', path: '/users/me/preferences', description: 'Get language and notification preferences.' },
        { method: 'PATCH', path: '/users/me/preferences', description: 'Update preferred language, notifications, and onboarding flag.' },
        { method: 'PATCH', path: '/users/me/password', description: 'Change password while authenticated.' },
        { method: 'GET', path: '/notifications', description: 'List notification cards for the user.' },
        { method: 'PATCH', path: '/notifications/:notificationId/read', description: 'Mark a notification as read.' },
        { method: 'GET', path: '/legal/:slug', description: 'Fetch about, privacy policy, or terms screen content.' }
      ]
    },
    {
      name: 'Safety Tips',
      routes: [
        { method: 'GET', path: '/safety-tips', description: 'Paginated list of published safety guides with search and category filters.' },
        { method: 'GET', path: '/safety-tips/:tipId', description: 'Full guide detail payload.' }
      ]
    },
    {
      name: 'Checklists',
      routes: [
        { method: 'GET', path: '/checklists', description: 'List template checklists and the current user’s custom checklists with progress.' },
        { method: 'POST', path: '/checklists', description: 'Create a custom checklist. Supports multipart image upload via fields `icon` and `coverImage`; send `items` as a JSON string when using multipart.' },
        { method: 'GET', path: '/checklists/:checklistId', description: 'Fetch checklist detail with completion state.' },
        { method: 'PATCH', path: '/checklists/:checklistId', description: 'Update a custom checklist title, description, or media. Supports multipart image upload via fields `icon` and `coverImage`; send `items` as a JSON string when using multipart.' },
        { method: 'DELETE', path: '/checklists/:checklistId', description: 'Delete a custom checklist.' },
        { method: 'POST', path: '/checklists/:checklistId/items', description: 'Add item to a custom checklist.' },
        { method: 'PATCH', path: '/checklists/:checklistId/items/:itemId', description: 'Toggle completion on any accessible checklist item; edit text on custom items.' },
        { method: 'DELETE', path: '/checklists/:checklistId/items/:itemId', description: 'Delete item from a custom checklist.' }
      ]
    },
    {
      name: 'Chat',
      routes: [
        { method: 'GET', path: '/chat/conversations', description: 'List local chat history summaries for the user.' },
        { method: 'GET', path: '/chat/history', description: 'Alias of the chat history list for the mobile history tab.' },
        { method: 'GET', path: '/chat/conversations/:conversationId', description: 'Fetch one conversation thread.' },
        { method: 'POST', path: '/chat/messages', description: 'Send a message, call the hosted AI backend, store the reply locally, and return both messages.' },
        { method: 'DELETE', path: '/chat/conversations/:conversationId', description: 'Delete a stored conversation.' }
      ]
    },
    {
      name: 'Admin',
      routes: [
        { method: 'GET', path: '/admin/dashboard', description: 'Summary metrics and recent activity for the admin dashboard.' },
        { method: 'GET', path: '/admin/ai-prompt', description: 'Read the live prompt configuration from the hosted Python AI service.' },
        { method: 'PATCH', path: '/admin/ai-prompt', description: 'Update the live prompt configuration through the hosted Python AI service.' },
        { method: 'GET', path: '/admin/checklists', description: 'List template checklists for admin CRUD.' },
        { method: 'POST', path: '/admin/checklists', description: 'Create template checklist. Supports multipart image upload via fields `icon` and `coverImage`; send `items` as a JSON string when using multipart.' },
        { method: 'PATCH', path: '/admin/checklists/:checklistId', description: 'Update template checklist. Supports multipart image upload via fields `icon` and `coverImage`; send `items` as a JSON string when using multipart.' },
        { method: 'DELETE', path: '/admin/checklists/:checklistId', description: 'Delete template checklist.' },
        { method: 'GET', path: '/admin/safety-tips', description: 'List all safety tips for admin CRUD.' },
        { method: 'POST', path: '/admin/safety-tips', description: 'Create safety tip. Supports multipart image upload via fields `coverImage` and `thumbnail`; send contentSections/doList/dontList/tags as JSON strings when using multipart.' },
        { method: 'PATCH', path: '/admin/safety-tips/:tipId', description: 'Update safety tip. Supports multipart image upload via fields `coverImage` and `thumbnail`; send contentSections/doList/dontList/tags as JSON strings when using multipart.' },
        { method: 'DELETE', path: '/admin/safety-tips/:tipId', description: 'Delete safety tip.' },
        { method: 'GET', path: '/admin/settings', description: 'Admin profile settings.' },
        { method: 'PATCH', path: '/admin/settings', description: 'Update admin profile settings. Supports multipart avatar upload via field `avatar`.' },
        { method: 'GET', path: '/admin/activity', description: 'Full recent activity feed.' }
      ]
    },
    {
      name: 'Uploads',
      routes: [
        { method: 'POST', path: '/uploads', description: 'Upload image to Cloudinary for checklist icons, cover images, or guide artwork.' },
        { method: 'DELETE', path: '/uploads/:publicId', description: 'Delete a Cloudinary image.' }
      ]
    }
  ]
};
