import express from "express";
import graph8Webhooks from "../routes/graph8-webhooks.js";
import visitorRoutes from "../routes/visitor.js";
import recoveryRoutes from "../routes/recovery.js";
import meetingRoutes from "../routes/meetings.js";

const app = express();

// Permissive CORS for local demo (Vite dev + dashboard). No credentials.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-G8-Signature,X-Studio-Signature,X-G8-Timestamp,X-Studio-Timestamp,ngrok-skip-browser-warning");
  next();
});
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(
  express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    },
  })
);

app.use("/webhooks/graph8", graph8Webhooks);
app.use("/webhooks", graph8Webhooks);
app.use("/api", visitorRoutes);
app.use("/api", recoveryRoutes);
app.use("/api", meetingRoutes);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "graph8-ghost-ops" });
});

// Malformed JSON + body-parser errors -> 400 (never 500, never reach handlers).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  console.error("[APP] Unhandled error:", err);
  return res.status(500).json({ error: "Internal error" });
});

export default app;
