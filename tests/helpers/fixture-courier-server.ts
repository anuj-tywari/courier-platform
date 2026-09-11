
import http from "http";
import { AddressInfo } from "net";

export const FIXTURE_API_KEY = "fixture-secret-key";

export function startFixtureCourierServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const shipments = new Map<string, { state: string }>();
  let counter = 0;

  const server = http.createServer((req, res) => {
    if (req.headers["x-api-key"] !== FIXTURE_API_KEY) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "missing/invalid api key" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = req.url || "";
      res.setHeader("content-type", "application/json");

      if (req.method === "POST" && url === "/shipments") {
        counter += 1;
        const id = `FX-${counter}`;
        shipments.set(id, { state: "in_transit" }); // starts "in transit" so the track test sees a real value
        res.writeHead(201);
        res.end(JSON.stringify({ id, tracking: `TRK${id}`, state: "new" }));
        return;
      }

      const trackMatch = url.match(/^\/shipments\/([^/]+)$/);
      if (req.method === "GET" && trackMatch) {
        const shipment = shipments.get(trackMatch[1]);
        res.writeHead(shipment ? 200 : 404);
        res.end(JSON.stringify(shipment ? { state: shipment.state } : { message: "not found" }));
        return;
      }

      const voidMatch = url.match(/^\/shipments\/([^/]+)\/void$/);
      if (req.method === "POST" && voidMatch) {
        const shipment = shipments.get(voidMatch[1]);
        if (shipment) shipment.state = "voided";
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, state: "voided" }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ message: "not found" }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
