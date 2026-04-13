# We Safe Backend

This repository now contains the backend API for the mobile user flow and the admin flow shown in the provided Figma exports.

The stack is:

- Express.js
- MongoDB with Mongoose
- local sessions stored in MongoDB
- Cloudinary for optional image uploads
- hosted Python AI backend for emergency chat responses

## Hosted AI dependency

AI replies are fetched through the live Python backend here:

- Docs: https://mattiaiaricco-ai-chatbot.onrender.com/docs
- OpenAPI: https://mattiaiaricco-ai-chatbot.onrender.com/openapi.json

The Express backend wraps that service through local routes under `/api/v1/chat/*` and `/api/v1/admin/ai-prompt`.

## Multipart image uploads on resource routes

Image-bearing create and update routes now accept `multipart/form-data` directly. Mobile clients do not need to call a separate upload endpoint first when they are already creating or updating one of these resources.

Supported file fields:

- `/api/v1/auth/register` and `/api/v1/auth/social-login`: `avatar`
- `/api/v1/users/me`: `avatar`
- `/api/v1/checklists` and `/api/v1/checklists/:checklistId`: `icon`, `coverImage`
- `/api/v1/admin/settings`: `avatar`
- `/api/v1/admin/checklists` and `/api/v1/admin/checklists/:checklistId`: `icon`, `coverImage`
- `/api/v1/admin/safety-tips` and `/api/v1/admin/safety-tips/:tipId`: `coverImage`, `thumbnail`

For multipart requests that also include arrays or objects, send those structured fields as JSON strings. Examples:

- `items`
- `contentSections`
- `doList`
- `dontList`
- `tags`

## Quick start

```bash
npm install
copy .env.example .env
npm run dev
```

Open:

- `http://localhost:5000/docs`
- `http://localhost:5000/docs/json`

## Hosted Postman testing

- Hosted base URL: `https://backend-mattiaiarriccio.onrender.com`
- Hosted docs: `https://backend-mattiaiarriccio.onrender.com/docs`
- Hosted JSON catalog: `https://backend-mattiaiarriccio.onrender.com/docs/json`
- Import `docs/wesafe-backend.postman_collection.json` into Postman
- The collection `baseUrl` variable already defaults to the hosted Render URL

Recommended request order:

1. `System & Docs / Health Check`
2. `Auth - User / Login User`
3. `User App / Get Home Payload`
4. `Safety Tips / List Safety Tips`
5. `Checklists / List Checklists`
6. `Chat / Send New Chat Message`
7. `Auth - Admin / Login Admin`
8. `Admin / Get Admin Dashboard`

Notes:

- The first request may take around 30 to 60 seconds if Render is waking the service up.
- User and admin login requests automatically save the access token into collection variables, so the protected folders can be tested right after login.
- Multipart routes only require attaching files when you want to test uploads.
- Password reset requests on production may require real OTP delivery.
- User registration and profile updates accept a single `username` or `userName` field; legacy `firstName` and `lastName` payloads still work.

## Environment variables

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/wesafe
SESSION_TTL_HOURS=168
RESET_OTP_TTL_MINUTES=10
AI_BACKEND_BASE_URL=https://mattiaiaricco-ai-chatbot.onrender.com
AI_TIMEOUT_MS=30000
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

## Seed accounts

User account:

- Email: `madiha.aroa@example.com`
- Password: `Password123!`

Admin account:

- Email: `admin@wesafe.app`
- Password: `Admin123!`

## Main route groups

`/api/v1/auth`

- registration, user/admin login, social login handoff, password reset OTP, logout

`/api/v1/home`

- home screen payload for the mobile dashboard

`/api/v1/users`

- current profile, preferences, password change

`/api/v1/notifications`

- list and mark notifications as read

`/api/v1/legal`

- about app, privacy policy, terms and conditions

`/api/v1/safety-tips`

- guide list and guide detail

`/api/v1/checklists`

- public template checklists, custom checklist CRUD, item progress

`/api/v1/chat`

- local conversation history plus AI-backed assistant replies

`/api/v1/admin`

- dashboard, AI prompt management, checklist CRUD, safety tip CRUD, admin settings, activity feed

`/api/v1/uploads`

- Cloudinary image upload/delete for admin media fields

## Password reset behavior

Because no email provider is configured in this repo, OTP responses include `debugOtp` outside production. That lets the mobile developer complete the forgot-password flow immediately.

`nodemailer` is not configured in this backend yet, so reset OTP delivery is still API/debug-token based unless a mail provider is added.

## Smoke test

If you already have MongoDB running and `MONGODB_URI` is configured, you can run:

```bash
npm run smoke
```
