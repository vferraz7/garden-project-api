import { describe, it, expect } from "vitest";

const { register, httpRequestsTotal, httpRequestDuration, dbOperationsTotal, dbOperationDuration, activeUsers, gardensTotal } = require("../../../dist/config/metrics.js");

describe("config/metrics", () => {
  it("exports register", () => {
    expect(register).toBeDefined();
    expect(typeof register.metrics).toBe("function");
    expect(typeof register.contentType).toBe("string");
  });

  it("exports httpRequestsTotal counter", () => {
    expect(httpRequestsTotal).toBeDefined();
    expect(typeof httpRequestsTotal.inc).toBe("function");
  });

  it("exports httpRequestDuration histogram", () => {
    expect(httpRequestDuration).toBeDefined();
    expect(typeof httpRequestDuration.observe).toBe("function");
  });

  it("exports dbOperationsTotal counter", () => {
    expect(dbOperationsTotal).toBeDefined();
    expect(typeof dbOperationsTotal.inc).toBe("function");
  });

  it("exports dbOperationDuration histogram", () => {
    expect(dbOperationDuration).toBeDefined();
    expect(typeof dbOperationDuration.observe).toBe("function");
    expect(typeof dbOperationDuration.startTimer).toBe("function");
  });

  it("exports activeUsers gauge", () => {
    expect(activeUsers).toBeDefined();
    expect(typeof activeUsers.inc).toBe("function");
  });

  it("exports gardensTotal gauge", () => {
    expect(gardensTotal).toBeDefined();
    expect(typeof gardensTotal.inc).toBe("function");
  });
});