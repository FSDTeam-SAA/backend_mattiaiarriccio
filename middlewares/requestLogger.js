const formatBytes = (bytes) => {
  if (!bytes || Number.isNaN(bytes)) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
};

const requestLogger = (req, res, next) => {
  const start = Date.now();
  const contentLength = Number(req.headers['content-length']) || 0;
  const contentType = req.headers['content-type'] || '';
  const ua = req.headers['user-agent'] || '';

  console.log(
    `[req] ${req.method} ${req.originalUrl} ct=${contentType.split(';')[0] || '-'} len=${formatBytes(contentLength)} ua=${ua.slice(0, 60)}`
  );

  let aborted = false;
  req.on('aborted', () => {
    aborted = true;
    console.warn(
      `[req:aborted] ${req.method} ${req.originalUrl} after ${Date.now() - start}ms`
    );
  });

  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
    console[level](
      `[res] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${Date.now() - start}ms${aborted ? ' (client aborted)' : ''}`
    );
  });

  next();
};

export default requestLogger;
