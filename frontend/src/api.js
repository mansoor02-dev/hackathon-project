const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

async function request(path, { signal } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { signal });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status})`);
  }

  return body;
}

async function postJson(path, payload, { signal } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status})`);
  }

  return body;
}

export function getHealth(options) {
  return request("/health", options);
}

export function resolveVisitor({ domain = null, signal } = {}) {
  const query = domain ? `?domain=${encodeURIComponent(domain)}` : "";
  return request(`/api/resolve-visitor${query}`, { signal });
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

export function getRecovery(options) {
  return request("/api/recovery", options);
}

export function getSequenceStatus(options) {
  return request("/api/sequences/status", options);
}

export function getInboxStatus(options) {
  return request("/api/inbox/status", options);
}

export function getAnalytics(options) {
  return request("/api/analytics", options);
}

export function getMeetingEventTypes(options) {
  return request("/api/meeting/event-types", options);
}

export function getMeetingSlots({ eventTypeId, start, end, timeZone } = {}, options) {
  const params = new URLSearchParams({
    event_type_id: String(eventTypeId),
    start,
    end,
  });
  if (timeZone) params.set("time_zone", timeZone);
  return request(`/api/meeting/slots?${params.toString()}`, options);
}

export function requestMeeting(payload, options) {
  return postJson("/api/meetings/request", payload, options);
}
