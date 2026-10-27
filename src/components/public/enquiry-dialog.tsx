"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";
import { submitEnquiry, type EnquiryState } from "@/app/(site)/project/[slug]/actions";
import { useViewer } from "@/components/public/shortlist";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { loginHref } from "@/lib/auth/intent";
import { MESSAGE_MAX } from "@/lib/leads/input";

/** "2026-11-03T10:30": the earliest time offered for a site visit, an hour from now. */
function earliestVisit(): string {
  const date = new Date(Date.now() + 61 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The address without #enquire and ?enquire=1, so the next press of "Send enquiry" opens it again. */
function clearEnquiryFromAddress() {
  const params = new URLSearchParams(window.location.search);
  params.delete("enquire");
  params.delete("plot");
  params.delete("request");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

type Props = {
  slug: string;
  projectId: string;
  projectName: string;
  companyName: string | null;
  plotNumbers: string[];
};

/** The form itself. It has its own state, so closing a sent enquiry starts the next one fresh. */
function EnquiryForm({
  slug,
  projectId,
  companyName,
  plotNumbers,
  initialPlot,
  asBooking,
  onClose,
  onSent,
}: Props & {
  /** A plot named in the address (a Request booking link), and whether this is a request to book it. */
  initialPlot: string;
  asBooking: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const nameField = useRef<HTMLInputElement>(null);
  const mobileField = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState<EnquiryState, FormData>(
    (previous, formData) => submitEnquiry(slug, previous, formData),
    null,
  );

  // Fill in the buyer's name and last mobile number.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/enquiry/defaults", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { name: string; mobile: string } | null) => {
        // Only into a field the buyer has not started typing in.
        if (data && nameField.current && !nameField.current.value)
          nameField.current.value = data.name;
        if (data && mobileField.current && !mobileField.current.value) {
          mobileField.current.value = data.mobile;
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const sent = state?.ok === true;
  useEffect(() => {
    if (sent) onSent();
  }, [sent, onSent]);

  const errors = state && !state.ok ? (state.errors ?? {}) : {};

  if (state?.ok) {
    return (
      <div className="space-y-4 text-center" data-testid="enquiry-sent">
        <CheckCircle2 className="mx-auto size-12 text-teal-500" aria-hidden="true" />
        <h3 className="text-lg font-bold">
          {state.repeat ? "Your message was added" : "Your enquiry was sent"}
        </h3>
        <p className="text-sm text-slate-700">
          {companyName ?? "The builder"} has been told and will contact you on your mobile number.
          You can follow the enquiry under My enquiries.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/account/enquiries" className={buttonClass("primary")}>
            My enquiries
          </Link>
          <button type="button" onClick={onClose} className={buttonClass("secondary")}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      // Sent by hand, not with <form action>: React resets a form after every action, which would
      // wipe what the buyer typed (and anything they type while the answer arrives).
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-4"
      noValidate
    >
      <input type="hidden" name="projectId" value={projectId} />
      {asBooking && <input type="hidden" name="intent" value="booking" />}
      {/* A field real visitors never see: a bot that fills in everything fills this one too. */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {state && !state.ok && state.message && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}

      <Field id="enq-name" label="Your name" required error={errors.name}>
        <input
          id="enq-name"
          name="name"
          ref={nameField}
          autoComplete="name"
          maxLength={80}
          className={inputClass}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "enq-name-error" : undefined}
        />
      </Field>

      <Field
        id="enq-mobile"
        label="Mobile number"
        required
        hint="The builder will call or WhatsApp you on this number."
        error={errors.mobile}
      >
        <input
          id="enq-mobile"
          name="mobile"
          ref={mobileField}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          maxLength={20}
          className={inputClass}
          aria-invalid={errors.mobile ? true : undefined}
          aria-describedby={errors.mobile ? "enq-mobile-error" : "enq-mobile-hint"}
        />
      </Field>

      <Field
        id="enq-message"
        label="Your message"
        hint="For example: which plot, or what you would like to know."
        error={errors.message}
      >
        <textarea
          id="enq-message"
          name="message"
          rows={3}
          maxLength={MESSAGE_MAX}
          className={inputClass}
          aria-invalid={errors.message ? true : undefined}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="enq-plot" label="Plot you are interested in" error={errors.preferredPlot}>
          <input
            id="enq-plot"
            name="preferredPlot"
            defaultValue={initialPlot}
            list="enq-plots"
            maxLength={40}
            autoComplete="off"
            className={inputClass}
          />
          <datalist id="enq-plots">
            {plotNumbers.map((number) => (
              <option key={number} value={number} />
            ))}
          </datalist>
        </Field>
        <Field id="enq-visit" label="Visit the site on" hint="Optional" error={errors.visitAt}>
          <input
            id="enq-visit"
            name="visitAt"
            type="datetime-local"
            min={earliestVisit()}
            className={inputClass}
            aria-invalid={errors.visitAt ? true : undefined}
          />
        </Field>
      </div>

      <div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="consent"
            className="mt-0.5 size-5 shrink-0 accent-teal-700"
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? "enq-consent-error" : undefined}
          />
          <span>
            I agree that RKB shares my name, mobile number, email and message with{" "}
            {companyName ?? "the builder"} so they can contact me. See the{" "}
            <Link href="/privacy" target="_blank" className="font-semibold text-teal-700 underline">
              Privacy Notice
            </Link>
            .
          </span>
        </label>
        {errors.consent && (
          <p
            id="enq-consent-error"
            role="alert"
            className="mt-1.5 text-xs font-medium text-red-600"
          >
            {errors.consent}
          </p>
        )}
      </div>

      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? "Sending..." : asBooking ? "Send booking request" : "Send enquiry"}
      </button>
    </form>
  );
}

/**
 * The enquiry form, in a native dialog. It opens when the address ends in #enquire (every "Send
 * enquiry" button is a link to that) or has ?enquire=1 (where a logged-out visitor lands after
 * logging in). What it shows depends on who is looking: a login prompt, a note for accounts that
 * cannot enquire, or the form.
 */
export function EnquiryDialog(props: Props) {
  const { slug, projectName, companyName } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const viewer = useViewer();
  const [formKey, setFormKey] = useState(0);
  const [sent, setSent] = useState(false);
  const [request, setRequest] = useState({ plot: "", booking: false });

  // Open and close with the address.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const sync = () => {
      const wanted =
        window.location.hash === "#enquire" ||
        new URLSearchParams(window.location.search).get("enquire") === "1";
      if (wanted && !element.open) {
        const params = new URLSearchParams(window.location.search);
        setRequest({
          plot: (params.get("plot") ?? "").slice(0, 40),
          booking: params.get("request") === "booking",
        });
        element.showModal();
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function close() {
    dialog.current?.close();
  }

  const returnPath = `/project/${slug}?enquire=1`;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="enquiry-title"
      data-testid="enquiry-dialog"
      onClose={() => {
        clearEnquiryFromAddress();
        // After a sent enquiry the next opening starts with a fresh form.
        if (sent) {
          setSent(false);
          setFormKey((key) => key + 1);
        }
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      className="m-auto max-h-[92vh] w-[calc(100%-1.5rem)] max-w-lg overflow-hidden rounded-2xl p-0 backdrop:bg-black/60"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <h2 id="enquiry-title" className="text-lg font-bold">
            {request.booking ? "Request to book" : "Send an enquiry"}
          </h2>
          <p className="truncate text-sm text-slate-600">{projectName}</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="hover:bg-surface -m-2 flex size-10 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-[calc(92vh-5rem)] overflow-y-auto px-5 py-5">
        {viewer === null || viewer.authenticated === null ? (
          <p className="text-sm text-slate-600" role="status">
            One moment...
          </p>
        ) : viewer.authenticated === false ? (
          <div data-testid="enquiry-login" className="space-y-4">
            <p className="text-sm text-slate-700">
              Log in as a buyer to send your enquiry. This lets {companyName ?? "the builder"} reply
              to a real person, and lets you follow your enquiries in one place.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={loginHref("buyer", { next: returnPath })} className={buttonClass("primary")}>
                Log in as a buyer
              </a>
              <a
                href={loginHref("buyer", { next: returnPath, signup: true })}
                className={buttonClass("secondary")}
              >
                Create a buyer account
              </a>
            </div>
          </div>
        ) : !viewer.canSave ? (
          <p className="text-sm text-slate-700" data-testid="enquiry-not-buyer">
            Enquiries can only be sent from a buyer account.
          </p>
        ) : (
          <EnquiryForm
            key={`${formKey}-${request.plot}-${request.booking}`}
            {...props}
            initialPlot={request.plot}
            asBooking={request.booking}
            onClose={close}
            onSent={() => setSent(true)}
          />
        )}
      </div>
    </dialog>
  );
}
