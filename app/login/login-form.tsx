"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icon";
import { type LoginState, sendMagicLink } from "./actions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_ERROR = "Enter a complete email address, such as alex@example.com.";

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  if (state.status === "sent" && !editing) {
    return (
      <div>
        <span className="chip success">
          <Icon name="mail" />
          Sign-in link sent
        </span>
        <h1 style={{ marginTop: 24 }}>Check your inbox.</h1>
        <p>
          We sent a secure sign-in link to <strong>{state.email}</strong>. It expires in an hour.
        </p>
        <div className="form-actions">
          <button type="button" className="btn quiet" onClick={() => setEditing(true)}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  const serverError = state.status === "error" ? state.message : null;
  const error = fieldError ?? serverError;

  return (
    <form
      action={(formData) => {
        setEditing(false);
        return action(formData);
      }}
      onSubmit={(e) => {
        const email = String(new FormData(e.currentTarget).get("email") ?? "");
        if (!EMAIL_PATTERN.test(email)) {
          e.preventDefault();
          setFieldError(EMAIL_ERROR);
          (e.currentTarget.elements.namedItem("email") as HTMLInputElement).focus();
        }
      }}
      noValidate
    >
      <div className="eyebrow accent" style={{ marginBottom: 16 }}>
        Welcome back
      </div>
      <h1>Your next connection starts here.</h1>
      <p>Sign in with your email. We’ll send a secure link—no password needed.</p>
      {linkError && (
        <div className="notice error" role="alert" style={{ marginTop: 24 }}>
          <Icon name="info" />
          <div>That sign-in link expired or was already used. Request a new one below.</div>
        </div>
      )}
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="signin-email">Email address</label>
        <input
          id="signin-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={`signin-email-help${error ? " signin-email-error" : ""}`}
          onBlur={(e) => setFieldError(e.target.value && !EMAIL_PATTERN.test(e.target.value) ? EMAIL_ERROR : null)}
          onInput={() => fieldError && setFieldError(null)}
        />
        <small id="signin-email-help">Use the address associated with your alumni profile.</small>
        {error && (
          <span className="error-text" id="signin-email-error">
            {error}
          </span>
        )}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? (
            "Preparing your link…"
          ) : (
            <>
              Send sign-in link <Icon name="arrow" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
