import { Router } from "express";
import { orderRoutes } from "./order.routes";
import { adminRoutes } from "./admin.routes";

export const apiV1Router = Router();
apiV1Router.use(orderRoutes);
apiV1Router.use("/admin", adminRoutes);
