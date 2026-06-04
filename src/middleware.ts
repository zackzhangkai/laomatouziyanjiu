import { defineMiddleware } from "astro:middleware";
import { getEnv } from "./lib/env";
import { getTokenFromRequest, verifyToken } from "./lib/auth";
import {
  getMemberTokenFromRequest,
  validateMemberAccess,
  verifyMemberToken,
} from "./lib/member";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.member = null;
  try {
    const cookieHeader = context.request.headers?.get?.("cookie");
    if (cookieHeader) {
      const env = getEnv(context);
      const token = getTokenFromRequest(context.request);
      if (token && env.JWT_SECRET) {
        context.locals.user = (await verifyToken(token, env.JWT_SECRET)) ?? null;
      }

      const memberToken = getMemberTokenFromRequest(context.request);
      if (memberToken && env.JWT_SECRET) {
        const session = await verifyMemberToken(memberToken, env.JWT_SECRET);
        if (session) {
          context.locals.member =
            (await validateMemberAccess(context, session)) ?? null;
        }
      }
    }
  } catch {
    // 预渲染页面无 request headers，登录态由客户端 /api/auth/me 同步
  }

  return next();
});
