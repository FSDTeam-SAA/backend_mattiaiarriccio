import { StatusCodes } from 'http-status-codes';
import { MAX_UPLOAD_MB } from './upload.js';

const globalErrorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  let message = err.message || 'Something went wrong';

  if (err.name === 'MulterError') {
    statusCode = StatusCodes.BAD_REQUEST;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = `Image is too large. Maximum size is ${MAX_UPLOAD_MB} MB.`;
    } else {
      message = err.message;
    }
  }

  if (err.http_code) {
    statusCode = err.http_code;
  }

  if (err.name === 'ValidationError') {
    statusCode = StatusCodes.BAD_REQUEST;
    message = Object.values(err.errors)
      .map((error) => error.message)
      .join(', ');
  }

  if (err.name === 'CastError') {
    statusCode = StatusCodes.BAD_REQUEST;
    message = `Invalid value for ${err.path}`;
  }

  if (err.code === 11000) {
    statusCode = StatusCodes.CONFLICT;
    message = `Duplicate value for ${Object.keys(err.keyValue || {}).join(', ')}`;
  }

  const logPayload = {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    name: err.name,
    code: err.code,
    message: err.message
  };

  if (statusCode >= 500) {
    console.error('[errorHandler]', logPayload, err.stack);
  } else {
    console.warn('[errorHandler]', logPayload);
  }

  // Surface a stable machine-readable error code (e.g. DAILY_LIMIT_REACHED,
  // PREMIUM_REQUIRED) and optional structured details when an ApiError sets them.
  // Mongo duplicate-key uses a numeric err.code (11000) which we intentionally skip.
  const machineCode = typeof err.code === 'string' ? err.code : undefined;

  res.status(statusCode).json({
    success: false,
    message,
    ...(machineCode && { code: machineCode }),
    ...(err.details !== undefined && { details: err.details }),
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};

export default globalErrorHandler;
