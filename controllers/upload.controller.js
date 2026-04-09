import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { destroyImage, ensureCloudinaryConfigured, uploadImageFile } from '../services/media.service.js';

export const uploadImage = catchAsync(async (req, res) => {
  ensureCloudinaryConfigured();

  if (!req.file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Please upload an image file');
  }

  const folder = req.body.folder || 'express-uploads';
  const result = await uploadImageFile(req.file, folder);

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: 'Image uploaded successfully',
    data: {
      public_id: result.public_id,
      secure_url: result.secure_url,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes
    }
  });
});

export const deleteImage = catchAsync(async (req, res) => {
  const result = await destroyImage(req.params.publicId);

  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Image delete request processed successfully',
    data: result
  });
});
