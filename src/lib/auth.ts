import type { APIContext } from "astro";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "./env";

const COOKIE_NAME = "session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(
  user: SessionUser,
  jwtSecret: string
): Promise<string> {
  return new SignJWT({
    sub: String(user.id),
    username: user.username,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey(jwtSecret));
}

export async function verifyToken(
  token: string,
  jwtSecret: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(jwtSecret));
    const id = Number(payload.sub);
    if (!id || !payload.username || !payload.role) return null;
    return {
      id,
      username: String(payload.username),
      role: payload.role as "admin" | "user",
    };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  const secure = import.meta.env.PROD ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getTokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export async function getSession(
  context: APIContext
): Promise<SessionUser | null> {
  const env = getEnv(context);
  const token = getTokenFromRequest(context.request);
  if (!token || !env.JWT_SECRET) return null;
  return verifyToken(token, env.JWT_SECRET);
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw new AuthError("请先登录", 401);
  return user;
}

export function requireAdmin(user: SessionUser | null): SessionUser {
  const u = requireUser(user);
  if (u.role !== "admin") throw new AuthError("您没有发布文章的权限", 403);
  return u;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}
