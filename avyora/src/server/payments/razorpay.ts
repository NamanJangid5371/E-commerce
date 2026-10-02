import crypto from "crypto";
import Razorpay from "razorpay";

export type RazorpayConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
};

export type CreateRazorpayOrderInput = {
  amountInr: number;
  receipt?: string;
  notes?: Record<string, string>;
};

export type RazorpayOrderResult = {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
};

export type VerifyPaymentSignatureInput = {
  orderId: string;
  paymentId: string;
  signature: string;
};

export class RazorpayNotConfiguredError extends Error {
  constructor(message = "Razorpay is not configured.") {
    super(message);
    this.name = "RazorpayNotConfiguredError";
  }
}

let razorpayClient: Razorpay | null | undefined;

function getRazorpayClient(): Razorpay | null {
  if (razorpayClient !== undefined) return razorpayClient;

  const config = getRazorpayConfig();
  if (!config) {
    razorpayClient = null;
    return null;
  }

  razorpayClient = new Razorpay({
    key_id: config.keyId,
    key_secret: config.keySecret,
  });
  return razorpayClient;
}

/** Shared client accessor for refunds and other Razorpay operations. */
export function getRazorpayClientOrThrow(): Razorpay {
  const client = getRazorpayClient();
  if (!client) {
    throw new RazorpayNotConfiguredError(
      "Online payments are unavailable. Configure Razorpay keys or use cash on delivery.",
    );
  }
  return client;
}

/** Reads Razorpay credentials from environment. Never hardcodes secrets. */
export function getRazorpayConfig(): RazorpayConfig | null {
  const keyId =
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() ||
    process.env.RAZORPAY_KEY_ID?.trim() ||
    "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null;

  if (!keyId || !keySecret) return null;

  return { keyId, keySecret, webhookSecret };
}

export function isRazorpayConfigured(): boolean {
  return getRazorpayConfig() !== null;
}

export async function createRazorpayOrder(
  input: CreateRazorpayOrderInput,
): Promise<RazorpayOrderResult> {
  const amountPaise = Math.round(Math.max(0, input.amountInr) * 100);
  const receipt = input.receipt || `avyora_${Date.now()}`;

  const client = getRazorpayClient();
  if (!client) {
    throw new RazorpayNotConfiguredError(
      "Online payments are unavailable. Configure Razorpay keys or use cash on delivery.",
    );
  }

  const order = await client.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes: input.notes,
  });

  return {
    id: order.id,
    amount: Number(order.amount),
    currency: order.currency,
    receipt: order.receipt ?? receipt,
  };
}

export function verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean {
  const { orderId, paymentId, signature } = input;

  const config = getRazorpayConfig();
  if (!config) return false;

  const expected = crypto
    .createHmac("sha256", config.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  try {
    const expectedBuffer = Buffer.from(expected, "utf8");
    const signatureBuffer = Buffer.from(signature, "utf8");
    if (expectedBuffer.length !== signatureBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
  const config = getRazorpayConfig();
  if (!config?.webhookSecret) return false;

  const expected = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(rawBody)
    .digest("hex");

  try {
    const expectedBuffer = Buffer.from(expected, "utf8");
    const signatureBuffer = Buffer.from(signatureHeader, "utf8");
    if (expectedBuffer.length !== signatureBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}
