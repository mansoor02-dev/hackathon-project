const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

async function request(path, { signal } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { signal });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status})`);
  }

  return body;
}

export function getHealth(options) {
  return request("/health", options);
}

export function resolveVisitor(options) {
  return request("/api/resolve-visitor", options);
}

export function getGraph8Status(options) {
  return request("/api/graph8/status", options);
}

export function getDashboardState(options) {
  return request("/api/state", options);
}

export function getEvents(limit = 20, options) {
  return request(`/api/events?limit=${limit}`, options);
}
