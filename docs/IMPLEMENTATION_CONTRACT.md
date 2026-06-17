# Backend Implementation Contract (WeSafe AI scope build)

This file is the single source of truth for conventions. **Every new file must follow it exactly.**
The backend is **JavaScript ESM (NOT TypeScript)**, Express 4, Mongoose 9, Node ESM (`"type":"module"`).
Use `.js` extensions in every relative import.

## 1. IDs
Custom string IDs, never ObjectId. From `../lib/id.js`:
```js
import { createId } from '../lib/id.js';
// usage in a model: _id: { type: String, default: () => createId('subscription') }
```
Pick a short prefix per model (e.g. `sub`, `coupon`, `redemption`, `setting`, `emergency`, `material`, `notifjob`, `device`, `audit`).

## 2. Models (Mongoose)
Pattern — copy this skeleton exactly:
```js
import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const exampleSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => createId('example') },
    userId: { type: String, required: true, index: true },
    // ... fields
  },
  {
    versionKey: false,
    timestamps: true,        // createdAt + updatedAt, unless told "createdAt only"
    collection: 'examples'   // ALWAYS set explicit snake_case collection name
  }
);

exampleSchema.index({ userId: 1 });

const Example = mongoose.models.Example || mongoose.model('Example', exampleSchema);
export default Example;
```
- ALWAYS guard with `mongoose.models.X || mongoose.model(...)`.
- ALWAYS `versionKey: false`.
- Set indexes with `schema.index(...)` after the schema.
- Mixed/object payloads: `type: mongoose.Schema.Types.Mixed`.
- Enums: `{ type: String, enum: [...], default: '...' }`.

## 3. Money
Store in smallest currency unit as an **integer** (e.g. cents). Never a float.

## 4. Controllers
```js
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';

export const doThing = catchAsync(async (req, res) => {
  const user = req.auth.user;            // auth populated by requireAuth
  if (!something) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Clear message');
  }
  sendSuccess(res, { message: 'Done', data: {/* ... */} });
});
```
- All exports are named: `export const handlerName = catchAsync(async (req, res) => {...})`.
- Throw `new ApiError(StatusCodes.X, 'message')` for errors; the global handler formats them.
- Never call `res.status().json()` directly for success — use `sendSuccess(res, { statusCode?, message, data?, meta? })`.
  - `sendSuccess` omits `data` if it's `null`. Pass `data: {...}` or `data: [...]`.
- File naming: `xxx.controller.js`.

## 5. Routes
```js
import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { doThing } from '../controllers/xxx.controller.js';

const router = Router();
router.use(requireAuth('user'));      // or requireAuth('admin'); or requireAuth('user','admin')
router.get('/', doThing);
export default router;
```
- File naming: `xxx.routes.js`. Webhooks that must be public: do NOT add `requireAuth`.
- I (the orchestrator) will mount routers in `app.js` under `/api/v1/...`. In your route contract output, state the intended mount path.

## 6. Auth
`requireAuth(...roles)` populates `req.auth = { session, user }`. Access the caller as `req.auth.user`
(fields: `_id`, `role` ('user'|'admin'), `firstName`, `email`, `tier`, `preferredLanguage`, ...).
Roles are only `'user'` and `'admin'`. Admin guard = `requireAuth('admin')`.
There is NO JWT — auth is opaque session tokens looked up in the `Session` model.

## 7. Response helpers (`../utils/response.js`)
- `sendSuccess(res, { statusCode = 200, message, data, meta })`
- `parsePagination(query, { page, limit, maxLimit })` -> `{ page, limit }`
- `paginate(items, page, limit)` -> `{ items, meta:{page,limit,total,totalPages} }`
Prefer DB-level pagination (`.skip().limit()`) for large lists; use `paginate()` only for already-small arrays.

## 8. Errors (`../utils/ApiError.js`)
`new ApiError(statusCode, message)`. Use `StatusCodes` from `http-status-codes`.
For machine-readable error codes the client checks (e.g. `DAILY_LIMIT_REACHED`, `PREMIUM_REQUIRED`),
the message is human text; ALSO include a stable `code` by throwing a small extension:
```js
const err = new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'Daily limit reached');
err.code = 'DAILY_LIMIT_REACHED';
err.details = { limit, used };
throw err;
```
The global error handler is being extended to surface `code` and `details` in the JSON body.

## 9. Localization (`../services/language.service.js`)
- `resolveRequestLanguage(req, fallback)` — reads body.language/preferredLanguage, query.language,
  `x-app-language` header, `accept-language`. Supported: `'en'`, `'it'`.
- `normalizeLanguageCode(value, fallback)`, `ensureSupportedLanguage(value)`.
- Content the user sees should be localizable. For NEW admin-managed content models that need both
  languages, store localized fields as `{ en: '', it: '' }` objects (like Category `names`/`descriptions`).
  For per-document single-language content, use a `language` field (like Checklist/SafetyTip).
  Each new model's spec says which approach to use.

## 10. File uploads (`../services/media.service.js`)
- Multer middleware: `import upload from '../middlewares/upload.js'` (memory storage, image-only, 10MB).
  In routes use `upload.fields([{ name: 'image', maxCount: 1 }, ...])`.
- Resolve a final image URL with:
```js
import { resolveImageUrl } from '../services/media.service.js';
const imageUrl = await resolveImageUrl({
  req, folder: 'materials', fieldNames: ['image','imageFile','imageUrl'],
  bodyValue: req.body.imageUrl, removeKey: 'removeImageUrl', currentValue: doc.imageUrl, defaultValue: ''
});
```
Do NOT add a new storage provider. Cloudinary only.

## 11. Activity / audit log
Existing generic activity log: `import { logActivity } from '../services/activity.service.js'` →
`logActivity({ type, actorId, title, description })`.
For admin actions on users/premium the spec asks for a dedicated `AuditLog` model
(adminId, action, targetUserId, meta, createdAt) — build that separately AND keep using logActivity
for the human-readable activity feed where it makes sense.

## 12. Request parsing (`../utils/requestParsers.js`)
`parseArrayInput(v)`, `parseBooleanInput(v)`, `parseIntegerInput(v)`, `parseMaybeJson(v)`.
Use these for multipart/form bodies where values arrive as strings/JSON strings.

## 13. Settings access (after Settings service is built — `../services/settings.service.js`)
- `getSetting(key)` (cached ~30s), `getAllSettings()`, `updateSetting(key, value, adminId)`.
- Default keys: `freeDailyMessageLimit`, `freeDailyChatLimit`, `freePrompt`, `premiumPrompt`,
  `accessRules`, `adsEnabled`, `adConfig`, `admUnitIds`, `emergencyOverrideEnabled`,
  `reminderDefaults`, `notificationsEnabled`.
- NEVER hardcode limits/prompts/ad config; read them from Settings.

## 14. Premium (after Premium service is built — `../services/premium.service.js`)
- A user is premium if `user.tier === 'premium'`. Compute via `recomputeTier(userId)`.
- `isAdFree(user)`, `grantManual`, `revoke`, `applySubscription`.

## 15. Output of each build task
When you finish, your structured result MUST include, for every route you created:
`{ method, path (full, including /api/v1 mount), auth, requestBody, responseBody, errorCodes }`
plus the list of files you created/edited and a 1-line manual test (curl) per endpoint group.
This contract output feeds the admin (Next.js) and Flutter integration work, so be exact.

## 15b. LOCKED foundation modules (already built — import, do NOT recreate)

These exist and their signatures are final. Import and use them as-is.

`../models/*.model.js` (all default exports):
- `user.model.js` — User now also has: `tier`('free'|'premium'), `premiumSource`, `premiumExpiresAt`,
  `premiumGrantedBy`, `manualPremiumActive`, `manualPremiumExpiresAt`, `manualPremiumSource`,
  `dailyUsage:{date,messages,chats}`.
- `subscription.model.js` (Subscription): `_id, userId, store('google_play'|'app_store'), productId,
  transactionId(unique), status('active'|'expired'|'in_grace'|'canceled'|'refunded'), expiresAt, latestRaw`.
- `coupon.model.js` (Coupon): `_id, code(uppercase,unique), type('premium_grant'|'trial'), durationDays(null=lifetime),
  maxRedemptions, redemptionsCount, expiresAt, active, createdBy`.
- `couponRedemption.model.js` (CouponRedemption): `_id, couponId, userId, redeemedAt` (unique couponId+userId).
- `appSetting.model.js` (AppSetting): `_id(=key), key, value(Mixed), updatedBy`.
- `emergencyResponse.model.js` (EmergencyResponse): `_id, title, category, triggerKeywords[String],
  responseTemplate, language, order, active, createdBy`.
- `material.model.js` (Material): `_id, userId, name, category, imageUrl, expirationDate,
  inspection:{intervalDays,lastInspectedAt,nextInspectionAt}, reminderRules:[{offsetDays,channel('push'|'local')}], active`.
- `notificationJob.model.js` (NotificationJob): `_id, userId, type('material_expiry'|'inspection'|'custom'),
  refId, title, body, scheduledAt, channel('push'|'local'), status('pending'|'sent'|'canceled'|'failed'), sentAt, error`.
- `deviceToken.model.js` (DeviceToken): `_id, userId, token(unique), platform('android'|'ios'|'web')`.
- `auditLog.model.js` (AuditLog): `_id, adminId, action, targetUserId, meta, createdAt`.

`../services/settings.service.js`:
- `getSetting(key) -> Promise<value>` (cached ~30s)
- `getAllSettings() -> Promise<{...allKeys}>`
- `updateSetting(key, value, adminId) -> Promise<doc>` (validates per key, throws ApiError on bad input)
- `updateSettings(patch, adminId) -> Promise<{...}>`
- `seedSettings() -> Promise<string[]>` (idempotent; orchestrator calls it on startup)
- `getSettingKeys()`, `invalidateSettingsCache(key?)`, `DEFAULT_SETTINGS`
- Keys: freeDailyMessageLimit, freeDailyChatLimit, freePrompt, premiumPrompt, accessRules, adsEnabled,
  adConfig{format,placements,nativeFrequency}, admUnitIds{android,ios}, emergencyOverrideEnabled,
  reminderDefaults, notificationsEnabled.

`../services/premium.service.js`:
- `recomputeTier(userId) -> Promise<User|null>`
- `applySubscription(userId) -> Promise<User>` (recomputes; call AFTER upserting the Subscription row)
- `grantManual(userId, { durationDays=null, source='manual'|'coupon', adminId=null }) -> Promise<User>`
- `revoke(userId, adminId) -> Promise<User>`
- `isPremiumUser(user) -> boolean`, `isAdFree(user) -> boolean`, `entitlementSnapshot(user) -> {tier,premiumSource,premiumExpiresAt,adFree}`

`../services/audit.service.js`: `logAudit({ adminId, action, targetUserId?, meta? })`, `listAuditForUser(targetUserId, limit?)`.

`../middlewares/dailyLimit.js`: `enforceDailyLimit('messages'|'chats')` — Express middleware; premium users skip,
free users get rolled-over per-day counting and a 429 `DAILY_LIMIT_REACHED` when over the Settings limit.

`../middlewares/auth.js`: `requireAuth(...roles)`. `../middlewares/upload.js`: default `upload` (multer).

## 16. Do NOT touch these shared files (the orchestrator owns them)
`app.js`, `server.js`, `config/db.js`, `.env` / `.env.example`, `services/seed.service.js`,
`data/seed.js`, `middlewares/globalErrorHandler.js`. If you need a route mounted, an env var,
a seed value, an index migration, or an error-handler change, STATE it in your output instead of editing.
(Exception: you MAY add new fields to existing models when the task explicitly says to extend them.)
