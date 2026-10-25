"use client";

import type { ButtonHTMLAttributes } from "react";

/** A submit button that asks "are you sure?" first. For things that cannot be undone. */
export function ConfirmSubmit({
  message,
  ...props
}: { message: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      {...props}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    />
  );
}
