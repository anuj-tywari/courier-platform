import { Router } from "express";
import { requireAdminToken } from "../middleware/admin-auth";
import { validateBody } from "../middleware/validate";
import {
  createCourierSchema,
  updateCourierSchema,
  upsertEndpointSchema,
  setEnabledSchema,
  bulkSetEnabledSchema,
  testConnectionSchema,
} from "../validators/admin-courier.schema";
import * as controller from "../controllers/admin-courier.controller";

export const adminRoutes = Router();
adminRoutes.use(requireAdminToken);

adminRoutes.get("/couriers", controller.listCouriers);
adminRoutes.get("/couriers/:id", controller.getCourier);
adminRoutes.post("/couriers", validateBody(createCourierSchema), controller.createCourier);
adminRoutes.put("/couriers/:id", validateBody(updateCourierSchema), controller.updateCourier);
adminRoutes.patch("/couriers/:id/enable", validateBody(setEnabledSchema), controller.setEnabled);
adminRoutes.post("/couriers/bulk-enable", validateBody(bulkSetEnabledSchema), controller.setEnabledBulk);
adminRoutes.delete("/couriers/:id", controller.deleteCourier);
adminRoutes.post("/couriers/test", validateBody(testConnectionSchema), controller.testConnection);

adminRoutes.put("/couriers/:id/endpoints/:operation", validateBody(upsertEndpointSchema), controller.upsertEndpoint);
adminRoutes.delete("/couriers/:id/endpoints/:operation", controller.removeEndpoint);
