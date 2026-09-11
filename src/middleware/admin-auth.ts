import { timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { AppError, ErrorCode } from "../types/errors";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireAdminToken(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  if (!config.adminApiToken) {
    return next();
  }
  if (!token || !safeEqual(token, config.adminApiToken)) {
    return next(new AppError(ErrorCode.UNAUTHORIZED, "Missing or invalid admin token"));
  }
  next();
}
