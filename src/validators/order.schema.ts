import { z } from "zod";
import { config } from "../config";

const addressSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(6),
  email: z.string().email().optional(),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(4),
  country: z.string().optional(),
});

const packageSchema = z.object({
  weightKg: z.number().positive(),
  lengthCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  declaredValue: z.number().nonnegative(),
  description: z.string().optional(),
});

export const createOrderSchema = z.object({
  order_id: z.string().min(1),
  courier_partner: z.string().min(1),
  pickup_address: addressSchema,
  delivery_address: addressSchema,
  package: packageSchema,
  payment_mode: z.enum(["PREPAID", "COD"]).optional(),
  cod_amount: z.number().nonnegative().optional(),
  reference_note: z.string().optional(),
});

export const bulkCreateOrderSchema = z.object({
  orders: z.array(createOrderSchema).min(1).max(config.bulk.maxOrders),
});
