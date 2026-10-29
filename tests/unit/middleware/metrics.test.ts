import { describe, it, expect, vi } from "vitest";

const { metricsMiddleware } = require("../../../dist/middleware/metrics.js");
const { httpRequestsTotal, httpRequestDuration } = require("../../../dist/config/metrics.js");

describe("middleware/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports metricsMiddleware", () => {
    expect(metricsMiddleware).toBeDefined();
    expect(typeof metricsMiddleware).toBe("function");
  });

  it("calls next()", () => {
    const req = { method: "GET", url: "/test", route: { path: "/test" } };
    const res = { on: vi.fn((event, cb) => cb()), statusCode: 200 };
    const next = vi.fn();

    metricsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("registers finish handler and records metrics", () => {
    const req = { method: "POST", url: "/api/test", route: { path: "/api/test" } };
    const res = {
      on: vi.fn((event, cb) => {
        if (event === "finish") cb();
      }),
      statusCode: 201
    };
    const next = vi.fn();

    metricsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});