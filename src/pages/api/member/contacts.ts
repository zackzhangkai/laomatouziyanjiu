import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireAdmin,
} from "../../../lib/auth";
import {
  countMemberCodesForContact,
  createMemberContact,
  deleteMemberContact,
  listMemberContacts,
  updateMemberContact,
  validateContactInput,
} from "../../../lib/member-contacts";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    requireAdmin(await getSession(context));
    const contacts = await listMemberContacts(env.DB);
    const contactsWithUsage = await Promise.all(
      contacts.map(async (contact) => ({
        ...contact,
        codeCount: await countMemberCodesForContact(env.DB, contact.id),
      }))
    );
    return jsonResponse({ contacts: contactsWithUsage });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    requireAdmin(await getSession(context));

    const body = (await context.request.json()) as Record<string, unknown>;
    const contact = await createMemberContact(env.DB, {
      id: String(body.id ?? ""),
      name: String(body.name ?? ""),
      role: String(body.role ?? ""),
      description: String(body.description ?? ""),
      telegramHandle: String(body.telegramHandle ?? ""),
      telegramHref: String(body.telegramHref ?? ""),
      twitterHandle: body.twitterHandle ? String(body.twitterHandle) : undefined,
      twitterHref: body.twitterHref ? String(body.twitterHref) : undefined,
      sortOrder: Number(body.sortOrder ?? 0),
    });

    return jsonResponse({ ok: true, contact }, 201);
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    if (e instanceof Error) {
      return jsonResponse({ error: e.message }, 400);
    }
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};

export const PUT: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    requireAdmin(await getSession(context));

    const body = (await context.request.json()) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) {
      return jsonResponse({ error: "缺少联系人标识" }, 400);
    }

    const contact = await updateMemberContact(env.DB, id, {
      name: String(body.name ?? ""),
      role: String(body.role ?? ""),
      description: String(body.description ?? ""),
      telegramHandle: String(body.telegramHandle ?? ""),
      telegramHref: String(body.telegramHref ?? ""),
      twitterHandle: body.twitterHandle ? String(body.twitterHandle) : undefined,
      twitterHref: body.twitterHref ? String(body.twitterHref) : undefined,
      sortOrder: Number(body.sortOrder ?? 0),
    });

    return jsonResponse({ ok: true, contact });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    if (e instanceof Error) {
      return jsonResponse({ error: e.message }, 400);
    }
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};

export const DELETE: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    requireAdmin(await getSession(context));

    const url = new URL(context.request.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) {
      return jsonResponse({ error: "缺少联系人标识" }, 400);
    }

    await deleteMemberContact(env.DB, id);
    return jsonResponse({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    if (e instanceof Error) {
      return jsonResponse({ error: e.message }, 400);
    }
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};
