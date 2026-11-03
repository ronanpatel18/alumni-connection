/**
 * Input validation and sanitization (adapted from conference-connection's
 * lib/validation.ts): Zod schemas with sanitizing transforms, strict request
 * bodies and JSON responses with security headers.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

export const MAX_LENGTHS = {
  name: 100,
  email: 254, // RFC 5321
  headline: 200,
  bio: 2000,
  searchText: 200,
  note: 5000,
  genericText: 1000,
} as const;

/** Trims, strips null bytes and control characters, and NFC-normalizes. */
export function sanitizeString(input: string): string {
  if (typeof input !== "string") return "";
  return input
    .trim()
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .normalize("NFC");
}

export const emailSchema = z
  .email("Enter a valid email address")
  .max(MAX_LENGTHS.email)
  .transform((value) => sanitizeString(value).toLowerCase());

export const nameSchema = z.string().min(1, "Name is required").max(MAX_LENGTHS.name).transform(sanitizeString);

export const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform(sanitizeString)
    .transform((value) => (value.length ? value : null))
    .nullish();

export const uuidSchema = z.uuid();

/** Validates a JSON request body. Returns [data, null] or [null, errorResponse]. */
export async function validateBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<[z.infer<T>, null] | [null, NextResponse]> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return [null, secureJsonResponse({ success: false, error: "Content-Type must be application/json" }, { status: 415 })];
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return [null, secureJsonResponse({ success: false, error: "Invalid JSON in request body" }, { status: 400 })];
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
    return [null, secureJsonResponse({ success: false, error: "Validation failed", details }, { status: 400 })];
  }
  return [result.data, null];
}

export function securityHeaders(): Headers {
  const headers = new Headers();
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Cache-Control", "no-store, max-age=0");
  return headers;
}

export function secureJsonResponse(data: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(data, init);
  securityHeaders().forEach((value, key) => response.headers.set(key, value));
  return response;
}
