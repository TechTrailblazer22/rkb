import type { NextConfig } from "next";

// Security headers for every response. The Content-Security-Policy is as strict as this site can be
// without a per-request nonce (a nonce would make every page dynamic and end the static caching the
// public pages rely on): no object embeds, no framing of our pages, no base-tag tricks, and scripts,
// frames and connections only to ourselves and the few services the site really uses (Razorpay's
// checkout, YouTube's privacy-friendly player, Cloudinary for images). Inline scripts are allowed
// because Next.js itself and the account-mode script in the root layout need them.
const isProduction = process.env.NODE_ENV === "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com https://*.razorpay.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Every page and API answer gets the policy, except the routes that serve uploaded files:
      // those set their own, far stricter one (`default-src 'none'; sandbox`), which a site-wide
      // policy must not replace.
      {
        source: "/((?!api/files|api/documents|api/project-documents).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
