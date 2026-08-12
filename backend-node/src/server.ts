import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { settings } from "./config.js";
import { connectDB } from "./db.js";
import { ensureUploadDir } from "./storage.js";
import { errorHandler } from "./middleware/errorHandler.js";
import prescriptionsRouter from "./routes/prescriptions.js";
import chatRouter from "./routes/chat.js";
import chatSessionsRouter from "./routes/chatSessions.js";
import authRouter from "./routes/auth.js";

async function main() {
  await connectDB();
  await ensureUploadDir();

  const app = express();

  // Railway (and most reverse-proxy deployments) terminates TLS at the edge
  // and forwards over plain HTTP internally — without this, req.ip and
  // req.secure are wrong, which the rate limiter and cookie logic both rely on.
  app.set("trust proxy", 1);

  // CORS — allow the configured website origin(s), or any when "*" is set.
  const allowAll = settings.corsOrigins.includes("*");

  // Cookie-based auth now exists, and this app's entire CSRF defense is
  // "CORS rejects unknown origins" (see auth routes / chat session routes).
  // `origin: true` mirrors back whatever Origin header the request sent,
  // which is spec-legal to pair with `credentials: true` but is, in effect,
  // a wildcard — any website could make credentialed requests against
  // logged-in users' sessions. Same fail-fast treatment as JWT_SECRET.
  if (allowAll) {
    throw new Error(
      "CORS_ORIGINS cannot be \"*\" now that cookie-based auth exists — " +
      "it would defeat this app's CSRF protection. Set it to your actual frontend origin(s)."
    );
  }

  app.use(
    cors({
      origin: settings.corsOrigins,
      credentials: true,
    })
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  // Request logging (mirrors the FastAPI access log)
  app.use((req, _res, next) => {
    const start = Date.now();
    _res.on("finish", () => {
      console.log(
        `${new Date().toLocaleTimeString("en-GB")}  ${req.method} ${req.originalUrl} → ${_res.statusCode} (${Date.now() - start}ms)`
      );
    });
    next();
  });

  app.get("/", (_req, res) => {
    res.json({ name: "DOCTAR API", status: "ok" });
  });
  app.get("/health", (_req, res) => res.json({ status: "healthy" }));

  app.use("/api/prescriptions", prescriptionsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/chat/sessions", chatSessionsRouter);
  app.use("/api/auth", authRouter);

  app.use(errorHandler);

  app.listen(settings.port, () => {
    console.log(`🚀 DOCTAR API listening on http://localhost:${settings.port}`);
    console.log(`   CORS origins: ${settings.corsOrigins.join(", ")}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
