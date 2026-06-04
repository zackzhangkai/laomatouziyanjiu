import type { APIContext } from "astro";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "./env";
import { getMemberContact } from "./member-contacts";

export const MEMBER_COOKIE = "member_session";
export const MEMBER_DURATION_DAYS = 30;

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export interface MemberSession {
  codeId: number;
  contactId: string;
  expiresAt: string;
}

export function generateMemberCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segment = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `LMD-${segment()}-${segment()}`;
}

export function memberAccessExpiresAt(from = new Date()): string {
  const expires = new Date(from);
  expires.setDate(expires.getDate() + MEMBER_DURATION_DAYS);
  return expires.toISOString();
}

export async function createMemberToken(
  session: MemberSession,
  jwtSecret: string
): Promise<string> {
  const expiresAt = Math.floor(new Date(session.expiresAt).getTime() / 1000);
  return new SignJWT({
    codeId: session.codeId,
    contactId: session.contactId,
    expiresAt: session.expiresAt,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secretKey(jwtSecret));
}

export async function verifyMemberToken(
  token: string,
  jwtSecret: string
): Promise<MemberSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(jwtSecret));
    const codeId = Number(payload.codeId);
    const contactId = String(payload.contactId ?? "");
    const expiresAt = String(payload.expiresAt ?? "");
    if (!codeId || !contactId || !expiresAt) return null;
    if (new Date(expiresAt) <= new Date()) return null;
    return { codeId, contactId, expiresAt };
  } catch {
    return null;
  }
}

export function getMemberTokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${MEMBER_COOKIE}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function memberSessionCookie(token: string, expiresAt: string): string {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
  );
  const secure = import.meta.env.PROD ? "; Secure" : "";
  return `${MEMBER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearMemberSessionCookie(): string {
  return `${MEMBER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getMemberSession(
  context: APIContext
): Promise<MemberSession | null> {
  const env = getEnv(context);
  const token = getMemberTokenFromRequest(context.request);
  if (!token || !env.JWT_SECRET) return null;
  return verifyMemberToken(token, env.JWT_SECRET);
}

export async function validateMemberAccess(
  context: APIContext,
  session: MemberSession
): Promise<MemberSession | null> {
  const env = getEnv(context);
  const row = await env.DB.prepare(
    `SELECT id, contact_id, access_expires_at, redeemed_at
     FROM member_codes
     WHERE id = ?`
  )
    .bind(session.codeId)
    .first<{
      id: number;
      contact_id: string;
      access_expires_at: string | null;
      redeemed_at: string | null;
    }>();

  if (!row?.redeemed_at || !row.access_expires_at) return null;
  if (row.contact_id !== session.contactId) return null;
  if (new Date(row.access_expires_at) <= new Date()) return null;

  const contact = await getMemberContact(env.DB, row.contact_id);
  if (!contact) return null;

  return {
    codeId: row.id,
    contactId: row.contact_id,
    expiresAt: row.access_expires_at,
  };
}
