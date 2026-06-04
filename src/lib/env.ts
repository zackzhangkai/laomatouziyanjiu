import type { APIContext } from "astro";

export function getEnv(context: APIContext | { locals: App.Locals }) {
  const runtime = context.locals.runtime;
  if (!runtime?.env) {
    throw new Error("Cloudflare runtime 未就绪，请使用 astro dev 或 wrangler 运行");
  }
  return runtime.env as Env;
}
