export const sendSuccess = (
  res,
  {
    statusCode = 200,
    message = 'Request completed successfully',
    data = null,
    meta
  } = {}
) => {
  const payload = {
    success: true,
    message
  };

  if (data !== null) {
    payload.data = data;
  }

  if (meta) {
    payload.meta = meta;
  }

  return res.status(statusCode).json(payload);
};

export const parsePagination = (query, defaults = {}) => {
  const page = Math.max(Number.parseInt(query.page, 10) || defaults.page || 1, 1);
  const limit = Math.min(
    Math.max(Number.parseInt(query.limit, 10) || defaults.limit || 10, 1),
    defaults.maxLimit || 100
  );

  return {
    page,
    limit
  };
};

export const paginate = (items, page, limit) => {
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;

  return {
    items: items.slice(startIndex, startIndex + limit),
    meta: {
      page,
      limit,
      total,
      totalPages
    }
  };
};
