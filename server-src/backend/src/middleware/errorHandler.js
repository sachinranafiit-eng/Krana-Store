const ApiError = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let { statusCode, message, details } = err;

  // Postgres unique-violation → friendlier 409 instead of a raw 500
  if (err.code === '23505') {
    statusCode = 409;
    message = 'A record with this value already exists (duplicate).';
    details = err.detail;
  }
  // Postgres foreign-key violation
  if (err.code === '23503') {
    statusCode = 409;
    message = 'This action references a record that does not exist or is in use.';
    details = err.detail;
  }

  if (err.code === '23514') { statusCode=400; message='Invalid quantity, stock balance, or pricing. Check the values and try again.'; }
  if (['22P02','22007','22008','22003'].includes(err.code)) { statusCode=400; message='Invalid number, date, or field value.'; }
  statusCode = statusCode || 500;
  if (statusCode === 500) {
    console.error('Unhandled error:', err);
  }

  res.status(statusCode).json({
    success: false,
    message: statusCode===500?'Unable to complete this request':message || 'Request failed',
    details: statusCode===500?undefined:details || undefined,
  });
}

module.exports = { notFoundHandler, errorHandler };
