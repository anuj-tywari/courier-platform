
export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNKNOWN_COURIER = "UNKNOWN_COURIER",
  COURIER_DISABLED = "COURIER_DISABLED",
  DUPLICATE_ORDER = "DUPLICATE_ORDER",
  ORDER_NOT_FOUND = "ORDER_NOT_FOUND",
  COURIER_CLIENT_ERROR = "COURIER_CLIENT_ERROR", // normalized 4xx from courier
  COURIER_UNAVAILABLE = "COURIER_UNAVAILABLE", // normalized 5xx/timeout/network from courier
  COURIER_AUTH_FAILED = "COURIER_AUTH_FAILED", // re-auth + retry already exhausted
  COURIER_MISCONFIGURED = "COURIER_MISCONFIGURED", // admin-added courier is missing the endpoint this call needs
  RATE_LIMITED = "RATE_LIMITED",
  UNAUTHORIZED = "UNAUTHORIZED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNKNOWN_COURIER]: 400,
  [ErrorCode.COURIER_DISABLED]: 400,
  [ErrorCode.DUPLICATE_ORDER]: 409,
  [ErrorCode.ORDER_NOT_FOUND]: 404,
  [ErrorCode.COURIER_CLIENT_ERROR]: 422,
  [ErrorCode.COURIER_UNAVAILABLE]: 502,
  [ErrorCode.COURIER_AUTH_FAILED]: 502,
  [ErrorCode.COURIER_MISCONFIGURED]: 502,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

export class AppError extends Error {
  code: ErrorCode;
  httpStatus: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export class CourierClientError extends AppError {
  constructor(courierPartner: string, message: string, details?: unknown) {
    super(ErrorCode.COURIER_CLIENT_ERROR, `${courierPartner}: ${message}`, details);
  }
}

export class CourierUnavailableError extends AppError {
  constructor(courierPartner: string, message: string, details?: unknown) {
    super(ErrorCode.COURIER_UNAVAILABLE, `${courierPartner}: ${message}`, details);
  }
}

export class CourierAuthError extends AppError {
  constructor(courierPartner: string, message: string, details?: unknown) {
    super(ErrorCode.COURIER_AUTH_FAILED, `${courierPartner}: ${message}`, details);
  }
}
