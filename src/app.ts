const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth.routes");
const gardensRoutes = require("./routes/gardens.routes");
const logsRoutes = require("./routes/logs.routes");
const inventoryRoutes = require("./routes/inventory.routes");

if (process.env.NODE_ENV === "production") {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || !String(raw).trim()) {
    throw new Error(
      "Em produção defina CORS_ORIGIN com uma ou mais origens permitidas (separadas por vírgula)."
    );
  }
}

const app = express();

const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === "1" || String(trustProxy).toLowerCase() === "true") {
  app.set("trust proxy", 1);
}

app.use(helmet());

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : true;

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: "512kb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const businessApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/api", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.json({ name: "gp-api", status: "ok" });
    return;
  }
  res.json({
    name: "gp-api",
    description: "API REST para jardins, logs de cultivo e estoque.",
    basePath: "/api",
    auth: {
      note: "Rotas de negócio exigem Authorization: Bearer <accessToken>. Obtenha tokens em /api/auth/login ou /api/auth/register.",
      "POST /api/auth/register": "Corpo: { email, password } — cria usuário",
      "POST /api/auth/login": "Corpo: { email, password } — retorna accessToken e refreshToken",
      "POST /api/auth/refresh": "Corpo: { refreshToken } — rotação de refresh",
      "POST /api/auth/logout": "Corpo: { refreshToken } — revoga sessão de refresh",
    },
    endpoints: {
      gardens: {
        "GET /api/gardens": "Lista jardins (autenticado). Query: phase, environment, limit, skip",
        "GET /api/gardens/:id": "Jardim por id",
        "GET /api/gardens/:id/logs": "Timeline de logs do jardim",
        "GET /api/gardens/:id/plants": "Plantas do jardim",
        "GET /api/gardens/:id/plants/:plantId": "Planta por id",
        "POST /api/gardens": "Cria jardim",
        "PUT /api/gardens/:id": "Atualiza jardim",
        "DELETE /api/gardens/:id": "Remove jardim",
        "POST /api/gardens/:id/plants": "Adiciona planta",
        "PATCH /api/gardens/:id/plants/:plantId": "Atualiza planta",
        "DELETE /api/gardens/:id/plants/:plantId": "Remove planta",
      },
      logs: {
        "GET /api/logs": "Lista logs (autenticado). Query: gardenId, type, fromDate, toDate, limit, skip",
        "GET /api/logs/:id": "Log por _id (MongoDB)",
        "POST /api/logs": "Cria log",
        "PUT /api/logs/:id": "Atualiza log",
        "DELETE /api/logs/:id": "Remove log",
      },
      inventory: {
        "GET /api/inventory": "Lista itens (autenticado). Query: category, limit, skip",
        "GET /api/inventory/low-stock": "Itens com minStock > 0 e quantity <= minStock",
        "GET /api/inventory/:id": "Item por id",
        "POST /api/inventory": "Cria item",
        "PATCH /api/inventory/:id": "Atualiza item",
        "DELETE /api/inventory/:id": "Remove item",
      },
    },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/gardens", businessApiLimiter, gardensRoutes);
app.use("/api/logs", businessApiLimiter, logsRoutes);
app.use("/api/inventory", businessApiLimiter, inventoryRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada", path: req.path });
});

const errorMiddleware = require("./infrastructure/errorMiddleware");
app.use(errorMiddleware);

module.exports = app;
