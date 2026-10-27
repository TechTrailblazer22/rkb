"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`${buttonClass("secondary")} no-print`}
    >
      <Printer className="size-4" aria-hidden="true" /> Print or save as PDF
    </button>
  );
}
