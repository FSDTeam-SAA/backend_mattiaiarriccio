import {
  DEFAULT_AI_EMERGENCY_TYPE,
  getAiServiceInfo
} from '../services/ai.service.js';

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
    'AI answers are generated in this backend by calling OpenAI directly (see `services/ai.service.js`); configure `OPENAI_API_KEY` and optionally `OPENAI_MODEL`.',
    `Chat requests accept an \`emergencyType\`; this backend reuses the stored conversation type or falls back to \`${DEFAULT_AI_EMERGENCY_TYPE}\`.`,
    'Live-information answers use the OpenAI native `web_search` tool, restricted to the admin-managed approved domains. The tool is only offered when the message matches `webSearchTriggers`, so ordinary questions cost nothing extra.',
    'Chat responses carry `usedWebSearch` and `sources[]`; the SSE stream adds a `status` event (`searching`) so the app can show a live-lookup indicator.',
    'Transient upstream AI `502/503/504` responses are retried once, and HTML upstream error pages are summarized before being returned to clients.',
    'Password reset OTP responses include a debug OTP outside production so the mobile team can complete the flow without email infrastructure.',
    'Categories are managed from admin CRUD and power the category lists returned by the home and content endpoints.',
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
        { method: 'POST', path: '/auth/social-login', description: 'Issue a local session after Google sign-in. Requires `provider: google` and a Google `idToken`.' },
        { method: 'POST', path: '/auth/password-reset/request', description: 'Request OTP for user password reset.' },
        { method: 'POST', path: '/auth/password-reset/verify', description: 'Verify OTP and receive reset token.' },
        { method: 'POST', path: '/auth/password-reset/reset', description: 'Reset password using verified reset token.' },
        { method: 'POST', path: '/auth/logout', description: 'Invalidate the current session token.' }
      ]
    },
    {
      name: 'User App',
      routes: [
        { method: 'GET', path: '/home', description: 'Home screen payload: cards, featured guides, checklist summary, recent chats, and admin-managed categories.' },
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
        { method: 'GET', path: '/checklists', description: 'List shared template checklists and the current user’s custom checklists with progress. When a user has personalized a template, the personalized copy is returned instead of the shared original.' },
        { method: 'POST', path: '/checklists', description: 'Create a custom checklist. Supports multipart image upload via fields `icon` and `coverImage`; send `items` as a JSON string when using multipart.' },
        { method: 'GET', path: '/checklists/:checklistId', description: 'Fetch checklist detail with completion state. If the requested shared template has already been personalized by the current user, the personalized copy is returned.' },
        { method: 'PATCH', path: '/checklists/:checklistId', description: 'Update a custom checklist title, description, items, or media. If the target checklist is a shared template, the first edit automatically creates a personalized custom copy for the current user and applies the update there. Supports multipart image upload via fields `icon` and `coverImage`; send `items` as a JSON string when using multipart.' },
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
        { method: 'GET', path: '/chat/config', description: 'Welcome message, suggested questions, and the Live Information shortcuts for the caller language, plus `webSearchEnabled` (false when the feature is off or no source is approved).' },
        { method: 'POST', path: '/chat/messages', description: `Send a message, generate the reply, store it, and return both messages. When provided, \`emergencyType\` is used directly; otherwise the conversation type is reused or it falls back to \`${DEFAULT_AI_EMERGENCY_TYPE}\`. Optional \`location: { city, region, country, timezone }\` biases live searches and is remembered for follow-ups. Response adds \`usedWebSearch\`, \`sources[]\`, and \`liveInfoLimited\`.` },
        { method: 'POST', path: '/chat/messages/stream', description: 'Send a message and stream assistant output as Server-Sent Events: meta, status, delta, done, or error. `status` carries `{ state: "searching" }` while live sources are being consulted.' },
        { method: 'DELETE', path: '/chat/conversations/:conversationId', description: 'Delete a stored conversation.' }
      ]
    },
    {
      name: 'Admin',
      routes: [
        { method: 'GET', path: '/admin/dashboard', description: 'Summary metrics and recent activity for the admin dashboard.' },
        { method: 'GET', path: '/admin/ai-prompt', description: 'Read the per-language prompt configuration. Omit `language` to get both `{ en, it }`.' },
        { method: 'PATCH', path: '/admin/ai-prompt', description: 'Update the per-language prompt configuration (welcome, system instruction, fallback, suggested questions).' },
        { method: 'GET', path: '/admin/approved-domains', description: 'List approved Web Search sources. Returns `activeCount`/`maxAllowed` so the UI can warn past the 20-domain OpenAI cap.' },
        { method: 'POST', path: '/admin/approved-domains', description: 'Add an approved source. Accepts a full URL and normalizes it to a bare hostname.' },
        { method: 'PATCH', path: '/admin/approved-domains/:domainId', description: 'Edit, reorder, or enable/disable an approved source.' },
        { method: 'DELETE', path: '/admin/approved-domains/:domainId', description: 'Remove an approved source.' },
        { method: 'GET', path: '/admin/live-info-suggestions', description: 'List the Live Information shortcuts shown in chat. Filter by `language` and `active`.' },
        { method: 'POST', path: '/admin/live-info-suggestions', description: 'Create a Live Information shortcut (icon, title, prompt, language, order).' },
        { method: 'PATCH', path: '/admin/live-info-suggestions/:suggestionId', description: 'Edit, reorder, or enable/disable a Live Information shortcut.' },
        { method: 'DELETE', path: '/admin/live-info-suggestions/:suggestionId', description: 'Remove a Live Information shortcut.' },
        { method: 'GET', path: '/admin/web-search-usage', description: 'Web Search counters: searches today, this month, total, plus a daily series (`days`, default 30).' },
        { method: 'GET', path: '/admin/categories', description: 'List dashboard-managed categories with checklist and safety-tip usage counts.' },
        { method: 'POST', path: '/admin/categories', description: 'Create a dashboard-managed category for checklist and safety-tip assignment.' },
        { method: 'PATCH', path: '/admin/categories/:categoryId', description: 'Rename or reorder a category. Renames cascade to template checklists and safety tips.' },
        { method: 'DELETE', path: '/admin/categories/:categoryId', description: 'Delete an unused category. Returns a conflict when checklist or safety-tip content still uses it.' },
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
