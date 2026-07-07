/** One-shot signed call to the OKX facilitator — prints the full error body. */
import "dotenv/config";
import crypto from "node:crypto";

const base = process.env.OKX_BASE_URL ?? "https://web3.okx.com";
const path = "/api/v6/pay/x402/supported";
const timestamp = new Date().toISOString();
const prehash = timestamp + "GET" + path;
const sign = crypto.createHmac("sha256", process.env.OKX_SECRET_KEY!).update(prehash).digest("base64");

console.log(`host: ${base}`);
console.log(`local clock: ${timestamp}`);

const res = await fetch(base + path, {
  headers: {
    "OK-ACCESS-KEY": process.env.OKX_API_KEY!,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": process.env.OKX_PASSPHRASE!,
    "Content-Type": "application/json",
  },
});
console.log(`HTTP ${res.status}`);
console.log(`upstream path seen by relay: ${res.headers.get("x-relay-upstream-path")}`);
console.log(await res.text());
