# Implementação de Observabilidade

## Resumo

Implementação completa de observabilidade para a API Garden Project com:
- **Logs estruturados** usando Pino
- **Métricas Prometheus** no endpoint `/metrics`
- **Health checks profundos** (`/health` e `/health/deep` com ping no banco de dados)

---

## Alterações Realizadas

### 1. Dependências Adicionadas (`package.json`)

```json
{
  "dependencies": {
    "pino": "^9.0.0",
    "pino-http": "^10.0.0",
    "pino-pretty": "^11.0.0",
    "prom-client": "^15.1.0"
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

---

### 3. Arquivos Modificados

#### `src/app.ts`
- Adicionado middleware `httpLogger` (após helmet/cors)
- Adicionado middleware `metricsMiddleware`
- Removido endpoint `/health` simples
- Adicionado rotas `healthRoutes` em `/api`

#### `src/server.ts`
- Substituído `console.log` por `logger.info`
- Substituído `console.error` por `logger.error`

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

### 5. Verificar Logs Estruturados
Os logs aparecem no console com formato JSON estruturado (pretty em dev):
```
[INFO]  Server started
{
  "service": "gp-api",
  "env": "development",
  "port": 3000,
  "level": 30,
  "time": "2026-10-29T14:23:50.261Z",
  "msg": "Server started"
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

1. **Correlação de Request ID** - Adicionar `req.id` para tracing distribuído
2. **Alertas** - Configurar regras de alerta no Prometheus/Alertmanager
3. **Dashboard Grafana** - Criar dashboard com métricas de negócio
4. **Log Aggregation** - Enviar logs para Loki/Elasticsearch
5. **Tracing** - Integrar OpenTelemetry para tracing distribuído