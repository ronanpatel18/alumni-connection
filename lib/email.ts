import "server-only";

// Sends notification emails. Two transports, both plain HTTPS (no SMTP library):
//   - Resend (production): set RESEND_API_KEY and EMAIL_FROM (free tier available).
//   - Mailpit (local development): Supabase's local inbox at http://127.0.0.1:54324,
//     used automatically when Supabase is local and Resend isn't configured.
// With neither, emails are skipped (and say so in the server log).

export interface Email {
  to: string;
  subject: string;
  text: string;
}

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const FROM = process.env.EMAIL_FROM ?? "Alumni Connect <notifications@alumni-connect.local>";

function transport(): "resend" | "mailpit" | null {
  if (process.env.RESEND_API_KEY) return "resend";
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) return "mailpit";
  return null;
}

export async function sendEmail(email: Email): Promise<boolean> {
  const via = transport();
  if (!via) {
    console.warn("[email] no transport configured (set RESEND_API_KEY); skipped:", email.subject);
    return false;
  }
  try {
    if (via === "resend") {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [email.to], subject: email.subject, text: email.text }),
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    }
    const match = FROM.match(/^(.*)<(.+)>$/);
    const response = await fetch(`${MAILPIT_URL}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: match ? match[2].trim() : FROM, Name: match ? match[1].trim() : "Alumni Connect" },
        To: [{ Email: email.to }],
        Subject: email.subject,
        Text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch (error) {
    console.warn("[email] send failed:", (error as Error).message);
    return false;
  }
}
