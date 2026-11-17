"use client";

import { useFormStatus } from "react-dom";

/** A submit button that shows it's working while its form's action runs. */
export function SubmitButton({ label, pendingLabel, className = "btn", disabled }: { label: string; pendingLabel: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
