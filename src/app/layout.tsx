import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { MODE_COOKIE } from "@/lib/auth/mode";
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

const MODE_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${MODE_COOKIE}=(buyer|builder|admin)/);if(m)document.documentElement.setAttribute("data-mode",m[1])}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Before the first paint, tell the page which account the visitor is using (from the
            rkb_mode cookie), so the other side's elements are never shown, not even for a moment.
            See data-for in globals.css and docs/LOGIN-ROLES.md. */}
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
