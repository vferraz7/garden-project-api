require("dotenv").config();

const app = require("./app");
const connectDatabase = require("./config/database");
const { logger } = require("./config/logger");
const { startTracing, shutdownTracing } = require("./config/tracing");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // Start OpenTelemetry tracing
    startTracing();

    await connectDatabase();

    const server = app.listen(PORT, () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV }, "Server started");
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Shutting down");
      server.close(async () => {
        await shutdownTracing();
        process.exit(0);
      });
      setTimeout(() => {
        logger.error("Forced shutdown");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

startServer();

