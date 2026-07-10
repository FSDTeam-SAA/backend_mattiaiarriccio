import multer from 'multer';
import ApiError from '../utils/ApiError.js';
import { StatusCodes } from 'http-status-codes';

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new ApiError(StatusCodes.BAD_REQUEST, 'Only image files are allowed'), false);
  }
};

// Accept large photos (modern phones easily exceed 10 MB) — they're downscaled
// and compressed on upload by Cloudinary (see media.service), so a big original
// is fine. Keep a ceiling so a single in-memory upload can't exhaust RAM.
export const MAX_UPLOAD_MB = 25;

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024
  },
  fileFilter
});

export default upload;
