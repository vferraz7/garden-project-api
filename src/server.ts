require("dotenv").config();

const app = require("./app");
const connectDatabase = require("./config/database");
const { logger } = require("./config/logger");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV }, "Server started");
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

startServer();

