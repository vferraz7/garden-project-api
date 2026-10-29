import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../config/logger";

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers["x-request-id"] as string) || uuidv4();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const { id, method, url, ip, headers } = req;

  logger.info(
    {
      requestId: id,
      method,
      url,
      ip,
      userAgent: headers["user-agent"],
    },
    "Incoming request"
  );

  res.on("finish", () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    logger[level](
      {
        requestId: id,
        method,
        url,
        statusCode: res.statusCode,
        durationMs: Math.round(duration * 100) / 100,
      },
      "Request completed"
    );
  });

  next();
};