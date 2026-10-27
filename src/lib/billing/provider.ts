import { createHmac, timingSafeEqual } from "node:crypto";

// The payment gateway behind one small interface. The gateway only collects money: our database
// decides what a payment buys (see docs/BILLING.md). Two drivers:
//
//   razorpay  the real gateway (Orders API, Checkout, webhooks).
//   test      for development, tests and demos only. No money moves. It is chosen only by setting
//             BILLING_DRIVER=test explicitly, and the pages label it clearly.
//
// With neither configured, online payment is simply off and staff set plans by hand.

export type ProviderName = "razorpay" | "test";

export type CreatedOrder = { providerOrderId: string };

export interface PaymentProvider {
  readonly name: ProviderName;
  /** Safe to show in the browser: what the checkout needs to open. */
  readonly publicKey: string | null;
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
    /** Send the money on to a linked account (a builder's token), instead of keeping it. */
    transfer?: { accountId: string; amountPaise: number };
  }): Promise<CreatedOrder>;
  /** The check the browser's "payment done" message must pass before it is believed. */
  verifyCheckoutSignature(input: {
    providerOrderId: string;
    paymentId: string;
    signature: string;
  }): boolean;
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  /** Returns the gateway's refund id. */
  /** `reverseTransfers` takes the money back from a linked account too (a refunded token). */
  refund(input: {
    paymentId: string;
    amountPaise: number;
    reverseTransfers?: boolean;
  }): Promise<{ refundId: string }>;
}

const hmacHex = (secret: string, message: string) =>
  createHmac("sha256", secret).update(message).digest("hex");

/** Compares two hex signatures without leaking where they differ. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------------------

class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay" as const;
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  get publicKey() {
    return this.keyId;
  }

  private async call(path: string, body: Record<string, unknown>) {
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // The body can name the problem (for example a bad amount); it never holds our secret.
      throw new Error(
        `Razorpay ${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    return (await response.json()) as { id?: string };
  }

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
    transfer?: { accountId: string; amountPaise: number };
  }) {
    const order = await this.call("/orders", {
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      notes: input.notes,
      ...(input.transfer
        ? {
            transfers: [
              {
                account: input.transfer.accountId,
                amount: input.transfer.amountPaise,
                currency: "INR",
                notes: input.notes,
              },
            ],
          }
        : {}),
    });
    if (!order.id) throw new Error("Razorpay did not return an order id.");
    return { providerOrderId: order.id };
  }

  verifyCheckoutSignature(input: {
    providerOrderId: string;
    paymentId: string;
    signature: string;
  }) {
    return safeEqualHex(
      hmacHex(this.keySecret, `${input.providerOrderId}|${input.paymentId}`),
      input.signature,
    );
  }

  verifyWebhookSignature(rawBody: string, signature: string | null) {
    return signature ? safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature) : false;
  }

  async refund(input: { paymentId: string; amountPaise: number; reverseTransfers?: boolean }) {
    const refund = await this.call(`/payments/${encodeURIComponent(input.paymentId)}/refund`, {
      amount: input.amountPaise,
      ...(input.reverseTransfers ? { reverse_all: 1 } : {}),
    });
    if (!refund.id) throw new Error("Razorpay did not return a refund id.");
    return { refundId: refund.id };
  }
}

/**
 * A stand-in gateway that moves no money. It signs like the real one, so the same verification
 * code runs in tests, and a test can play the gateway by posting a signed webhook.
 */
class TestProvider implements PaymentProvider {
  readonly name = "test" as const;
  readonly publicKey = null;
  constructor(private readonly secret: string) {}

  async createOrder(input: { receipt: string }) {
    return { providerOrderId: `order_test_${input.receipt}` };
  }
  verifyCheckoutSignature(input: {
    providerOrderId: string;
    paymentId: string;
    signature: string;
  }) {
    return safeEqualHex(
      hmacHex(this.secret, `${input.providerOrderId}|${input.paymentId}`),
      input.signature,
    );
  }
  verifyWebhookSignature(rawBody: string, signature: string | null) {
    return signature ? safeEqualHex(hmacHex(this.secret, rawBody), signature) : false;
  }
  async refund(input: { paymentId: string }) {
    return { refundId: `rfnd_test_${input.paymentId}` };
  }
}

/** The signature a gateway would put on a body, for tests that play the gateway. */
export const signWithSecret = hmacHex;

export type BillingConfig =
  | { driver: "none" }
  | { driver: "test"; secret: string }
  | { driver: "razorpay"; keyId: string; keySecret: string; webhookSecret: string };

/** Reads the environment. Throws on a half-set configuration, so a typo cannot go unnoticed. */
export function billingConfig(
  env: Record<string, string | undefined> = process.env,
): BillingConfig {
  const driver = env.BILLING_DRIVER?.trim();
  if (!driver || driver === "none") return { driver: "none" };
  if (driver === "test") {
    if (env.NODE_ENV === "production" && env.ALLOW_TEST_BILLING !== "yes") {
      throw new Error("BILLING_DRIVER=test is not allowed in production.");
    }
    const secret = env.BILLING_TEST_SECRET;
    if (!secret || secret.length < 16) {
      throw new Error("BILLING_DRIVER=test needs BILLING_TEST_SECRET (at least 16 characters).");
    }
    return { driver: "test", secret };
  }
  if (driver === "razorpay") {
    const keyId = env.RAZORPAY_KEY_ID;
    const keySecret = env.RAZORPAY_KEY_SECRET;
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
    if (!keyId || !keySecret || !webhookSecret) {
      throw new Error(
        "BILLING_DRIVER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.",
      );
    }
    return { driver: "razorpay", keyId, keySecret, webhookSecret };
  }
  throw new Error(`Unknown BILLING_DRIVER "${driver}". Use razorpay, test or leave it unset.`);
}

export function providerFor(config: BillingConfig): PaymentProvider | null {
  if (config.driver === "razorpay") {
    return new RazorpayProvider(config.keyId, config.keySecret, config.webhookSecret);
  }
  if (config.driver === "test") return new TestProvider(config.secret);
  return null;
}

/** The configured gateway, or null when online payment is off. */
export function billingProvider(): PaymentProvider | null {
  return providerFor(billingConfig());
}
