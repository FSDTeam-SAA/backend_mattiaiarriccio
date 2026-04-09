import { Readable } from 'stream';
import { StatusCodes } from 'http-status-codes';
import cloudinary from '../config/cloudinary.js';
import ApiError from '../utils/ApiError.js';

const DEFAULT_CLOUDINARY_ERROR =
  'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET first.';

export const ensureCloudinaryConfigured = () => {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, DEFAULT_CLOUDINARY_ERROR);
  }
};

export const uploadImageBuffer = (buffer, folder = 'express-uploads') => {
  ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
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

export const resolveImageUrl = async ({
  req,
  folder,
  fieldNames = [],
  bodyValue,
  currentValue,
  defaultValue
}) => {
  const uploadedFile = getUploadedFile(req, ...fieldNames);

  if (uploadedFile) {
    const uploadResult = await uploadImageFile(uploadedFile, folder);
    return uploadResult.secure_url;
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
