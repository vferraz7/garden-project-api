const { Router } = require("express");
const mongoose = require("mongoose");
const { register } = require("../config/metrics");
const { logger } = require("../config/logger");

const router = Router();

// Lightweight health check (k8s liveness)
router.get("/health", async (_req: any, res: any) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Deep health check (k8s readiness)
router.get("/health/deep", async (_req: any, res: any) => {
  const checks = {
    database: "unknown",
    memory: "ok",
  };

  // DB ping
  try {
    await mongoose.connection.db?.admin().ping();
    checks.database = "connected";
  } catch (err) {
    logger.error({ err }, "Health check: database ping failed");
    checks.database = "disconnected";
  }

  // Memory check
  const mem = process.memoryUsage();
  if (mem.heapUsed / mem.heapTotal > 0.9) {
    checks.memory = "warning";
  }

  const healthy = checks.database === "connected" && checks.memory === "ok";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
    },
  });
});

// Prometheus metrics endpoint
router.get("/metrics", async (_req: any, res: any) => {
  try {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    logger.error({ err }, "Error generating metrics");
    res.status(500).send("Error generating metrics");
  }
});

module.exports = router;