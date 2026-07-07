/**
 * X402Payer — the buyer half of Argus.
 *
 * To audit an ASP honestly you must actually *be its customer*: pay it a real
 * USD₮0 micropayment over x402 and observe what it delivers. This wraps the OKX
 * x402 client so Argus can pay any `exact`-scheme endpoint on X Layer.
 *
 * Wire (OKX x402 v2): request → 402 with `PAYMENT-REQUIRED`; sign the chosen
 * `accepts` entry; replay with `PAYMENT-SIGNATURE`; settlement comes back in
 * `PAYMENT-RESPONSE` (→ status / transaction / amount / payer).
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import { UptoEvmScheme } from "@okxweb3/x402-evm/upto/client";

export interface Settlement {
  status?: string;
  transaction?: string;
  amount?: string;
  payer?: string;
}

export interface Quote {
  scheme?: string;
  network?: string;
  payTo?: string;
  /** atomic amount required (USD₮0 base units) */
  value?: string;
}

export interface CallOutcome {
  httpStatus: number;
  paid: boolean;
  latencyMs: number;
  rawBody: string;
  body: unknown;
  /** decoded from the 402's PAYMENT-REQUIRED, if any */
  quote: Quote | null;
  /** decoded from PAYMENT-RESPONSE, if the call was paid + settled */
  settlement: Settlement | null;
  /** the PAYMENT-SIGNATURE header(s) we sent — captured so a probe can replay them */
  paymentHeaders: Record<string, string> | null;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class X402Payer {
  private readonly http: x402HTTPClient;
  readonly address: string;

  constructor(privateKey: string, rpcUrl = process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech") {
    const account = privateKeyToAccount(privateKey as Hex);
    this.address = account.address;
    const client = new x402Client();
    // Register both dialects Argus buys in: `exact` (screen/certify, EIP-3009,
    // gasless) and `upto` (audit, Permit2-metered). Without the upto scheme the
    // client can't answer a metered 402.
    registerExactEvmScheme(client, {
      signer: account,
      schemeOptions: { rpcUrl },
      networks: ["eip155:196"],
    });
    client.register("eip155:196", new UptoEvmScheme(account, { rpcUrl }));
    this.http = new x402HTTPClient(client);
  }

  /** Full pay-and-call: fetch, and if challenged, sign + replay once. */
  async call(url: string, init: RequestInit = {}): Promise<CallOutcome> {
    const started = Date.now();
    const first = await fetch(url, init);
    if (first.status !== 402) {
      const text = await first.text();
      return {
        httpStatus: first.status,
        paid: false,
        latencyMs: Date.now() - started,
        rawBody: text,
        body: parseBody(text),
        quote: null,
        settlement: null,
        paymentHeaders: null,
      };
    }

    const getHeader = (name: string) => first.headers.get(name);
    const paymentRequired = this.http.getPaymentRequiredResponse(getHeader);
    const quote = firstAccept(paymentRequired);

    const payload = await this.http.createPaymentPayload(paymentRequired);
    const paymentHeaders = this.http.encodePaymentSignatureHeader(payload);

    const paid = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...paymentHeaders },
    });
    const text = await paid.text();
    const settlement = safeSettle(this.http, (n) => paid.headers.get(n));

    return {
      httpStatus: paid.status,
      paid: paid.status < 300,
      latencyMs: Date.now() - started,
      rawBody: text,
      body: parseBody(text),
      quote,
      settlement,
      paymentHeaders,
    };
  }

  /** Single fetch with caller-supplied headers — used to replay a stale signature. */
  async raw(url: string, init: RequestInit, headers: Record<string, string>): Promise<CallOutcome> {
    const started = Date.now();
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...headers } });
    const text = await res.text();
    return {
      httpStatus: res.status,
      paid: res.status < 300,
      latencyMs: Date.now() - started,
      rawBody: text,
      body: parseBody(text),
      quote: null,
      settlement: safeSettle(this.http, (n) => res.headers.get(n)),
      paymentHeaders: headers,
    };
  }
}

function firstAccept(paymentRequired: unknown): Quote | null {
  const accepts = (paymentRequired as { accepts?: Array<Record<string, unknown>> })?.accepts;
  if (!accepts?.length) return null;
  const a = accepts[0];
  return {
    scheme: a.scheme as string | undefined,
    network: a.network as string | undefined,
    payTo: a.payTo as string | undefined,
    // OKX x402 v2 names the atomic price `amount`; keep `value` as a fallback
    // for any resource server that emits the older field name.
    value: (a.amount ?? a.value) as string | undefined,
  };
}

function safeSettle(http: x402HTTPClient, getHeader: (n: string) => string | null | undefined): Settlement | null {
  try {
    return http.getPaymentSettleResponse(getHeader) as unknown as Settlement;
  } catch {
    return null;
  }
}
