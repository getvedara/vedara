export interface Page<T> {
  index: number;
  items: T[];
  hasNext: boolean;
}

export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) throw new RangeError('pageSize must be positive');
  return Math.floor(total / pageSize);
}

export function getPage<T>(all: T[], index: number, pageSize: number): Page<T> {
  const pages = pageCount(all.length, pageSize);
  const start = index * pageSize;
  return {
    index,
    items: all.slice(start, start + pageSize),
    hasNext: index + 1 < pages,
  };
}
