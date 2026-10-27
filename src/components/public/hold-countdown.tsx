"use client";

import { useEffect, useState } from "react";

/** Minutes and seconds left on a hold. It only displays: the server decides when a hold has ended. */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const end = new Date(expiresAt).getTime();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [end]);
  if (left === null) return null;
  if (left === 0) {
    return (
      <p role="status" className="font-semibold text-red-700" data-testid="hold-ended">
        The hold has ended. Reload this page to see where things stand.
      </p>
    );
  }
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <p className="font-semibold" data-testid="hold-countdown">
      Plot held for you:{" "}
      <span className="tabular-nums">
        {mm}:{ss}
      </span>{" "}
      left
    </p>
  );
}
