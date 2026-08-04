import express from "express";
import cors from "cors";
import { settings } from "./config.js";
import { connectDB } from "./db.js";
import { ensureUploadDir } from "./storage.js";
import { errorHandler } from "./middleware/errorHandler.js";
import prescriptionsRouter from "./routes/prescriptions.js";
import chatRouter from "./routes/chat.js";

async function main() {
  await connectDB();
  await ensureUploadDir();

  const app = express();

  // CORS — allow the configured website origin(s), or any when "*" is set.
  const allowAll = settings.corsOrigins.includes("*");
  app.use(
    cors({
      origin: allowAll ? true : settings.corsOrigins,
      credentials: true,
    })
  );

  app.use(express.json({ limit: "2mb" }));

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

  app.use(errorHandler);

  app.listen(settings.port, () => {
    console.log(`🚀 DOCTAR API listening on http://localhost:${settings.port}`);
    console.log(`   CORS origins: ${allowAll ? "* (all)" : settings.corsOrigins.join(", ")}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
