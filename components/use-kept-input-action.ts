"use client";

import { type FormEvent, useActionState, useTransition } from "react";

/**
 * Runs a server action from a form's submit event instead of its `action`
 * prop. React resets a form after an `action` prop runs, so whatever the
 * person typed would be lost when the action reports a problem; submitting
 * this way leaves the fields as they were. Use as `<form onSubmit={submit}>`.
 */
export function useKeptInputAction<S>(action: (prev: Awaited<S>, data: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, run] = useActionState<S, FormData>(action, initial);
  const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => run(data));
  };
  return [state, submit, pending] as const;
}
