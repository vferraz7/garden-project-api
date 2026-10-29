import { describe, it, expect } from "vitest";

const healthRoutes = require("../../../dist/routes/health.routes.js").default;

describe("routes/health.routes", () => {
  it("exports a router", () => {
    expect(healthRoutes).toBeDefined();
    expect(typeof healthRoutes.get).toBe("function");
  });

  it("has /health route", () => {
    const stack = healthRoutes.stack || [];
    const healthRoute = stack.find((layer: any) =>
      layer.route && layer.route.path === "/health" && layer.route.methods.get
    );
    expect(healthRoute).toBeDefined();
  });

  it("has /health/deep route", () => {
    const stack = healthRoutes.stack || [];
    const deepRoute = stack.find((layer: any) =>
      layer.route && layer.route.path === "/health/deep" && layer.route.methods.get
    );
    expect(deepRoute).toBeDefined();
  });

  it("has /metrics route", () => {
    const stack = healthRoutes.stack || [];
    const metricsRoute = stack.find((layer: any) =>
      layer.route && layer.route.path === "/metrics" && layer.route.methods.get
    );
    expect(metricsRoute).toBeDefined();
  });
});