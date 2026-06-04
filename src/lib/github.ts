interface PublishArticleInput {
  slug: string;
  title: string;
  description: string;
  body: string;
  pubDate?: string;
  category?: string;
  source?: string;
  tags?: string[];
}

interface UploadFileInput {
  path: string;
  content: ArrayBuffer | Uint8Array;
  message: string;
}

export async function uploadFileToGitHub(
  env: Env,
  input: UploadFileInput
): Promise<{ path: string; url: string }> {
  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH ?? "main";

  if (!token || !owner || !repo) {
    throw new Error(
      "未配置 GitHub：请在环境变量中设置 GITHUB_TOKEN、GITHUB_OWNER、GITHUB_REPO"
    );
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${input.path}`;
  const bytes =
    input.content instanceof Uint8Array
      ? input.content
      : new Uint8Array(input.content);
  const encoded = uint8ToBase64(bytes);

  const existing = await fetch(`${apiUrl}?ref=${branch}`, {
    headers: githubHeaders(token),
  });

  let sha: string | undefined;
  if (existing.ok) {
    const data = (await existing.json()) as { sha: string };
    sha = data.sha;
  }

  const res = await fetch(apiUrl, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify({
      message: input.message,
      content: encoded,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API 失败 (${res.status}): ${err}`);
  }

  const result = (await res.json()) as { content: { html_url: string } };
  return { path: input.path, url: result.content.html_url };
}

export async function publishArticleToGitHub(
  env: Env,
  input: PublishArticleInput
): Promise<{ path: string; url: string }> {
  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH ?? "main";

  if (!token || !owner || !repo) {
    throw new Error(
      "未配置 GitHub：请在环境变量中设置 GITHUB_TOKEN、GITHUB_OWNER、GITHUB_REPO"
    );
  }

  const path = `src/content/blog/${input.slug}.md`;
  const date = input.pubDate ?? new Date().toISOString().slice(0, 10);
  const frontmatter: string[] = [
    `title: ${JSON.stringify(input.title)}`,
    `description: ${JSON.stringify(input.description)}`,
    `pubDate: ${JSON.stringify(date)}`,
  ];
  if (input.category) {
    frontmatter.push(`category: ${JSON.stringify(input.category)}`);
  }
  if (input.source) {
    frontmatter.push(`source: ${JSON.stringify(input.source)}`);
  }
  if (input.tags?.length) {
    frontmatter.push("tags:");
    for (const tag of input.tags) {
      frontmatter.push(`  - ${JSON.stringify(tag)}`);
    }
  }

  const content = `---
${frontmatter.join("\n")}
---

${input.body}
`;

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const encoded = btoa(unescape(encodeURIComponent(content)));

  const existing = await fetch(`${apiUrl}?ref=${branch}`, {
    headers: githubHeaders(token),
  });

  let sha: string | undefined;
  if (existing.ok) {
    const data = (await existing.json()) as { sha: string };
    sha = data.sha;
  }

  const res = await fetch(apiUrl, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify({
      message: `blog: publish ${input.slug}`,
      content: encoded,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API 失败 (${res.status}): ${err}`);
  }

  const result = (await res.json()) as { content: { html_url: string } };
  return { path, url: result.content.html_url };
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "laomatouziyanjiu-blog",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
