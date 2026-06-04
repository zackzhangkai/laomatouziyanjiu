import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import {
  createToken,
  jsonResponse,
  sessionCookie,
  verifyPassword,
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

    if (!username || !password) {
      return jsonResponse({ error: "请输入用户名和密码" }, 400);
    }

    const row = await env.DB.prepare(
      `SELECT id, username, password_hash, role FROM users WHERE username = ?`
    )
      .bind(username)
      .first<{
        id: number;
        username: string;
        password_hash: string;
        role: "admin" | "user";
      }>();

    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return jsonResponse({ error: "用户名或密码错误" }, 401);
    }

    const user: SessionUser = {
      id: row.id,
      username: row.username,
      role: row.role,
    };

    const token = await createToken(user, env.JWT_SECRET);

    return jsonResponse(
      { ok: true, user: { id: user.id, username: user.username, role: user.role } },
      200,
      { "Set-Cookie": sessionCookie(token) }
    );
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};
