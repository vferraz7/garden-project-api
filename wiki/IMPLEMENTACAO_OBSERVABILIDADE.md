# Implementação de Observabilidade

## Resumo

Implementação completa de observabilidade para a API Garden Project com:
- **Logs estruturados** usando Pino
- **Métricas Prometheus** no endpoint `/metrics`
- **Health checks profundos** (`/health` e `/health/deep` com ping no banco de dados)
- **Correlação de Request ID** para distributed tracing
- **Tracing distribuído** com OpenTelemetry
- **Alertas Prometheus** configurados
- **Dashboard Grafana** pronto para uso
- **Stack de monitoramento** com Docker Compose (Prometheus + Grafana + Loki + Alertmanager)

---

## Alterações Realizadas

### 1. Dependências Adicionadas (`package.json`)

```json
{
  "dependencies": {
    "pino": "^9.0.0",
    "pino-http": "^10.0.0",
    "pino-pretty": "^11.0.0",
    "prom-client": "^15.1.0",
    "uuid": "^9.0.0",
    "@opentelemetry/api": "^1.8.0",
    "@opentelemetry/sdk-node": "^0.51.0",
    "@opentelemetry/auto-instrumentations-node": "^0.43.0",
    "@opentelemetry/instrumentation-express": "^0.41.0",
    "@opentelemetry/instrumentation-http": "^0.50.0",
    "@opentelemetry/instrumentation-mongoose": "^0.37.0",
    "@opentelemetry/resources": "^1.24.0",
    "@opentelemetry/semantic-conventions": "^1.24.0"
  }
}
```

### 2. Novos Arquivos Criados

#### Configuração de Logger (`src/config/logger.ts`)
- Logger Pino configurado com:
  - Níveis de log configuráveis via `LOG_LEVEL` (padrão: `debug` em dev, `info` em prod)
  - Pretty printing em desenvolvimento (`pino-pretty`)
  - Formato JSON estruturado em produção
  - Timestamp ISO 8601
  - Metadados base: `service: "gp-api"`, `env`

#### Configuração de Métricas (`src/config/metrics.ts`)
- Registry Prometheus com prefixo `gp_`
- Métricas padrão do Node.js (CPU, memória, event loop, GC, etc.)
- Métricas customizadas de negócio:
  - `gp_http_requests_total` - Counter de requisições HTTP
  - `gp_http_request_duration_seconds` - Histograma de latência HTTP
  - `gp_db_operations_total` - Counter de operações de banco
  - `gp_db_operation_duration_seconds` - Histograma de latência DB
  - `gp_active_users` - Gauge de usuários ativos
  - `gp_gardens_total` - Gauge de jardins totais

#### Configuração de Tracing (`src/config/tracing.ts`)
- OpenTelemetry SDK configurado com:
  - Auto-instrumentação para Express, HTTP, Mongoose
  - Resource attributes: service name, version, environment
  - Traces exportados (métricas continuam no `/api/metrics` via prom-client)

#### Middleware de Request ID (`src/middleware/requestId.ts`)
- Gera UUID v4 para cada requisição (ou usa `X-Request-ID` header)
- Adiciona `req.id` e header de resposta `X-Request-ID`
- Logger de requisição com duração e status code

#### Middleware de Log HTTP (`src/middleware/httpLogger.ts`)
- Baseado em `pino-http`
- Log automático de todas as requisições/respostas
- Níveis: `error` (5xx), `warn` (4xx), `info` (2xx/3xx)
- Serialização customizada de req/res

#### Middleware de Métricas (`src/middleware/metrics.ts`)
- Coleta automática de métricas HTTP
- Mede duração com `process.hrtime.bigint()`
- Labels: method, route, status_code

#### Rotas de Observabilidade (`src/routes/health.routes.ts`)
- `GET /api/health` - Liveness probe (leve)
- `GET /api/health/deep` - Readiness probe (completo)
  - Ping no MongoDB (`mongoose.connection.db.admin().ping()`)
  - Check de memória (heap > 90% = warning)
  - Retorna 200 (healthy) ou 503 (unhealthy)
- `GET /api/metrics` - Endpoint Prometheus

#### Prometheus Alert Rules (`monitoring/alerts.yml`)
Regras de alerta para:
- Instância down
- Latência HTTP alta (p95 > 1s, p99 > 5s)
- Taxa de erro 5xx alta (>5% warning, >20% critical)
- Latência DB alta (p95 > 500ms)
- Taxa de erro DB (>1%)
- Uso de memória alto (>85% warning, >95% critical)
- CPU alto (>80%)
- Event loop lag (>100ms)
- Nenhuma instância saudável

#### Grafana Dashboard (`monitoring/grafana-dashboard.json`)
Dashboard com 10 painéis:
1. Service Status (up/down)
2. Request Rate (req/s)
3. HTTP Latency (p50, p95, p99)
4. 5xx Error Rate
5. DB Operations Rate
6. DB Latency (p50, p95)
7. Heap Memory Usage
8. Memory Usage (heap used/total, RSS)
9. Event Loop Lag
10. Business Metrics (Active Users, Total Gardens)

#### Docker Compose Monitoring (`monitoring/docker-compose.yml`)
Stack completa com:
- Prometheus (porta 9090)
- Grafana (porta 3001, admin/admin)
- Loki (porta 3100) - log aggregation
- Promtail - log shipper
- Alertmanager (porta 9093)

---

### 3. Arquivos Modificados

#### `src/app.ts`
- Adicionado middleware `requestIdMiddleware` (primeiro)
- Adicionado middleware `requestLogger`
- Adicionado middleware `httpLogger` (após helmet/cors)
- Adicionado middleware `metricsMiddleware`
- Removido endpoint `/health` simples
- Adicionado rotas `healthRoutes` em `/api`

#### `src/server.ts`
- Substituído `console.log` por `logger.info`
- Substituído `console.error` por `logger.error`
- Adicionado inicialização de OpenTelemetry (`startTracing()`)
- Adicionado graceful shutdown com `shutdownTracing()`
- Handlers para SIGTERM/SIGINT

#### `src/config/database.ts`
- Substituído `console.log` por `logger.info`
- Substituído `console.error` por `logger.error`

#### Repositórios Instrumentados com Métricas DB
Todos os repositórios agora registram métricas de operações de banco:
- `src/infrastructure/repositories/GardenRepositoryMongo.ts`
- `src/infrastructure/repositories/LogRepositoryMongo.ts`
- `src/infrastructure/repositories/InventoryRepositoryMongo.ts`
- `src/infrastructure/repositories/UserRepositoryMongo.ts`
- `src/infrastructure/repositories/RefreshTokenRepositoryMongo.ts`

Cada método de banco é instrumentado com:
```typescript
const end = dbOperationDuration.startTimer({ operation: "findById", collection: "gardens" });
try {
  // ... operação
  dbOperationsTotal.inc({ operation: "findById", collection: "gardens", status: "success" });
} catch (err) {
  dbOperationsTotal.inc({ operation: "findById", collection: "gardens", status: "error" });
  throw err;
} finally {
  end();
}
```

---

### 4. Testes Adicionados (10 novos testes)

| Arquivo | Testes | Descrição |
|---------|--------|-----------|
| `tests/unit/config/logger.test.ts` | 3 | Logger exporta instância, métodos não lançam erro |
| `tests/unit/config/metrics.test.ts` | 7 | Todas as métricas exportadas corretamente |
| `tests/unit/middleware/httpLogger.test.ts` | 2 | Middleware exportado, chama next() |
| `tests/unit/middleware/metrics.test.ts` | 3 | Middleware exportado, chama next(), registra finish handler |
| `tests/integration/routes/health.routes.test.ts` | 4 | Rotas /health, /health/deep, /metrics existem |

**Total: 62 testes passando** (52 originais + 10 novos)

---

## Como Testar Manualmente

### 1. Iniciar o Servidor
```bash
npm run dev
```

### 2. Testar Health Check Básico (Liveness)
```bash
curl http://localhost:3000/api/health
```
**Resposta esperada:**
```json
{
  "status": "ok",
  "timestamp": "2026-10-29T14:24:35.804Z",
  "uptime": 21.0674039
}
```

### 3. Testar Health Check Profundo (Readiness)
```bash
curl http://localhost:3000/api/health/deep
```
**Resposta esperada (healthy):**
```json
{
  "status": "healthy",
  "timestamp": "2026-10-29T14:24:52.610Z",
  "uptime": 37.8740432,
  "checks": {
    "database": "connected",
    "memory": "ok"
  },
  "memory": {
    "heapUsed": 28,
    "heapTotal": 31,
    "rss": 108
  }
}
```

### 4. Testar Métricas Prometheus
```bash
curl http://localhost:3000/api/metrics
```
**Resposta:** Formato Prometheus text com métricas como:
- `gp_http_requests_total{method="GET",route="/health",status_code="200"} 1`
- `gp_http_request_duration_seconds_bucket{method="GET",route="/health",le="0.1"} 1`
- `gp_process_cpu_seconds_total 1.359`
- `gp_nodejs_heap_size_used_bytes 30167160`

### 5. Testar Request ID Correlation
```bash
# Com Request ID customizado
curl -H "X-Request-ID: meu-request-123" http://localhost:3000/api/health

# Sem Request ID (gera UUID automaticamente)
curl http://localhost:3000/api/health -v
```
**Header de resposta:** `X-Request-ID: meu-request-123` (ou UUID gerado)

### 6. Verificar Logs Estruturados
Os logs aparecem no console com formato JSON estruturado (pretty em dev):
```
[INFO]  Incoming request
{
  "service": "gp-api",
  "env": "development",
  "requestId": "abc-123",
  "method": "GET",
  "url": "/api/health",
  "ip": "::1",
  "userAgent": "curl/8.0.0",
  "level": 30,
  "time": "2026-10-29T14:23:50.261Z",
  "msg": "Incoming request"
}
```

---

## Como Testar Automatizadamente

### Executar Todos os Testes
```bash
npm run test
```

### Executar Testes com Cobertura
```bash
npm run test:coverage
```

### Executar Apenas Testes de Observabilidade
```bash
# Testes unitários de config
npx vitest run tests/unit/config/logger.test.ts tests/unit/config/metrics.test.ts

# Testes unitários de middleware
npx vitest run tests/unit/middleware/httpLogger.test.ts tests/unit/middleware/metrics.test.ts

# Testes de integração de rotas
npx vitest run tests/integration/routes/health.routes.test.ts
```

---

## Subir Stack de Monitoramento Local

```bash
cd monitoring
docker-compose up -d
```

Acessos:
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)
- **Alertmanager**: http://localhost:9093
- **Loki**: http://localhost:3100

O dashboard "gp-api - Garden Project API" será provisionado automaticamente no Grafana.

---

## Integração com Kubernetes

### Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
```

### Readiness Probe
```yaml
readinessProbe:
  httpGet:
    path: /api/health/deep
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

### Prometheus Scraping
```yaml
# ServiceMonitor ou PodMonitor
- job_name: 'gp-api'
  metrics_path: '/api/metrics'
  static_configs:
    - targets: ['gp-api:3000']
```

### PrometheusRule para Alertas
```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: gp-api-alerts
spec:
  groups:
  - name: gp-api-alerts
    rules:
    # (conteúdo de monitoring/alerts.yml)
```

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Nível de log (debug, info, warn, error) |
| `NODE_ENV` | `development` | Ambiente (development, production, test) |
| `PORT` | `3000` | Porta do servidor |
| `MONGO_URI` | `mongodb://localhost:27017/growapp` | URI do MongoDB |

---

## Próximos Passos (Opcional)

1. **Log Aggregation** - Configurar Loki/Elasticsearch para produção
2. **Distributed Tracing Backend** - Jaeger/Tempo para visualizar traces
3. **SLO/SLI Definitions** - Definir Service Level Objectives
4. **Runbook Documentation** - Documentar procedimentos de incident response
5. **Chaos Engineering** - Testes de resiliência automatizados