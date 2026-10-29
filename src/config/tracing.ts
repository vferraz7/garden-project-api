import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export const otelSDK = new NodeSDK({
  serviceName: "gp-api",
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "gp-api",
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || "1.0.0",
    "deployment.environment": process.env.NODE_ENV || "development",
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-express": {
        enabled: true,
      },
      "@opentelemetry/instrumentation-http": {
        enabled: true,
      },
      "@opentelemetry/instrumentation-mongoose": {
        enabled: true,
      },
    }),
  ],
});

export function startTracing() {
  if (process.env.NODE_ENV === "test") return;
  otelSDK.start();
  console.log("[tracing] OpenTelemetry initialized (traces only, metrics at /api/metrics)");
}

export function shutdownTracing() {
  otelSDK.shutdown().catch((err) => console.error("[tracing] Error shutting down", err));
}