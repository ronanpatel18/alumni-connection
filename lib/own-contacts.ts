/** Which of their own email and phone a member with a claimed profile hasn't added yet. */
export function missingOwnContacts(points: { kind: string; source: string }[]): ("email" | "phone")[] {
  const own = new Set(points.filter((p) => p.source === "self").map((p) => p.kind));
  return (["email", "phone"] as const).filter((kind) => !own.has(kind));
}
