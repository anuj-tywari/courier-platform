import { Router } from "express";
import { createOrderSchema, bulkCreateOrderSchema } from "../validators/order.schema";
import { validateBody } from "../middleware/validate";
import * as controller from "../controllers/order.controller";

export const orderRoutes = Router();

orderRoutes.get("/couriers", controller.listCouriers);

orderRoutes.post("/orders", validateBody(createOrderSchema), controller.createOrder);
orderRoutes.get("/orders/:order_id/track", controller.trackOrder);
orderRoutes.post("/orders/:order_id/cancel", controller.cancelOrder);

orderRoutes.post("/orders/bulk", validateBody(bulkCreateOrderSchema), controller.bulkCreateOrders);
orderRoutes.get("/orders/bulk/:batch_id", controller.getBatchStatus);
