const STEPS = ["Plan your visit", "Choose people", "Start a conversation"];

/** Trip progress from the design: destination → people → one conversation at a time. */
export function TripSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="steps" aria-label="Trip planning progress">
      {STEPS.map((label, i) => (
        <li key={label} className={`step${i === current ? " active" : ""}`} aria-current={i === current ? "step" : undefined}>
          <b>{i + 1}</b>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
