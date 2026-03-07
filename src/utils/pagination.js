const DEFAULT_PAGE_SIZE = 20;

export function getPaginationParams(req, pageSize = DEFAULT_PAGE_SIZE) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = pageSize;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function buildPagination(page, limit, totalCount, queryParams = {}) {
  const totalPages = Math.ceil(totalCount / limit);
  const from = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, totalCount);

  // Build query string excluding 'page'
  const qs = Object.entries(queryParams)
    .filter(([key]) => key !== 'page')
    .map(([key, val]) => `&${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
    .join('');

  return {
    currentPage: page,
    totalPages,
    total: totalCount,
    from,
    to,
    queryString: qs
  };
}
