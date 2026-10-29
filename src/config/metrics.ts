import promClient from "prom-client";

// Create registry
export const register = new promClient.Registry();

// Default metrics (CPU, memory, event loop, etc.)
promClient.collectDefaultMetrics({ register, prefix: "gp_" });

// Custom business metrics
export const httpRequestsTotal = new promClient.Counter({
  name: "gp_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const httpRequestDuration = new promClient.Histogram({
  name: "gp_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const dbOperationsTotal = new promClient.Counter({
  name: "gp_db_operations_total",
  help: "Total database operations",
  labelNames: ["operation", "collection", "status"],
  registers: [register],
});

export const dbOperationDuration = new promClient.Histogram({
  name: "gp_db_operation_duration_seconds",
  help: "Database operation duration in seconds",
  labelNames: ["operation", "collection"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const activeUsers = new promClient.Gauge({
  name: "gp_active_users",
  help: "Number of active users (with valid sessions)",
  registers: [register],
});

export const gardensTotal = new promClient.Gauge({
  name: "gp_gardens_total",
  help: "Total number of gardens",
  registers: [register],
});