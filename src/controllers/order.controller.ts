import { Request, Response, NextFunction } from "express";
import { orderService } from "../services/order.service";
import { bulkService } from "../services/bulk.service";
import { courierRegistry } from "../couriers/registry";

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await orderService.createOrder(req.body, { requestId: req.requestId });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function trackOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await orderService.trackOrder(String(req.params.order_id), { requestId: req.requestId });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function cancelOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await orderService.cancelOrder(String(req.params.order_id), { requestId: req.requestId });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function bulkCreateOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bulkService.submitBatch(req.body.orders, { requestId: req.requestId });
    res.status(202).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getBatchStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bulkService.getBatchStatus(String(req.params.batch_id));
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export function listCouriers(_req: Request, res: Response) {
  res.status(200).json({ success: true, data: { supported_couriers: courierRegistry.supportedPartners() } });
}
