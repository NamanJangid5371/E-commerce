import { getRazorpayClientOrThrow, RazorpayNotConfiguredError } from "@/server/payments/razorpay";

export type CreateRazorpayRefundInput = {
  paymentId: string;
  amountInr: number;
  notes?: Record<string, string>;
};

export type RazorpayRefundResult = {
  id: string;
  amount: number;
  status: string;
};

/**
 * Creates a Razorpay refund for a captured payment.
 * Amount is in INR; converted to paise for the API.
 * Throws RazorpayNotConfiguredError when credentials are missing.
 */
export async function createRazorpayRefund(
  input: CreateRazorpayRefundInput,
): Promise<RazorpayRefundResult> {
  const client = getRazorpayClientOrThrow();
  const amountPaise = Math.round(Math.max(0, input.amountInr) * 100);

  const refund = await client.payments.refund(input.paymentId, {
    amount: amountPaise,
    notes: input.notes,
  });

  return {
    id: String(refund.id),
    amount: Number(refund.amount ?? amountPaise) / 100,
    status: String(refund.status ?? "processed"),
  };
}

export { RazorpayNotConfiguredError };
