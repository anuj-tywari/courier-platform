import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCode } from "../types/errors";
import { logger } from "../utils/logger";

const COURIER_ERROR_CODES = new Set([ErrorCode.COURIER_CLIENT_ERROR, ErrorCode.COURIER_UNAVAILABLE, ErrorCode.COURIER_AUTH_FAILED]);

function clientSafeDetails(appError: AppError): unknown {
  if (!COURIER_ERROR_CODES.has(appError.code) || !appError.details || typeof appError.details !== "object") {
    return appError.details;
  }
  const { body: _raw, ...safe } = appError.details as Record<string, unknown>;
  return safe;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const appError =
    err instanceof AppError ? err : new AppError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred");

  if (appError.code === ErrorCode.INTERNAL_ERROR) {
    logger.error({ request_id: req.requestId, err, stack: (err as Error)?.stack }, "unhandled error");
  } else if (COURIER_ERROR_CODES.has(appError.code)) {
    logger.warn({ request_id: req.requestId, code: appError.code, details: appError.details }, appError.message);
  }

  res.status(appError.httpStatus).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: clientSafeDetails(appError),
    },
    request_id: req.requestId,
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: ErrorCode.ORDER_NOT_FOUND, message: `Route not found: ${req.method} ${req.path}` },
    request_id: req.requestId,
  });
}
