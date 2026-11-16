// Mock mínimo de la API de Clip para el harness local de idempotencia.
// Se ejecuta dentro de la red de Docker para que edge-runtime lo alcance.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 4599);
const hits = { payments: 0, checkout: 0 };

createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    response.setHeader("content-type", "application/json");

    if (request.url === "/__hits") {
      response.end(JSON.stringify(hits));
      return;
    }
    if (request.url === "/__reset") {
      hits.payments = 0;
      hits.checkout = 0;
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/payments") {
      hits.payments += 1;
      setTimeout(() => {
        response.end(JSON.stringify({ status: "approved", id: "pay_qa", receipt_no: "rcp_qa" }));
      }, 900);
      return;
    }
    if (request.url === "/v2/checkout") {
      hits.checkout += 1;
      setTimeout(() => {
        response.end(
          JSON.stringify({
            payment_request_url: "https://pay.clip.mx/qa",
            payment_request_id: randomUUID(),
            amount: 899,
            currency: "MXN",
            status: "CHECKOUT_CREATED",
          })
        );
      }, 900);
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`clip-mock escuchando en :${PORT}`);
});
