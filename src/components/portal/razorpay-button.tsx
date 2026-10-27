"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

type RazorpayResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};
type RazorpayInstance = { open: () => void; on: (event: string, callback: () => void) => void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

function loadCheckoutScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/** Opens Razorpay's own checkout. We never see card details: only the result, which the server verifies. */
export function RazorpayButton({
  orderId,
  providerOrderId,
  keyId,
  amountPaise,
  description,
  email,
  name,
  confirm,
  doneHref,
}: {
  orderId: string;
  providerOrderId: string;
  keyId: string;
  amountPaise: number;
  description: string;
  email: string;
  name: string | null;
  /** The server action that checks the gateway's signature and settles the payment. */
  confirm: (
    orderId: string,
    paymentId: string,
    signature: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Where to go once the payment is confirmed. */
  doneHref: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pay() {
    setMessage(null);
    setBusy(true);
    if (!(await loadCheckoutScript()) || !window.Razorpay) {
      setBusy(false);
      setMessage("The payment window could not load. Check your connection and try again.");
      return;
    }
    const checkout = new window.Razorpay({
      key: keyId,
      amount: amountPaise,
      currency: "INR",
      order_id: providerOrderId,
      name: "RKB Platform",
      description,
      prefill: { email, name: name ?? undefined },
      theme: { color: "#0f766e" },
      handler: async (response: RazorpayResponse) => {
        const result = await confirm(
          orderId,
          response.razorpay_payment_id,
          response.razorpay_signature,
        );
        if (result.ok) {
          router.push(doneHref);
          router.refresh();
        } else {
          setBusy(false);
          setMessage(result.message);
        }
      },
      modal: { ondismiss: () => setBusy(false) },
    });
    checkout.on("payment.failed", () => {
      setBusy(false);
      setMessage("The payment did not go through. You have not been charged. You can try again.");
    });
    checkout.open();
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={pay} disabled={busy} className={buttonClass("primary", "lg")}>
        {busy ? "Waiting for payment..." : "Pay securely"}
      </button>
      {message && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
    </div>
  );
}
