"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPlotStatusAction } from "@/app/(app)/portal/projects/actions";

const OPTIONS = [
  { value: "AVAILABLE", label: "Available" },
  { value: "BOOKED", label: "Booked" },
  { value: "SOLD", label: "Sold" },
];

const COLOUR: Record<string, string> = {
  AVAILABLE: "border-teal-500 bg-teal-50 text-teal-700",
  BOOKED: "border-amber-500 bg-amber-50 text-amber-700",
  SOLD: "border-slate-plot bg-slate-100 text-slate-700",
  HELD: "border-slate-300 bg-surface text-slate-700",
};

/** One plot's status, changed in place. The change is saved and logged the moment it is picked. */
export function PlotStatusSelect({
  projectId,
  plotId,
  status,
  disabled,
}: {
  projectId: string;
  plotId: string;
  status: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(status);
  const [failed, setFailed] = useState(false);

  // A plot held for an online payment can't be changed by hand.
  if (status === "HELD") {
    return <span className="bg-surface rounded-full px-2.5 py-1 text-xs font-semibold">Held</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Plot status"
        value={value}
        disabled={disabled || pending}
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          setFailed(false);
          startTransition(async () => {
            const result = await setPlotStatusAction(projectId, plotId, next);
            if (!result.ok) {
              setValue(previous);
              setFailed(true);
            }
            router.refresh();
          });
        }}
        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${COLOUR[value] ?? COLOUR.HELD} disabled:opacity-60`}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {failed && <span className="text-xs font-medium text-red-600">Not saved</span>}
    </div>
  );
}
