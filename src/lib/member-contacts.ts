export interface MemberContact {
  id: string;
  name: string;
  role: string;
  description: string;
  telegram: { handle: string; href: string };
  twitter?: { handle: string; href: string };
}

interface MemberContactRow {
  id: string;
  name: string;
  role: string;
  description: string;
  telegram_handle: string;
  telegram_href: string;
  twitter_handle: string | null;
  twitter_href: string | null;
  sort_order: number;
}

export interface MemberContactInput {
  id?: string;
  name: string;
  role: string;
  description?: string;
  telegramHandle: string;
  telegramHref: string;
  twitterHandle?: string;
  twitterHref?: string;
  sortOrder?: number;
}

const SLUG_RE = /^[a-z0-9-]+$/;

function rowToContact(row: MemberContactRow): MemberContact {
  const contact: MemberContact = {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description,
    telegram: { handle: row.telegram_handle, href: row.telegram_href },
  };
  if (row.twitter_handle && row.twitter_href) {
    contact.twitter = { handle: row.twitter_handle, href: row.twitter_href };
  }
  return contact;
}

function normalizeHref(href: string): string {
  const trimmed = href.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("链接必须以 http:// 或 https:// 开头");
  }
  return trimmed;
}

export function validateContactInput(
  input: MemberContactInput,
  { requireId = false }: { requireId?: boolean } = {}
): MemberContactInput {
  const id = input.id?.trim().toLowerCase();
  const name = input.name?.trim();
  const role = input.role?.trim();
  const description = input.description?.trim() ?? "";
  const telegramHandle = input.telegramHandle?.trim();
  const telegramHref = normalizeHref(input.telegramHref ?? "");
  const twitterHandle = input.twitterHandle?.trim() || undefined;
  const twitterHrefRaw = input.twitterHref?.trim();
  const twitterHref = twitterHrefRaw ? normalizeHref(twitterHrefRaw) : undefined;

  if (requireId && (!id || !SLUG_RE.test(id))) {
    throw new Error("标识只能包含小写字母、数字和连字符");
  }
  if (id && !SLUG_RE.test(id)) {
    throw new Error("标识只能包含小写字母、数字和连字符");
  }
  if (!name) throw new Error("请填写姓名");
  if (!role) throw new Error("请填写角色");
  if (!telegramHandle) throw new Error("请填写 Telegram 显示名");
  if (!telegramHref) throw new Error("请填写 Telegram 私信链接");

  if ((twitterHandle && !twitterHref) || (!twitterHandle && twitterHref)) {
    throw new Error("X 显示名和链接需同时填写，或都留空");
  }

  return {
    id,
    name,
    role,
    description,
    telegramHandle,
    telegramHref,
    twitterHandle,
    twitterHref,
    sortOrder: input.sortOrder ?? 0,
  };
}

export async function listMemberContacts(db: D1Database): Promise<MemberContact[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, role, description, telegram_handle, telegram_href,
              twitter_handle, twitter_href, sort_order
       FROM member_contacts
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all<MemberContactRow>();

  return (results ?? []).map(rowToContact);
}

export async function getMemberContact(
  db: D1Database,
  id: string
): Promise<MemberContact | null> {
  const row = await db
    .prepare(
      `SELECT id, name, role, description, telegram_handle, telegram_href,
              twitter_handle, twitter_href, sort_order
       FROM member_contacts
       WHERE id = ?`
    )
    .bind(id)
    .first<MemberContactRow>();

  return row ? rowToContact(row) : null;
}

export async function createMemberContact(
  db: D1Database,
  input: MemberContactInput
): Promise<MemberContact> {
  const data = validateContactInput(input, { requireId: true });
  const existing = await getMemberContact(db, data.id!);
  if (existing) throw new Error("该标识已存在");

  const result = await db
    .prepare(
      `INSERT INTO member_contacts (
         id, name, role, description, telegram_handle, telegram_href,
         twitter_handle, twitter_href, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.name,
      data.role,
      data.description,
      data.telegramHandle,
      data.telegramHref,
      data.twitterHandle ?? null,
      data.twitterHref ?? null,
      data.sortOrder ?? 0
    )
    .run();

  if (!result.success) throw new Error("创建联系人失败");

  const contact = await getMemberContact(db, data.id!);
  if (!contact) throw new Error("创建联系人失败");
  return contact;
}

export async function updateMemberContact(
  db: D1Database,
  id: string,
  input: MemberContactInput
): Promise<MemberContact> {
  const existing = await getMemberContact(db, id);
  if (!existing) throw new Error("联系人不存在");

  const data = validateContactInput(input);
  const updatedAt = new Date().toISOString();

  const result = await db
    .prepare(
      `UPDATE member_contacts
       SET name = ?, role = ?, description = ?,
           telegram_handle = ?, telegram_href = ?,
           twitter_handle = ?, twitter_href = ?,
           sort_order = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      data.name,
      data.role,
      data.description,
      data.telegramHandle,
      data.telegramHref,
      data.twitterHandle ?? null,
      data.twitterHref ?? null,
      data.sortOrder ?? 0,
      updatedAt,
      id
    )
    .run();

  if (!result.success) throw new Error("保存失败");

  const contact = await getMemberContact(db, id);
  if (!contact) throw new Error("保存失败");
  return contact;
}

export async function countMemberCodesForContact(
  db: D1Database,
  contactId: string
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM member_codes WHERE contact_id = ?`)
    .bind(contactId)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

export async function deleteMemberContact(db: D1Database, id: string): Promise<void> {
  const existing = await getMemberContact(db, id);
  if (!existing) throw new Error("联系人不存在");

  const codeCount = await countMemberCodesForContact(db, id);
  if (codeCount > 0) {
    throw new Error(`该对接人已被 ${codeCount} 个会员码引用，无法删除`);
  }

  const result = await db
    .prepare(`DELETE FROM member_contacts WHERE id = ?`)
    .bind(id)
    .run();

  if (!result.success) throw new Error("删除失败");
}
