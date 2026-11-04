"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icon";
import { startClaim, type StartClaimState } from "./actions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_ERROR = "Enter a complete email address, such as alex@example.com.";

export function ClaimEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<StartClaimState, FormData>(startClaim.bind(null, token), { status: "idle" });
  const [fieldError, setFieldError] = useState<string | null>(null);

  if (state.status === "sent") {
    return (
      <div className="notice success" role="status">
        <Icon name="mail" />
        <div>
          <p>
            <strong>Check your inbox.</strong> We sent a sign-in link to {state.email}. Opening it finishes claiming your profile.
          </p>
          <p>If that address is on file for this profile, you’ll have access right away. Otherwise we’ll confirm it’s you first.</p>
        </div>
      </div>
    );
  }

  const error = fieldError ?? (state.status === "error" ? state.message : null);
  return (
    <form
      action={action}
      noValidate
      onSubmit={(e) => {
        const email = String(new FormData(e.currentTarget).get("email") ?? "");
        if (!EMAIL_PATTERN.test(email)) {
          e.preventDefault();
          setFieldError(EMAIL_ERROR);
        }
      }}
    >
      <div className="field">
        <label htmlFor="claim-email">Your email address</label>
        <input
          id="claim-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={`claim-email-help${error ? " claim-email-error" : ""}`}
          onBlur={(e) => setFieldError(e.target.value && !EMAIL_PATTERN.test(e.target.value) ? EMAIL_ERROR : null)}
          onInput={() => fieldError && setFieldError(null)}
        />
        <small id="claim-email-help">We’ll verify your identity before giving access to this profile.</small>
        {error && (
          <span className="error-text" id="claim-email-error">
            {error}
          </span>
        )}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Sending…" : "Claim my profile"}
        </button>
      </div>
    </form>
  );
}
