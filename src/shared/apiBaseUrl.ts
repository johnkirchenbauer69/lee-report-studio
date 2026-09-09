export interface ApiBaseUrlOptions {
  explicit?: string;
  environment?: { LEE_API_URL?: string };
  origin?: string;
  defaultLocal?: string;
}

const normalized = (value: string) => value.trim().replace(/\/+$/, "");

/** Canonical API URL precedence: argument, environment, same origin, local dev. */
export function resolveApiBaseUrl(options: ApiBaseUrlOptions = {}) {
  const candidate =
    options.explicit ||
    options.environment?.LEE_API_URL ||
    options.origin ||
    options.defaultLocal ||
    "http://127.0.0.1:8787";
  return normalized(candidate);
}

export function resolveApiUrl(path: string, options: ApiBaseUrlOptions = {}) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = resolveApiBaseUrl(options);
  return `${base}/${path.replace(/^\/+/, "")}`;
}
