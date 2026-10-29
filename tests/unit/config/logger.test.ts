import { describe, it, expect } from "vitest";

const { logger } = require("../../../dist/config/logger.js");

describe("config/logger", () => {
  it("exports a logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("info method executes without throwing", () => {
    expect(() => logger.info({ port: 3000 }, "Server started")).not.toThrow();
  });

  it("error method executes without throwing", () => {
    const err = new Error("test error");
    expect(() => logger.error({ err }, "Failed to start")).not.toThrow();
  });
});