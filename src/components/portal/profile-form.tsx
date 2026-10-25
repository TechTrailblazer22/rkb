"use client";

import { useRef, type ReactNode } from "react";
import { saveProfile } from "@/app/(app)/portal/actions";
import { ImageUpload } from "@/components/portal/image-upload";
import { useAutosave, type AutosaveState } from "@/components/portal/use-autosave";
import { Field, inputClass } from "@/components/ui/field";
import {
  BUILDER_TYPES,
  INDIAN_STATES,
  PROFILE_FIELDS,
  type ProfileFormValues,
  type ProfileKey,
} from "@/lib/builders/profile";
import type { EditMode } from "@/lib/builders/status";

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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function ProfileForm({
  initial,
  mode,
  logoUrl,
  coverUrl,
}: {
  initial: ProfileFormValues;
  mode: EditMode;
  logoUrl: string | null;
  coverUrl: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, errors, markChanged, flush } = useAutosave(formRef, saveProfile);
  const message = saveMessage(state);

  const isDisabled = (key: ProfileKey) =>
    mode === "locked" || (mode === "presentation" && PROFILE_FIELDS[key].legal);

  function common(key: ProfileKey) {
    const error = errors[key];
    return {
      id: key,
      name: key,
      defaultValue: initial[key],
      disabled: isDisabled(key),
      className: inputClass,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${key}-error` : undefined,
    } as const;
  }

  function field(key: ProfileKey, control: ReactNode, hint?: string, wide = false) {
    return (
      <div className={wide ? "sm:col-span-2" : undefined}>
        <Field
          id={key}
          label={PROFILE_FIELDS[key].label}
          required={PROFILE_FIELDS[key].required}
          hint={hint}
          error={errors[key]}
        >
          {control}
        </Field>
      </div>
    );
  }

  const text = (
    key: ProfileKey,
    options: {
      hint?: string;
      placeholder?: string;
      inputMode?: "numeric" | "tel" | "url";
      autoComplete?: string;
      maxLength?: number;
      wide?: boolean;
    } = {},
  ) =>
    field(
      key,
      <input
        type="text"
        {...common(key)}
        inputMode={options.inputMode}
        placeholder={options.placeholder}
        autoComplete={options.autoComplete ?? "off"}
        maxLength={options.maxLength}
      />,
      options.hint,
      options.wide,
    );

  return (
    <form
      ref={formRef}
      noValidate
      onInput={(event) => markChanged((event.target as HTMLInputElement).name)}
      onBlur={flush}
      onSubmit={(event) => {
        event.preventDefault();
        flush();
      }}
      className="space-y-6"
    >
      <div className="sticky top-16 z-10 -mx-1 rounded-lg bg-white/95 px-1 py-2 backdrop-blur">
        <p aria-live="polite" className={`text-sm font-medium ${message.tone}`}>
          {message.text}
        </p>
      </div>

      {mode === "locked" && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
          Your application can&apos;t be edited right now.
        </p>
      )}
      {mode === "presentation" && (
        <p className="rounded-xl bg-teal-50 p-4 text-sm text-teal-700">
          Your company is verified, so its legal details are locked. You can still update how it is
          presented. To change a locked detail, contact support.
        </p>
      )}

      <Section title="Company" description="How your company is described to buyers.">
        {text("companyName", { wide: true, autoComplete: "organization", maxLength: 120 })}
        {field(
          "type",
          <select {...common("type")}>
            <option value="">Choose...</option>
            {BUILDER_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>,
        )}
        {text("yearEstablished", {
          inputMode: "numeric",
          placeholder: "For example 2012",
          maxLength: 4,
        })}
        {text("projectsCompleted", { inputMode: "numeric", maxLength: 5 })}
        {text("projectsOngoing", { inputMode: "numeric", maxLength: 5 })}
        {field(
          "about",
          <textarea rows={4} maxLength={500} {...common("about")} />,
          "Up to 500 characters. Shown on your public profile.",
          true,
        )}
        {text("website", {
          inputMode: "url",
          placeholder: "www.yourcompany.com",
          wide: true,
          maxLength: 200,
        })}
      </Section>

      <Section title="Contact" description="Who we should speak to about your application.">
        {text("contactPerson", { autoComplete: "name", maxLength: 80 })}
        {text("contactMobile", {
          inputMode: "tel",
          autoComplete: "tel-national",
          placeholder: "10 digit mobile",
          maxLength: 16,
        })}
        {text("whatsapp", {
          inputMode: "tel",
          placeholder: "If different from the mobile",
          maxLength: 16,
        })}
      </Section>

      <Section title="Office address">
        {text("addressLine", { wide: true, autoComplete: "street-address", maxLength: 200 })}
        {text("city", { autoComplete: "address-level2", maxLength: 60 })}
        {field(
          "state",
          <select {...common("state")}>
            <option value="">Choose...</option>
            {INDIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>,
        )}
        {text("pincode", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 6 })}
        {field(
          "serviceCities",
          <textarea rows={2} {...common("serviceCities")} />,
          "Separate cities with commas.",
          true,
        )}
      </Section>

      <Section
        title="Registration numbers"
        description="These are checked against the documents you upload. They cannot be changed after verification."
      >
        {text("pan", { placeholder: "ABCDE1234F", maxLength: 12 })}
        {text("gstin", { placeholder: "15 character GSTIN", maxLength: 18 })}
        {text("reraNumber", {
          hint: "Optional. Project approvals are added per project.",
          maxLength: 40,
        })}
        {field("reraValidTill", <input type="date" {...common("reraValidTill")} />)}
      </Section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">Branding</h2>
        <p className="mt-1 text-sm text-slate-600">Shown on your public builder page.</p>
        <div className="mt-5 grid gap-8 sm:grid-cols-2">
          <ImageUpload
            kind="LOGO"
            label="Logo"
            currentUrl={logoUrl}
            disabled={mode === "locked"}
            shape="square"
          />
          <ImageUpload
            kind="COVER"
            label="Cover picture"
            currentUrl={coverUrl}
            disabled={mode === "locked"}
            shape="wide"
          />
        </div>
      </section>
    </form>
  );
}
