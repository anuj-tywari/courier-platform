import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { AppError, ErrorCode } from "../types/errors";

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "(root)",
        message: issue.message,
      }));
      return next(new AppError(ErrorCode.VALIDATION_ERROR, "Request validation failed", { fields: fieldErrors }));
    }
    req.body = result.data;
    next();
  };
}
