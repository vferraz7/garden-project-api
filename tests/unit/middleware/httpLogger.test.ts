import { describe, it, expect, vi } from "vitest";

const { httpLogger } = require("../../../dist/middleware/httpLogger.js");

describe("middleware/httpLogger", () => {
  it("exports httpLogger middleware", () => {
    expect(httpLogger).toBeDefined();
    expect(typeof httpLogger).toBe("function");
  });

  it("calls next()", () => {
    const req = {
      method: "GET",
      url: "/test",
      ip: "127.0.0.1",
      headers: { "user-agent": "test-agent" }
    };
    const res = {
      statusCode: 200,
      on: vi.fn()
    };
    const next = vi.fn();

    httpLogger(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});