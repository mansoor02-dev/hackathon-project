import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "events.json");

const MAX_EVENTS = 500;
const VISITOR_EVENT_TYPES = new Set([
  "personalization_served",
  "personalization_generated",
  "company_resolved",
  "visitor_identified",
]);

let events = [];
let seenIds = new Set();

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        events = parsed.slice(-MAX_EVENTS);
        for (const e of events) {
          if (e.idempotencyKey) seenIds.add(e.idempotencyKey);
        }
      }
    }
  } catch {
    events = [];
  }
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(events.slice(-MAX_EVENTS), null, 2));
  } catch (error) {
    console.warn("[EVENTS] persist failed:", error.message);
  }
}

load();

export function hasSeen(idempotencyKey) {
  if (!idempotencyKey) return false;
  return seenIds.has(idempotencyKey);
}

export function markSeen(idempotencyKey) {
  if (idempotencyKey) seenIds.add(idempotencyKey);
}

export function recordEvent(type, { company = null, domain = null, visitor = null, metadata = {} } = {}) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    company: company || metadata?.companyName || null,
    domain: domain || metadata?.domain || null,
    visitor: visitor || null,
    metadata: metadata || {},
  };
  if (metadata?.idempotencyKey) {
    event.idempotencyKey = metadata.idempotencyKey;
    seenIds.add(metadata.idempotencyKey);
  }
  events.push(event);
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  persist();
  return event;
}

export function listEvents(limit = 100) {
  return events.slice(-Math.max(1, Math.min(limit, MAX_EVENTS))).reverse();
}

export function getLatestByType(type) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) return events[i];
  }
  return null;
}

export function getLatestVisitor() {
  for (let i = events.length - 1; i >= 0; i--) {
    if (VISITOR_EVENT_TYPES.has(events[i].type)) return events[i];
  }
  return null;
}

export function getLatestMeeting() {
  return getLatestByType("meeting_booked");
}

export function getLatestCoaching() {
  return getLatestByType("sales_preparation_generated");
}

export function clearEvents() {
  events = [];
  seenIds = new Set();
  persist();
}
