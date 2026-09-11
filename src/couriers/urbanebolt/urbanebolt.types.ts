
export interface UrbaneBoltManifestItem {
  customerCode: string; // account-level, not per-order
  orderNumber: string; // our order_id
  declaredValue: number;
  itemDescription: string;
  collectableValue: number; // COD amount, 0 for prepaid
  height: number;
  length: number;
  breadth: number;
  weight: number;
  pieces: number;
  serviceType: string; // e.g. "SDD"
  payMode: "COD" | "PPD";
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  invoiceValue: number;
  itemQuantity: number;

  shprName: string;
  shprAddress: string;
  shprAddressType: string;
  shprCity: string;
  shprState: string;
  shprCountry: string;
  shprPincode: number;
  shprMobile: number;
  shprEmail: string;

  consName: string;
  consAddress: string;
  consAddressType: string;
  consCity: string;
  consState: string;
  consCountry: string;
  consPincode: number;
  consMobile: number;
  consEmail: string;

  rtnName: string;
  rtnAddress: string;
  rtnAddressType: string;
  rtnCity: string;
  rtnState: string;
  rtnCountry: string;
  rtnPincode: number;
  rtnMobile: number;
  rtnEmail: string;
}

export const URBANEBOLT_STATUS_MAP: Record<string, string> = {
  man: "CREATED", // manifested (confirmed)
  pkp: "PICKED_UP",
  it: "IN_TRANSIT",
  ofd: "IN_TRANSIT", // out for delivery
  dlv: "DELIVERED",
  can: "CANCELLED", // confirmed
  rto: "FAILED",
  ud: "FAILED", // undelivered
};
