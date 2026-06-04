import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireAdmin,
} from "../../lib/auth";
import { uploadBlogImage } from "../../lib/twitter-import";

export const prerender = false;

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function extFromType(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "jpg";
}

export const POST: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    requireAdmin(await getSession(context));

    const contentType = context.request.headers.get("content-type") ?? "";
    let bytes: Uint8Array;
    let filename: string;

    if (contentType.includes("application/json")) {
      const body = (await context.request.json()) as {
        data?: string;
        filename?: string;
        mimeType?: string;
      };
      if (!body.data?.startsWith("data:")) {
        return jsonResponse({ error: "无效的图片数据" }, 400);
      }
      const match = body.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return jsonResponse({ error: "无效的图片数据" }, 400);
      const mime = match[1];
      if (!ALLOWED.has(mime)) {
        return jsonResponse({ error: "仅支持 JPG、PNG、WebP、GIF" }, 400);
      }
      const raw = atob(match[2]);
      bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const ext = extFromType(mime);
      filename = body.filename?.trim() || `paste-${Date.now()}.${ext}`;
      if (!filename.includes(".")) filename += `.${ext}`;
    } else {
      const form = await context.request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonResponse({ error: "请上传图片文件" }, 400);
      }
      if (!ALLOWED.has(file.type)) {
        return jsonResponse({ error: "仅支持 JPG、PNG、WebP、GIF" }, 400);
      }
      if (file.size > MAX_SIZE) {
        return jsonResponse({ error: "图片不能超过 5MB" }, 400);
      }
      bytes = new Uint8Array(await file.arrayBuffer());
      const ext = extFromType(file.type);
      filename = file.name?.trim() || `paste-${Date.now()}.${ext}`;
      if (!filename.includes(".")) filename += `.${ext}`;
    }

    if (bytes.length > MAX_SIZE) {
      return jsonResponse({ error: "图片不能超过 5MB" }, 400);
    }

    const uploaded = await uploadBlogImage(env, bytes, filename);
    return jsonResponse({
      ok: true,
      url: uploaded.publicPath,
      markdown: `![](${uploaded.publicPath})`,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: "图片上传失败，请稍后再试" }, 500);
  }
};
