import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getSiteUrl } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const description =
  "A digital showroom where verified builders list projects, show live plot availability and receive buyer enquiries directly.";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "RKB Platform: your projects, in every buyer's pocket",
    template: "%s | RKB Platform",
  },
  description,
  applicationName: "RKB Platform",
  openGraph: {
    type: "website",
    siteName: "RKB Platform",
    title: "RKB Platform: your projects, in every buyer's pocket",
    description,
    locale: "en_IN",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
