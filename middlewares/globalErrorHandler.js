import { StatusCodes } from 'http-status-codes';

const globalErrorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  let message = err.message || 'Something went wrong';

  if (err.name === 'MulterError') {
    statusCode = StatusCodes.BAD_REQUEST;
    message = err.message;
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

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};

export default globalErrorHandler;
