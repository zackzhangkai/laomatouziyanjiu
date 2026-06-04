import type { APIRoute } from "astro";
import { getAdminStats } from "../../../lib/analytics";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireAdmin,
} from "../../../lib/auth";
import { getEnv } from "../../../lib/env";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  try {
    requireAdmin(await getSession(context));
    const env = getEnv(context);
    const stats = await getAdminStats(env.DB);
    return jsonResponse({ stats });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};
