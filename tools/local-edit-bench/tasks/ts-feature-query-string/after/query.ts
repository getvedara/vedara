export type QueryScalar = string | number | boolean;
export type QueryValue = QueryScalar | QueryScalar[] | null | undefined;

function encodePair(key: string, value: string | number | boolean): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
}

export function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) parts.push(encodePair(key, item));
    } else {
      parts.push(encodePair(key, value));
    }
  }
  return parts.join('&');
}

export function withQuery(url: string, params: Record<string, QueryValue>): string {
  const q = buildQuery(params);
  if (!q) return url;
  return url + (url.includes('?') ? '&' : '?') + q;
}
