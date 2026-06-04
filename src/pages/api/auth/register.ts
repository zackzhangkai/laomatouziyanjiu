import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import {
  AuthError,
  hashPassword,
  jsonResponse,
  createToken,
  sessionCookie,
} from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    if (!env.JWT_SECRET) {
      return jsonResponse({ error: "服务暂不可用，请稍后再试" }, 500);
    }

    const body = (await context.request.json()) as {
      username?: string;
      password?: string;
    };

    const username = body.username?.trim();
    const password = body.password;

    if (!username || username.length < 2) {
      return jsonResponse({ error: "用户名至少 2 个字符" }, 400);
    }
    if (!password || password.length < 6) {
      return jsonResponse({ error: "密码至少 6 个字符" }, 400);
    }

    const existing = await env.DB.prepare(
      `SELECT id FROM users WHERE username = ?`
    )
      .bind(username)
      .first<{ id: number }>();

    if (existing) {
      return jsonResponse({ error: "用户名已被占用，请更换用户名或直接登录" }, 409);
    }

    const password_hash = await hashPassword(password);

    const result = await env.DB.prepare(
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')`
    )
      .bind(username, password_hash)
      .run();

    if (!result.success) {
      return jsonResponse({ error: "注册失败，用户名可能已存在" }, 409);
    }

    const row = await env.DB.prepare(
      `SELECT id, username, role FROM users WHERE username = ?`
    )
      .bind(username)
      .first<{ id: number; username: string; role: "admin" | "user" }>();

    if (!row) {
      return jsonResponse({ error: "用户创建失败" }, 500);
    }

    const user: SessionUser = {
      id: row.id,
      username: row.username,
      role: row.role,
    };

    const token = await createToken(user, env.JWT_SECRET);

    return jsonResponse(
      { ok: true, user: { id: user.id, username: user.username, role: user.role } },
      201,
      { "Set-Cookie": sessionCookie(token) }
    );
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    if (e instanceof Error && /unique|constraint|duplicate/i.test(e.message)) {
      return jsonResponse({ error: "用户名已被占用，请更换用户名或直接登录" }, 409);
    }
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};
