"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { saveProjectStep } from "@/app/(app)/portal/projects/actions";
import { useAutosave, type AutosaveState } from "@/components/portal/use-autosave";
import { STEP_UI, type FieldUi } from "@/components/project/step-config";
import { Field, inputClass } from "@/components/ui/field";
import { AMENITIES, AMENITY_GROUPS } from "@/lib/projects/amenities";
import {
  PROJECT_FIELDS,
  type FormStep,
  type ProjectFieldKey,
  type ProjectFormValues,
} from "@/lib/projects/fields";
import type { ProjectEditMode } from "@/lib/projects/status";

function saveMessage(state: AutosaveState): { text: string; tone: string } {
  switch (state.phase) {
    case "pending":
      return { text: "Unsaved changes...", tone: "text-slate-500" };
    case "saving":
      return { text: "Saving...", tone: "text-slate-500" };
    case "saved":
      return { text: "All changes saved", tone: "text-teal-700" };
    case "error":
      return { text: state.message, tone: "text-red-600" };
    default:
      return { text: "Changes save automatically", tone: "text-slate-500" };
  }
}

export function StepForm({
  projectId,
  step,
  initial,
  mode,
  children,
}: {
  projectId: string;
  step: FormStep;
  initial: ProjectFormValues;
  mode: ProjectEditMode;
  /** Extra content shown under the fields, outside the autosaving form. */
  children?: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // A stable function per project and step, as the autosave hook requires.
  const save = useCallback(
    (values: Record<string, string>) => saveProjectStep(projectId, step, values),
    [projectId, step],
  );
  const { state, errors, markChanged, flush } = useAutosave(formRef, save);
  const message = saveMessage(state);
  const ui = STEP_UI[step];

  const disabled = (key: ProjectFieldKey) =>
    mode === "locked" || (mode === "cosmetic" && PROJECT_FIELDS[key].material);

  function control(field: FieldUi) {
    const { key } = field;
    const error = errors[key];
    const common = {
      id: key,
      name: key,
      disabled: disabled(key),
      className: inputClass,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${key}-error` : undefined,
    } as const;
    const c = field.control;

    switch (c.kind) {
      case "text":
        return (
          <input
            type="text"
            defaultValue={initial[key]}
            inputMode={c.inputMode}
            placeholder={c.placeholder}
            maxLength={c.maxLength}
            autoComplete="off"
            {...common}
          />
        );
      case "textarea":
        return (
          <textarea rows={c.rows} maxLength={c.maxLength} defaultValue={initial[key]} {...common} />
        );
      case "select":
        return (
          <select defaultValue={initial[key]} {...common}>
            {PROJECT_FIELDS[key].nullable && <option value="">Choose...</option>}
            {c.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      case "date":
        return <input type="date" defaultValue={initial[key]} {...common} />;
      case "amenities": {
        const chosen = new Set(initial.amenities.split(",").filter(Boolean));
        return (
          <div className="space-y-5">
            {/* Keeps the field in the saved data when every box is unticked. */}
            <input type="hidden" name="amenities" value="" />
            {AMENITY_GROUPS.map((group) => (
              <fieldset key={group}>
                <legend className="text-sm font-semibold">{group}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {AMENITIES.filter((a) => a.group === group).map((amenity) => (
                    <label
                      key={amenity.code}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm has-[:checked]:border-teal-700 has-[:checked]:bg-teal-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                    >
                      <input
                        type="checkbox"
                        name="amenities"
                        value={amenity.code}
                        defaultChecked={chosen.has(amenity.code)}
                        disabled={disabled("amenities")}
                        className="size-4 accent-teal-700"
                      />
                      {amenity.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        );
      }
    }
  }

  return (
    <div className="space-y-6">
      <form
        ref={formRef}
        noValidate
        onInput={(event) => markChanged((event.target as HTMLInputElement).name)}
        onBlur={flush}
        onSubmit={(event) => {
          event.preventDefault();
          flush();
        }}
        className="space-y-5"
      >
        <div className="sticky top-16 z-10 -mx-1 rounded-lg bg-white/95 px-1 py-2 backdrop-blur">
          <p aria-live="polite" className={`text-sm font-medium ${message.tone}`}>
            {message.text}
          </p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold">{ui.title}</h2>
          {ui.description && <p className="mt-1 text-sm text-slate-600">{ui.description}</p>}
          {mode === "cosmetic" && (
            <p className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-700">
              This project is live. Fields that identify it or describe its legal status are locked;
              everything else you change appears straight away.
            </p>
          )}
          {mode === "locked" && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              This project can&apos;t be edited right now.
            </p>
          )}
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {ui.fields.map((field) => (
              <div key={field.key} className={field.wide ? "sm:col-span-2" : undefined}>
                <Field
                  id={field.key}
                  label={PROJECT_FIELDS[field.key].label}
                  required={field.required}
                  hint={field.hint}
                  error={errors[field.key]}
                >
                  {control(field)}
                </Field>
              </div>
            ))}
          </div>
        </section>
      </form>
      {children}
    </div>
  );
}
