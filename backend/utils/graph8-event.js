const EVENT_ALIASES = {
  visitor_identified: "visitor.identified",
  visitor_identified_event: "visitor.identified",
  intent_signal: "intent.signal",
  meeting_booked: "meeting.booked",
  "appointments.booked": "meeting.booked",
};

export function normalizeEventType(raw) {
  const e = String(raw || "").trim();
  return EVENT_ALIASES[e] || e;
}

export function getGraph8Event(payload) {
  const raw = payload.event || payload.event_type || payload.type;
  return {
    event: raw,
    normalizedEvent: normalizeEventType(raw),
    data: payload.data || payload,
  };
}