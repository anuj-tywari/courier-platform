import rateLimit from "express-rate-limit";
import { config } from "../config";
import { ErrorCode } from "../types/errors";

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: { code: ErrorCode.RATE_LIMITED, message: "Too many requests, please try again later." },
      request_id: req.requestId,
    });
  },
});
