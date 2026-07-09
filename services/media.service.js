import { Readable } from 'stream';
import { StatusCodes } from 'http-status-codes';
import cloudinary from '../config/cloudinary.js';
import ApiError from '../utils/ApiError.js';

const DEFAULT_CLOUDINARY_ERROR =
  'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET first.';

export const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

export const ensureCloudinaryConfigured = () => {
  if (!isCloudinaryConfigured()) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, DEFAULT_CLOUDINARY_ERROR);
  }
};

// Applied to every uploaded image so stored photos are normalized:
//  - c_limit downscales anything larger than 1600x1600 while PRESERVING the
//    aspect ratio (never upscales, never distorts) — so a huge or oddly-sized
//    phone photo becomes a sensible, consistent size.
//  - q_auto:good lets Cloudinary compress the stored image, cutting file size
//    (faster loads) without visible quality loss.
// Display widgets then use BoxFit.cover, so images always fit their box cleanly.
const UPLOAD_TRANSFORMATION = [
  { width: 1600, height: 1600, crop: 'limit', quality: 'auto:good' }
];

export const uploadImageBuffer = (buffer, folder = 'express-uploads') => {
  ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: UPLOAD_TRANSFORMATION
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });
};

export const uploadImageFile = async (file, folder = 'express-uploads') => {
  if (!file) {
    return null;
  }

  return uploadImageBuffer(file.buffer, folder);
};

export const destroyImage = async (publicId) => {
  ensureCloudinaryConfigured();

  if (!publicId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'publicId is required');
  }

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image'
  });

  if (result.result !== 'ok' && result.result !== 'not found') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to delete image from Cloudinary');
  }

  return result;
};

export const getUploadedFile = (req, ...fieldNames) => {
  if (req.file && fieldNames.length === 0) {
    return req.file;
  }

  for (const fieldName of fieldNames) {
    if (req.files?.[fieldName]?.[0]) {
      return req.files[fieldName][0];
    }
  }

  return req.file || null;
};

const REMOVE_TOKENS = new Set(['__remove__', 'remove', 'null', 'none', 'clear', 'true', '1']);

const isRemovalSignal = (value) => {
  if (value === null) return true;
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return REMOVE_TOKENS.has(value.trim().toLowerCase());
};

export const resolveImageUrl = async ({
  req,
  folder,
  fieldNames = [],
  bodyValue,
  currentValue,
  defaultValue,
  removeKey
}) => {
  const uploadedFile = getUploadedFile(req, ...fieldNames);

  if (uploadedFile) {
    try {
      const uploadResult = await uploadImageFile(uploadedFile, folder);
      if (uploadResult?.secure_url) {
        return uploadResult.secure_url;
      }
    } catch (error) {
      console.error(
        `[media.service] Image upload failed for folder "${folder}":`,
        error?.message || error
      );
      // Fall through to body/current/default so the request never dead-ends.
    }
  }

  if (removeKey && req?.body && isRemovalSignal(req.body[removeKey])) {
    return defaultValue !== undefined ? defaultValue : '';
  }

  if (isRemovalSignal(bodyValue)) {
    return defaultValue !== undefined ? defaultValue : '';
  }

  if (bodyValue !== undefined) {
    const normalized = String(bodyValue || '').trim();

    if (normalized) {
      return normalized;
    }

    if (currentValue !== undefined) {
      return currentValue;
    }
  }

  if (currentValue !== undefined) {
    return currentValue;
  }

  return defaultValue;
};
