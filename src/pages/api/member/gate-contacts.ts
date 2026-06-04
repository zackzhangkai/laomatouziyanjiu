import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { jsonResponse } from "../../../lib/auth";
import { listMemberContacts } from "../../../lib/member-contacts";

export const prerender = false;

/** 未激活会员时展示的联系入口（公开接口，仅返回管理员配置的对接信息） */
export const GET: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    const contacts = await listMemberContacts(env.DB);
    return jsonResponse({ contacts });
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};
