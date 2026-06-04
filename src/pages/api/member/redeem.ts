import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { jsonResponse } from "../../../lib/auth";
import {
  createMemberToken,
  getMemberSession,
  memberAccessExpiresAt,
  memberSessionCookie,
  validateMemberAccess,
} from "../../../lib/member";
import { getMemberContact } from "../../../lib/member-contacts";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    if (!env.JWT_SECRET) {
      return jsonResponse({ error: "服务暂不可用，请稍后再试" }, 500);
    }

    const body = (await context.request.json()) as { code?: string };
    const code = body.code?.trim().toUpperCase();
    if (!code) {
      return jsonResponse({ error: "请输入会员码" }, 400);
    }

    const row = await env.DB.prepare(
      `SELECT id, contact_id, redeemed_at, access_expires_at
       FROM member_codes
       WHERE code = ?`
    )
      .bind(code)
      .first<{
        id: number;
        contact_id: string;
        redeemed_at: string | null;
        access_expires_at: string | null;
      }>();

    if (!row) {
      return jsonResponse({ error: "会员码无效，请核对后重试" }, 404);
    }

    const contact = await getMemberContact(env.DB, row.contact_id);
    if (!contact) {
      return jsonResponse({ error: "会员码配置异常，请联系管理员" }, 500);
    }

    const existing = await getMemberSession(context);
    if (existing?.codeId === row.id) {
      const valid = await validateMemberAccess(context, existing);
      if (valid) {
        return jsonResponse({
          ok: true,
          member: {
            expiresAt: valid.expiresAt,
            contact: {
              id: contact.id,
              name: contact.name,
              role: contact.role,
              description: contact.description,
              telegram: contact.telegram,
              twitter: contact.twitter ?? null,
            },
          },
        });
      }
    }

    if (row.redeemed_at) {
      return jsonResponse({ error: "该会员码已被使用" }, 409);
    }

    const expiresAt = memberAccessExpiresAt();
    const redeemedAt = new Date().toISOString();

    await env.DB.prepare(
      `UPDATE member_codes
       SET redeemed_at = ?, access_expires_at = ?
       WHERE id = ? AND redeemed_at IS NULL`
    )
      .bind(redeemedAt, expiresAt, row.id)
      .run();

    const session = {
      codeId: row.id,
      contactId: row.contact_id,
      expiresAt,
    };

    const token = await createMemberToken(session, env.JWT_SECRET);

    return jsonResponse(
      {
        ok: true,
        member: {
          expiresAt,
          contact: {
            id: contact.id,
            name: contact.name,
            role: contact.role,
            description: contact.description,
            telegram: contact.telegram,
            twitter: contact.twitter ?? null,
          },
        },
      },
      200,
      { "Set-Cookie": memberSessionCookie(token, expiresAt) }
    );
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};
