import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireAdmin,
} from "../../../lib/auth";
import { generateMemberCode } from "../../../lib/member";
import { getMemberContact, listMemberContacts } from "../../../lib/member-contacts";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    const user = requireAdmin(await getSession(context));

    const { results } = await env.DB.prepare(
      `SELECT id, code, contact_id, note, created_at, redeemed_at, access_expires_at
       FROM member_codes
       ORDER BY created_at DESC
       LIMIT 100`
    ).all<{
      id: number;
      code: string;
      contact_id: string;
      note: string | null;
      created_at: string;
      redeemed_at: string | null;
      access_expires_at: string | null;
    }>();

    const contactsList = await listMemberContacts(env.DB);
    const contacts = Object.fromEntries(
      contactsList.map((c) => [c.id, { id: c.id, name: c.name, role: c.role }])
    );

    return jsonResponse({
      contacts,
      contactOptions: contactsList.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
      })),
      codes: (results ?? []).map((row) => ({
        ...row,
        contact: contacts[row.contact_id] ?? null,
        status: row.redeemed_at
          ? new Date(row.access_expires_at ?? 0) > new Date()
            ? "active"
            : "expired"
          : "unused",
      })),
    });
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
    const user = requireAdmin(await getSession(context));

    const body = (await context.request.json()) as {
      contactId?: string;
      note?: string;
    };

    const contactId = body.contactId?.trim();
    if (!contactId || !(await getMemberContact(env.DB, contactId))) {
      return jsonResponse({ error: "请选择有效的对接联系人" }, 400);
    }

    const note = body.note?.trim() || null;
    let code = generateMemberCode();
    let attempts = 0;

    while (attempts < 5) {
      const existing = await env.DB.prepare(`SELECT id FROM member_codes WHERE code = ?`)
        .bind(code)
        .first();
      if (!existing) break;
      code = generateMemberCode();
      attempts++;
    }

    const result = await env.DB.prepare(
      `INSERT INTO member_codes (code, contact_id, created_by, note)
       VALUES (?, ?, ?, ?)`
    )
      .bind(code, contactId, user.id, note)
      .run();

    if (!result.success) {
      return jsonResponse({ error: "生成会员码失败，请重试" }, 500);
    }

    const row = await env.DB.prepare(
      `SELECT id, code, contact_id, note, created_at
       FROM member_codes
       WHERE code = ?`
    )
      .bind(code)
      .first<{
        id: number;
        code: string;
        contact_id: string;
        note: string | null;
        created_at: string;
      }>();

    if (!row) {
      return jsonResponse({ error: "会员码创建失败" }, 500);
    }

    const contact = (await getMemberContact(env.DB, contactId))!;

    return jsonResponse({
      ok: true,
      code: row,
      contact: { id: contact.id, name: contact.name, role: contact.role },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};
