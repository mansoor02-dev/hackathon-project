import crypto from "node:crypto";
import { webhookSecret } from "../config/config.js";

export function verifyGraph8Webhook(req) {
  const rawBody = req.rawBody;

  if (!webhookSecret || !rawBody) {
    return false;
  }

  const signature =
    req.headers["x-g8-signature"] ||
    req.headers["x-studio-signature"];
  const timestamp =
    req.headers["x-g8-timestamp"] ||
    req.headers["x-studio-timestamp"];

  if (!signature) {
    return false;
  }

  let payload = rawBody;

  if (timestamp) {
    const timestampSeconds = Number(timestamp);

    if (!Number.isFinite(timestampSeconds)) {
      return false;
    }

    const age = Math.abs(
      Math.floor(Date.now() / 1000) - timestampSeconds
    );

    if (age > 300) {
      return false;
    }

    payload = `${timestamp}.${rawBody}`;
  }

  const digest = crypto
    .createHmac("sha256", webhookSecret)
    .update(payload)
    .digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const received = Buffer.from(String(signature));

  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
}