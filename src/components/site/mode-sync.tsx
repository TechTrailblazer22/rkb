"use client";

import { useEffect } from "react";
import type { Mode } from "@/lib/auth/mode";

/**
 * Keeps `<html data-mode>` equal to the account in use. The head script sets it on a full page
 * load; this covers moves made without one (for example creating a builder account redirects
 * straight into the portal), so the next public page never starts out with a stale mode.
 */
export function ModeSync({ mode }: { mode: Mode }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
  }, [mode]);
  return null;
}
