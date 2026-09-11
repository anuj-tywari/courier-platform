import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});

export function logFailure(params: {
  orderId?: string;
  courierPartner?: string;
  requestId?: string;
  errorType: string;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}) {
  logger.error(
    {
      order_id: params.orderId,
      courier_partner: params.courierPartner,
      request_id: params.requestId,
      error_type: params.errorType,
      stack: params.stack,
      ...params.extra,
    },
    params.message
  );
}
