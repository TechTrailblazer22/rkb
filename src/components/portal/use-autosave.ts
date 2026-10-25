"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { SaveProfileResult } from "@/app/(app)/portal/actions";

export type AutosaveState =
  | { phase: "idle" }
  | { phase: "pending" }
  | { phase: "saving" }
  | { phase: "saved"; at: Date }
  | { phase: "error"; message: string };

const DEBOUNCE_MS = 700;

function snapshot(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/**
 * Saves a form as the user types. Rules that keep it safe:
 * - one request at a time; if the user kept typing meanwhile, the latest values go out next
 * - saves immediately when a field loses focus, and when the tab is hidden
 * - the server returns which fields it rejected, shown next to those fields
 *
 * `save` must be a stable function (a server action imported at module level).
 */
export function useAutosave(
  formRef: RefObject<HTMLFormElement | null>,
  save: (values: Record<string, string>) => Promise<SaveProfileResult>,
) {
  const router = useRouter();
  const [state, setState] = useState<AutosaveState>({ phase: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);

  const run = useCallback(async () => {
    const form = formRef.current;
    if (!form || inFlight.current) return;

    inFlight.current = true;
    try {
      // Loop instead of recursing: anything typed while a save is running is sent right after.
      while (dirty.current) {
        dirty.current = false;
        setState({ phase: "saving" });
        try {
          const result = await save(snapshot(form));
          if (result.ok) {
            setErrors(result.errors);
            setState({ phase: "saved", at: new Date(result.savedAt) });
          } else {
            setState({ phase: "error", message: result.message });
          }
        } catch {
          dirty.current = true; // keep the changes so the next attempt retries them
          setState({ phase: "error", message: "Could not save. Check your connection." });
          break;
        }
      }
    } finally {
      inFlight.current = false;
    }
    // Refresh server-rendered parts (progress, tab ticks) once everything is saved.
    if (!dirty.current) router.refresh();
  }, [formRef, router, save]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void run();
  }, [run]);

  const markChanged = useCallback(
    (field?: string) => {
      dirty.current = true;
      if (field) {
        setErrors((current) => {
          if (!(field in current)) return current;
          const { [field]: _removed, ...rest } = current;
          return rest;
        });
      }
      setState((current) => (current.phase === "saving" ? current : { phase: "pending" }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  return { state, errors, markChanged, flush };
}
