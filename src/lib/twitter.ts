const FX_API = "https://api.fxtwitter.com";
const USER_AGENT = "laomatouziyanjiu-import/1.0";

export const TWITTER_HANDLE = "LMDFinance";
export const RESEARCH_HASHTAG = "老马行业研究";

export interface FxMediaPhoto {
  type: "photo";
  id: string;
  url: string;
  width?: number;
  height?: number;
}

export interface FxMediaVideo {
  type: "video";
  id: string;
  url: string;
  thumbnail_url?: string;
}

export interface FxStatus {
  type: "status";
  id: string;
  url: string;
  text: string;
  created_at: string;
  created_timestamp?: number;
  lang?: string | null;
  reposted_by?: unknown;
  replying_to?: { status: string } | null;
  article?: FxArticle | null;
  media?: {
    photos?: FxMediaPhoto[];
    videos?: FxMediaVideo[];
    all?: Array<FxMediaPhoto | FxMediaVideo>;
  };
}

export interface FxThread {
  type: "thread";
  conversation_id: string;
  statuses: FxStatus[];
}

export type FxTimelineItem = FxStatus | FxThread;

export interface FxArticle {
  id: string;
  title: string;
  preview_text?: string;
  created_at?: string;
  cover_media?: {
    media_info?: { original_img_url?: string };
  };
  content?: {
    blocks: FxArticleBlock[];
    entityMap: FxEntityMapInput;
  };
  media_entities?: FxArticleMediaEntity[];
}

interface FxArticleBlock {
  type: string;
  text: string;
  inlineStyleRanges?: Array<{ offset: number; length: number; style: string }>;
  entityRanges?: Array<{ offset: number; length: number; key: number }>;
  data?: {
    urls?: Array<{ text: string }>;
    mentions?: Array<{ text: string }>;
    hashtags?: Array<{ text: string }>;
  };
}

interface FxEntity {
  type: string;
  mutability?: string;
  data?: {
    url?: string;
    mediaItems?: Array<{ mediaId: string }>;
  };
}

interface FxArticleMediaVideoVariant {
  url?: string;
  content_type?: string;
  container?: string;
  bitrate?: number;
}

interface FxArticleMediaInfo {
  __typename?: string;
  original_img_url?: string;
  thumbnail_url?: string;
  video_info?: { variants?: FxArticleMediaVideoVariant[] };
  variants?: FxArticleMediaVideoVariant[];
}

export interface FxArticleMediaEntity {
  media_id: string;
  media_info?: FxArticleMediaInfo;
}

export type FxEntityMapInput =
  | Record<string, FxEntity>
  | Array<{ key: string | number; value: FxEntity }>;

export function normalizeEntityMap(
  raw: FxEntityMapInput | undefined | null
): Record<string, FxEntity> {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const map: Record<string, FxEntity> = {};
    for (const item of raw) {
      if (item && typeof item === "object" && "key" in item && "value" in item) {
        map[String(item.key)] = item.value;
      }
    }
    return map;
  }
  return raw;
}

export function resolveArticleMediaUrl(
  entity: FxArticleMediaEntity
): { kind: "image" | "video"; url: string; thumbnailUrl?: string } | null {
  const info = entity.media_info;
  if (!info) return null;

  if (info.original_img_url && !isVideoMediaInfo(info)) {
    return { kind: "image", url: info.original_img_url };
  }

  const variants = info.video_info?.variants ?? info.variants ?? [];
  const mp4Variants = variants
    .filter(
      (v) =>
        v.url &&
        (v.content_type?.includes("mp4") ||
          v.container === "mp4" ||
          v.url.includes(".mp4"))
    )
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (mp4Variants[0]?.url) {
    return {
      kind: "video",
      url: mp4Variants[0].url,
      thumbnailUrl: info.original_img_url ?? info.thumbnail_url,
    };
  }

  if (info.original_img_url) {
    return { kind: "image", url: info.original_img_url };
  }

  return null;
}

function isVideoMediaInfo(info: FxArticleMediaInfo): boolean {
  const typename = info.__typename ?? "";
  if (/video/i.test(typename)) return true;
  const variants = info.video_info?.variants ?? info.variants ?? [];
  return variants.some(
    (v) =>
      v.content_type?.includes("video") ||
      v.container === "mp4" ||
      (v.url?.includes(".mp4") ?? false)
  );
}

export interface ImportPreview {
  tweetId: string;
  sourceUrl: string;
  title: string;
  description: string;
  slug: string;
  pubDate: string;
  category: string;
  tags: string[];
  bodyPreview: string;
  imageCount: number;
  kind: "article" | "thread" | "tweet";
  alreadyImported?: boolean;
}

function fxHeaders(): HeadersInit {
  return { "User-Agent": USER_AGENT };
}

function parseStatusId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/status\/(\d+)/);
  return match?.[1] ?? null;
}

export function slugFromTitle(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  if (ascii && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ascii)) return ascii.slice(0, 80);
  return "";
}

export function tweetDate(status: FxStatus): string {
  if (status.created_timestamp) {
    return new Date(status.created_timestamp * 1000).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(status.created_at);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

export function isResearchContent(status: FxStatus): boolean {
  if (status.reposted_by) return false;
  if (status.replying_to && !status.article) return false;
  if (status.article?.title) return true;
  const text = status.text ?? "";
  if (text.includes(`#${RESEARCH_HASHTAG}`)) return true;
  if (text.includes("【#老马行业研究】")) return true;
  return false;
}

export function flattenTimeline(items: FxTimelineItem[]): FxStatus[] {
  const out: FxStatus[] = [];
  for (const item of items) {
    if (item.type === "thread") {
      const root = item.statuses.find((s) => !s.replying_to) ?? item.statuses[0];
      if (root) out.push({ ...root, media: mergeThreadMedia(item.statuses) });
    } else if (item.type === "status") {
      out.push(item);
    }
  }
  return out;
}

function mergeThreadMedia(statuses: FxStatus[]): FxStatus["media"] {
  const photos: FxMediaPhoto[] = [];
  for (const s of statuses) {
    for (const p of s.media?.photos ?? []) {
      if (!photos.some((x) => x.id === p.id)) photos.push(p);
    }
  }
  return photos.length ? { photos, all: photos } : undefined;
}

export async function fetchTimeline(
  handle = TWITTER_HANDLE,
  count = 50
): Promise<FxTimelineItem[]> {
  const url = `${FX_API}/2/profile/${handle}/statuses?count=${count}&groupthreads=1`;
  const res = await fetch(url, { headers: fxHeaders() });
  if (!res.ok) throw new Error(`获取 X 时间线失败 (${res.status})`);
  const data = (await res.json()) as { results?: FxTimelineItem[] };
  return data.results ?? [];
}

export async function fetchStatus(statusId: string): Promise<FxStatus> {
  const res = await fetch(`${FX_API}/2/status/${statusId}`, {
    headers: fxHeaders(),
  });
  if (!res.ok) throw new Error(`获取推文失败 (${res.status})`);
  const data = (await res.json()) as { tweet?: FxStatus; status?: FxStatus };
  const status = data.tweet ?? data.status;
  if (!status) throw new Error("推文不存在或无法解析");
  return status;
}

export async function resolveStatus(input: string): Promise<FxStatus> {
  const id = parseStatusId(input);
  if (!id) throw new Error("无效的 X 链接或推文 ID");
  return fetchStatus(id);
}

export function buildImportPreview(
  status: FxStatus,
  existingSlugs: Set<string> = new Set()
): ImportPreview | null {
  if (!isResearchContent(status) && !status.article?.title) {
    const hasPhotos = (status.media?.photos?.length ?? 0) > 0;
    const longText = (status.text?.length ?? 0) > 120;
    if (!hasPhotos || !longText) return null;
  }

  const sourceUrl = status.url ?? `https://x.com/${TWITTER_HANDLE}/status/${status.id}`;
  let title: string;
  let description: string;
  let kind: ImportPreview["kind"] = "tweet";

  if (status.article?.title) {
    title = status.article.title.trim();
    description = (status.article.preview_text ?? status.text ?? "").trim().slice(0, 200);
    kind = "article";
  } else {
    const lines = (status.text ?? "").split("\n").filter(Boolean);
    title = lines[0]?.replace(/#\S+/g, "").trim() || `X 帖子 ${status.id}`;
    description = (status.text ?? "").slice(0, 200);
    if ((status.text?.length ?? 0) > 280) kind = "thread";
  }

  let slug = slugFromTitle(title);
  if (!slug || existingSlugs.has(slug)) {
    slug = `x-${status.id}`;
  }

  const tags = extractHashtags(status);
  const imageCount =
    (status.media?.photos?.length ?? 0) +
    (status.article?.media_entities?.length ?? 0) +
    (status.article?.cover_media?.media_info?.original_img_url ? 1 : 0);

  return {
    tweetId: status.id,
    sourceUrl,
    title,
    description,
    slug,
    pubDate: tweetDate(status),
    category: tags.includes(RESEARCH_HASHTAG) ? "行业研究" : "投研",
    tags,
    bodyPreview: (status.article?.preview_text ?? status.text ?? "").slice(0, 300),
    imageCount,
    kind,
    alreadyImported: existingSlugs.has(slug),
  };
}

function extractHashtags(status: FxStatus): string[] {
  const tags = new Set<string>();
  const text = `${status.text ?? ""} ${status.article?.title ?? ""}`;
  for (const match of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    tags.add(match[1]);
  }
  return [...tags].slice(0, 8);
}

export async function downloadImage(url: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const res = await fetch(url, { headers: fxHeaders() });
  if (!res.ok) throw new Error(`下载图片失败 (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "";
  let ext = "jpg";
  if (contentType.includes("png")) ext = "png";
  else if (contentType.includes("webp")) ext = "webp";
  else if (contentType.includes("gif")) ext = "gif";
  else {
    const pathExt = url.split("?")[0].split(".").pop()?.toLowerCase();
    if (pathExt && ["jpg", "jpeg", "png", "webp", "gif"].includes(pathExt)) {
      ext = pathExt === "jpeg" ? "jpg" : pathExt;
    }
  }
  return { bytes, ext };
}
