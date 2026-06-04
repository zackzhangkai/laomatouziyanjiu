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

export const GET: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    if (!env.JWT_SECRET) {
      return jsonResponse({ member: null });
    }

    const session = await getMemberSession(context);
    if (!session) {
      return jsonResponse({ member: null });
    }

    const valid = await validateMemberAccess(context, session);
    if (!valid) {
      return jsonResponse({ member: null });
    }

    const contact = await getMemberContact(env.DB, valid.contactId);
    if (!contact) {
      return jsonResponse({ member: null });
    }

    return jsonResponse({
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
  } catch (e) {
    console.error(e);
    return jsonResponse({ member: null });
  }
};
