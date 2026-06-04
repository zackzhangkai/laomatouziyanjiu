/// <reference path="../.astro/types.d.ts" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    user?: SessionUser | null;
    member?: MemberSession | null;
  }
}

interface MemberSession {
  codeId: number;
  contactId: string;
  expiresAt: string;
}

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  /** Secret for cron / external sync triggers (Authorization: Bearer …) */
  CRON_SECRET?: string;
  /** Set to "1" or "true" to disable automatic hourly X sync */
  TWITTER_SYNC_DISABLED?: string;
}

interface SessionUser {
  id: number;
  username: string;
  role: "admin" | "user";
}
