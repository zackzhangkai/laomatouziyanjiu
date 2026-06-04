import { uploadFileToGitHub } from "./github";
import { statusToMarkdown } from "./twitter-markdown";
import {
  buildImportPreview,
  resolveStatus,
  type FxStatus,
} from "./twitter";

export async function uploadBlogImage(
  env: Env,
  bytes: Uint8Array,
  filename: string
): Promise<{ publicPath: string; githubPath: string }> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const githubPath = `public/images/blog/${safeName}`;
  await uploadFileToGitHub(env, {
    path: githubPath,
    content: bytes,
    message: `blog: upload image ${safeName}`,
  });
  return { publicPath: `/images/blog/${safeName}`, githubPath };
}

export async function convertStatusForImport(
  env: Env,
  status: FxStatus,
  slug: string
): Promise<{ body: string; imageCount: number }> {
  let imageCount = 0;
  const body = await statusToMarkdown(status, slug, async (bytes, filename) => {
    imageCount++;
    const uploaded = await uploadBlogImage(env, bytes, filename);
    return { publicPath: uploaded.publicPath };
  });
  return { body, imageCount };
}

export async function previewFromInput(
  input: string,
  existingSlugs: Set<string>
) {
  const status = await resolveStatus(input);
  return { status, preview: buildImportPreview(status, existingSlugs) };
}

export async function ensureFullStatus(status: FxStatus): Promise<FxStatus> {
  if (status.article?.content?.blocks?.length) return status;
  if (!status.article?.title) return status;
  return resolveStatus(status.id);
}
