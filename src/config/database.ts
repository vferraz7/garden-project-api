const mongoose = require("mongoose");
const { logger } = require("./logger");

const connectDatabase = async () => {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/growapp";

  try {
    await mongoose.connect(uri);
    logger.info("Connected to MongoDB");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "Failed to connect to MongoDB");
    throw error;
  }
};

module.exports = connectDatabase;

