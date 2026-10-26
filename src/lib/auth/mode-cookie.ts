import "server-only";
import type { NextResponse } from "next/server";
import { MODE_COOKIE, MODE_COOKIE_MAX_AGE, type Mode } from "@/lib/auth/mode";
import { getSiteUrl } from "@/lib/site";

// The mode cookie (see mode.ts). It is readable by the page script on purpose: static pages hide
// the other side's elements before they are painted. It is only a preference; the server checks it
// against the person's real accounts.

/** Options for `cookies().set(...)` in server actions and route handlers. */
export function modeCookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: getSiteUrl().protocol === "https:",
    httpOnly: false,
    maxAge: MODE_COOKIE_MAX_AGE,
  };
}

export function withModeCookie<T extends NextResponse>(response: T, mode: Mode): T {
  response.cookies.set(MODE_COOKIE, mode, modeCookieOptions());
  return response;
}

export function withoutModeCookie<T extends NextResponse>(response: T): T {
  response.cookies.set(MODE_COOKIE, "", { ...modeCookieOptions(), maxAge: 0 });
  return response;
}
