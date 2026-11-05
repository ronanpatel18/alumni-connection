import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const email = vi.hoisted(() => ({ canSendEmail: vi.fn(() => true), sendEmail: vi.fn(async () => true) }));
const db = vi.hoisted(() => ({
  claimed: [] as Record<string, unknown>[],
  members: [] as { user_id: string; email: string | null }[],
  updates: [] as { id: unknown; values: Record<string, unknown> }[],
  rpc: vi.fn(),
}));

vi.mock("@/lib/email", () => email);
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_SITE_URL: "https://example.test" } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: db.rpc,
    from: (table: string) =>
      table === "members"
        ? { select: () => ({ in: async () => ({ data: db.members }) }) }
        : { update: (values: Record<string, unknown>) => ({ eq: async (_: string, id: unknown) => void db.updates.push({ id, values }) }) },
  }),
}));

const { afterFailure, deliverNotifications, drainNotifications } = await import("@/lib/notifications");

const notice = (over: Record<string, unknown> = {}) => ({ id: 1, user_id: "u1", kind: "message", title: "A notice", link: "/messages/1", attempts: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  email.canSendEmail.mockReturnValue(true);
  email.sendEmail.mockResolvedValue(true);
  db.claimed = [notice()];
  db.members = [{ user_id: "u1", email: "member@example.com" }];
  db.updates = [];
  db.rpc.mockImplementation(async () => ({ data: db.claimed, error: null }));
});

describe("afterFailure", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const minutesLater = (attempts: number) => (new Date(afterFailure(attempts, now).next_attempt_at!).getTime() - now.getTime()) / 60_000;

  it("backs off further after each attempt", () => {
    expect([1, 2, 3, 4].map(minutesLater)).toEqual([5, 30, 120, 720]);
  });

  it("gives up after the fifth attempt", () => {
    expect(afterFailure(5, now)).toEqual({ failed_at: now.toISOString(), claimed_until: null });
  });
});

describe("deliverNotifications", () => {
  it("sends with a stable idempotency key and records the send", async () => {
    expect(await deliverNotifications()).toEqual({ claimed: 1, sent: 1 });
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "member@example.com", subject: "A notice", idempotencyKey: "notification/1" }));
    expect(db.updates).toEqual([{ id: 1, values: { emailed_at: expect.any(String), claimed_until: null } }]);
  });

  it("schedules a retry when a send fails, and carries on with the rest", async () => {
    db.claimed = [notice(), notice({ id: 2 })];
    email.sendEmail.mockResolvedValueOnce(false);
    expect(await deliverNotifications()).toEqual({ claimed: 2, sent: 1 });
    expect(db.updates[0]).toEqual({ id: 1, values: { next_attempt_at: expect.any(String), claimed_until: null } });
    expect(db.updates[1].values).toHaveProperty("emailed_at");
  });

  it("marks a notice with no address as failed, not sent", async () => {
    db.members = [];
    expect(await deliverNotifications()).toEqual({ claimed: 1, sent: 0 });
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(db.updates[0].values).toHaveProperty("failed_at");
    expect(db.updates[0].values).not.toHaveProperty("emailed_at");
  });

  it("claims nothing while no email transport is configured, so no attempts are spent", async () => {
    email.canSendEmail.mockReturnValue(false);
    expect(await deliverNotifications()).toEqual({ claimed: 0, sent: 0 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("leaves out the reply footer on an approval notice", async () => {
    db.claimed = [notice({ kind: "claim_approved", link: "/welcome" })];
    await deliverNotifications();
    const [{ text }] = email.sendEmail.mock.calls[0] as unknown as [{ text: string }];
    expect(text).toContain("https://example.test/welcome");
    expect(text).not.toContain("Replies happen");
  });
});

describe("drainNotifications", () => {
  it("keeps going while batches come back full, then stops", async () => {
    const full = Array.from({ length: 25 }, (_, i) => notice({ id: i + 1 }));
    db.rpc.mockResolvedValueOnce({ data: full, error: null }).mockResolvedValueOnce({ data: [notice({ id: 26 })], error: null });
    expect(await drainNotifications()).toEqual({ claimed: 26, sent: 26 });
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it("stops at its limit so one run can't outlast a function timeout", async () => {
    const full = Array.from({ length: 25 }, (_, i) => notice({ id: i + 1 }));
    db.rpc.mockResolvedValue({ data: full, error: null });
    await drainNotifications();
    expect(db.rpc).toHaveBeenCalledTimes(8);
  });
});
