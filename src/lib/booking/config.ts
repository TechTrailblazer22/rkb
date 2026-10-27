// Online token booking is off unless it is switched on. It also needs a payment gateway, a company
// with a payout account, and a token amount inside the allowed range. See docs/BOOKING.md.

export type BookingConfig = {
  enabled: boolean;
  holdMinutes: number;
  minTokenPaise: number;
  maxTokenPaise: number;
};

const RUPEE = 100;

function number(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** Reads the environment. Anything unclear falls back to the safe default (booking off). */
export function bookingConfig(
  env: Record<string, string | undefined> = process.env,
): BookingConfig {
  return {
    enabled: ["yes", "true", "1"].includes((env.BOOKING_ENABLED ?? "").trim().toLowerCase()),
    holdMinutes: number(env.BOOKING_HOLD_MINUTES, 15, 5, 60),
    // The token is an advance, not the price: a cap keeps one mistake or one fraud from being large.
    minTokenPaise: number(env.BOOKING_MIN_TOKEN_RUPEES, 500, 1, 10_000_000) * RUPEE,
    maxTokenPaise: number(env.BOOKING_MAX_TOKEN_RUPEES, 100_000, 1, 10_000_000) * RUPEE,
  };
}

export type Availability =
  { available: true; tokenPaise: number } | { available: false; reason: string };

/**
 * Whether a plot of this project can be booked online right now. Pure, so every reason has a test.
 * `tokenRupees` is the project's token amount as the company entered it.
 */
export function bookingAvailability(input: {
  config: BookingConfig;
  paymentsConfigured: boolean;
  projectLive: boolean;
  builderVerified: boolean;
  payoutAccountId: string | null;
  tokenRupees: number | null;
}): Availability {
  const { config } = input;
  if (!config.enabled) return { available: false, reason: "Online booking is not switched on." };
  if (!input.paymentsConfigured) {
    return { available: false, reason: "Online payment is not set up." };
  }
  if (!input.projectLive || !input.builderVerified) {
    return { available: false, reason: "This project is not open for booking." };
  }
  if (!input.payoutAccountId) {
    return {
      available: false,
      reason: "This company has not been set up to receive online payments.",
    };
  }
  if (
    input.tokenRupees === null ||
    !Number.isInteger(input.tokenRupees) ||
    input.tokenRupees <= 0
  ) {
    return { available: false, reason: "This project has no token amount." };
  }
  const tokenPaise = input.tokenRupees * RUPEE;
  if (tokenPaise < config.minTokenPaise || tokenPaise > config.maxTokenPaise) {
    return { available: false, reason: "The token amount is outside the allowed range." };
  }
  return { available: true, tokenPaise };
}
