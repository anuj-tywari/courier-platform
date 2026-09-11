import { Request, Response, NextFunction } from "express";
import { courierAdminService } from "../services/courier-admin.service";

export async function listCouriers(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await courierAdminService.list() });
  } catch (err) {
    next(err);
  }
}

export async function getCourier(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await courierAdminService.getById(String(req.params.id)) });
  } catch (err) {
    next(err);
  }
}

export async function createCourier(req: Request, res: Response, next: NextFunction) {
  try {
    const { id, display_name, config } = req.body;
    const dto = await courierAdminService.create({ id, displayName: display_name, config });
    res.status(201).json({ success: true, data: dto });
  } catch (err) {
    next(err);
  }
}

export async function updateCourier(req: Request, res: Response, next: NextFunction) {
  try {
    const { display_name, config } = req.body;
    const dto = await courierAdminService.update(String(req.params.id), { displayName: display_name, config });
    res.json({ success: true, data: dto });
  } catch (err) {
    next(err);
  }
}

function operationParam(req: Request): string {
  return String(req.params.operation).toLowerCase();
}

export async function upsertEndpoint(req: Request, res: Response, next: NextFunction) {
  try {
    const dto = await courierAdminService.upsertEndpoint(String(req.params.id), operationParam(req), req.body);
    res.json({ success: true, data: dto });
  } catch (err) {
    next(err);
  }
}

export async function removeEndpoint(req: Request, res: Response, next: NextFunction) {
  try {
    const dto = await courierAdminService.removeEndpoint(String(req.params.id), operationParam(req));
    res.json({ success: true, data: dto });
  } catch (err) {
    next(err);
  }
}

export async function setEnabled(req: Request, res: Response, next: NextFunction) {
  try {
    const dto = await courierAdminService.setEnabled(String(req.params.id), req.body.enabled);
    res.json({ success: true, data: dto });
  } catch (err) {
    next(err);
  }
}

export async function setEnabledBulk(req: Request, res: Response, next: NextFunction) {
  try {
    const dtos = await courierAdminService.setEnabledBulk(req.body.ids, req.body.enabled);
    res.json({ success: true, data: dtos });
  } catch (err) {
    next(err);
  }
}

export async function deleteCourier(req: Request, res: Response, next: NextFunction) {
  try {
    await courierAdminService.remove(String(req.params.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function testConnection(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await courierAdminService.testConnection(req.body.config, req.body.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
