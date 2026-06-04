import type { APIRoute } from "astro";
import { clearSessionCookie, jsonResponse } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async () => {
  return jsonResponse({ ok: true }, 200, {
    "Set-Cookie": clearSessionCookie(),
  });
};
