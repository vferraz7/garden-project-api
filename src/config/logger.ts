import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  transport: isDev ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } } : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    service: "gp-api",
    env: process.env.NODE_ENV || "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;