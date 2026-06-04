import type { APIRoute } from "astro";
import { getSession, jsonResponse } from "../../../lib/auth";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = await getSession(context);
  if (!user) {
    return jsonResponse({ user: null }, 200);
  }
  return jsonResponse({
    user: { id: user.id, username: user.username, role: user.role },
  });
};
