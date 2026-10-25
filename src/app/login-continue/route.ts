import { NextResponse } from "next/server";

// Set this (on the https site) as the "Application Login URI" in Auth0. After a user clicks
// the email verification link, Auth0's "verified" page sends them here. If their Auth0
// session is still alive they are signed straight in, with no password prompt.
//
// Auth0 appends parameters such as `iss`; we deliberately drop everything and start a clean
// login, so nothing from the query string can reach the Auth0 SDK.
export function GET(request: Request) {
  const target = new URL("/auth/login", request.url);
  target.searchParams.set("returnTo", "/dashboard");
  return NextResponse.redirect(target);
}
