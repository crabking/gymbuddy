import { and, eq, asc, like, sql } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { workspaceFiles } from "@/db/schema";

// Hardened per-user virtual filesystem, backed by the workspace_files table.
// Single source of truth for the agent's file tools (and, later, the ephemeral
// code sandbox). Every operation is confined to the user's own namespace and
// bounded by caps so the store stays sleek and scalable.

export const MAX_FILE_BYTES = 1_000_000; // 1 MB per file
export const MAX_TOTAL_FILES = 500; // per user
export const MAX_TOTAL_BYTES = 50_000_000; // 50 MB per user
const MAX_PATH_LEN = 256;

/** Confine to a clean relative path; reject traversal/absolute escapes. */
export function normalizePath(input: string): string {
  if (typeof input !== "string") throw new Error("path must be a string");
  const raw = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const segments: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new Error("path may not contain '..'");
    if (seg.includes("\0")) throw new Error("invalid path");
    segments.push(seg);
  }
  const out = segments.join("/");
  if (!out) throw new Error("empty path");
  if (out.length > MAX_PATH_LEN) throw new Error("path too long");
  return out;
}

const byteLen = (s: string) => Buffer.byteLength(s ?? "", "utf8");

export async function usage(userId: string) {
  const rows = await getDb()
    .select({ size_bytes: workspaceFiles.size_bytes })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.user_id, userId));
  return {
    files: rows.length,
    bytes: rows.reduce((n, r) => n + r.size_bytes, 0),
  };
}

export async function list(userId: string, prefix?: string) {
  const db = getDb();
  const rows = await db
    .select({
      path: workspaceFiles.path,
      size_bytes: workspaceFiles.size_bytes,
      updated_at: workspaceFiles.updated_at,
    })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.user_id, userId))
    .orderBy(asc(workspaceFiles.path));
  const clean = prefix ? normalizePath(prefix) + "/" : "";
  return rows
    .filter((r) => (clean ? r.path.startsWith(clean) : true))
    .map((r) => ({
      path: r.path,
      size: r.size_bytes,
      updated_at: r.updated_at,
    }));
}

async function getRow(userId: string, path: string) {
  const [row] = await getDb()
    .select({
      content: workspaceFiles.content,
      size_bytes: workspaceFiles.size_bytes,
      updated_at: workspaceFiles.updated_at,
    })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)))
    .limit(1);
  return row ?? null;
}

export async function read(userId: string, path: string) {
  const p = normalizePath(path);
  const row = await getRow(userId, p);
  if (!row) throw new Error(`not_found: ${p}`);
  return { path: p, content: row.content, updated_at: row.updated_at };
}

export async function exists(userId: string, path: string) {
  return (await getRow(userId, normalizePath(path))) !== null;
}

export async function write(
  userId: string,
  path: string,
  content: string,
  expectedUpdatedAt?: string | null,
) {
  const p = normalizePath(path);
  const text = content ?? "";
  const size = byteLen(text);
  if (size > MAX_FILE_BYTES) throw new Error(`file too large (max ${MAX_FILE_BYTES} bytes)`);

  const now = new Date().toISOString();
  const summary = text.split("\n")[0]?.trim().slice(0, 160) ?? "";
  await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"workspace:" + userId}, 0))`,
    );
    const rows = await tx
      .select({
        path: workspaceFiles.path,
        size_bytes: workspaceFiles.size_bytes,
        updated_at: workspaceFiles.updated_at,
      })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.user_id, userId));
    const existing = rows.find((row) => row.path === p);
    if (expectedUpdatedAt !== undefined && (existing?.updated_at ?? null) !== expectedUpdatedAt) {
      throw new Error("workspace file changed; read it again before editing");
    }
    if (!existing && rows.length >= MAX_TOTAL_FILES) {
      throw new Error(`workspace file limit reached (${MAX_TOTAL_FILES})`);
    }
    const usedBytes = rows.reduce((total, row) => total + row.size_bytes, 0);
    if (usedBytes - (existing?.size_bytes ?? 0) + size > MAX_TOTAL_BYTES) {
      throw new Error(`workspace storage limit reached (${MAX_TOTAL_BYTES} bytes)`);
    }
    await tx
      .insert(workspaceFiles)
      .values({
        user_id: userId,
        path: p,
        content: text,
        size_bytes: size,
        summary,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [workspaceFiles.user_id, workspaceFiles.path],
        set: { content: text, size_bytes: size, summary, updated_at: now },
      });
  });
  return { path: p, size };
}

export async function edit(
  userId: string,
  path: string,
  oldStr: string,
  newStr: string,
  all = false,
) {
  if (!oldStr) throw new Error("old_string may not be empty");
  const { content, updated_at: updatedAt } = await read(userId, path);
  if (!content.includes(oldStr)) throw new Error("old_string not found in file");
  if (all) {
    let occurrences = 0;
    let cursor = 0;
    while ((cursor = content.indexOf(oldStr, cursor)) !== -1) {
      occurrences += 1;
      cursor += oldStr.length;
    }
    const projected = byteLen(content) + occurrences * (byteLen(newStr) - byteLen(oldStr));
    if (projected > MAX_FILE_BYTES) {
      throw new Error(`file too large after edit (max ${MAX_FILE_BYTES} bytes)`);
    }
  }
  const updated = all ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
  return write(userId, path, updated, updatedAt);
}

export async function append(userId: string, path: string, text: string) {
  const p = normalizePath(path);
  const row = await getRow(userId, p);
  const current = row?.content ?? "";
  const joined = current && !current.endsWith("\n") ? `${current}\n${text}` : `${current}${text}`;
  return write(userId, p, joined, row?.updated_at ?? null);
}

export async function move(userId: string, from: string, to: string) {
  const src = await read(userId, from);
  const dest = normalizePath(to);
  await write(userId, dest, src.content);
  await remove(userId, src.path);
  return { from: src.path, to: dest };
}

export async function remove(userId: string, path: string) {
  const p = normalizePath(path);
  await getDb()
    .delete(workspaceFiles)
    .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, p)));
  return { path: p };
}

export async function grep(userId: string, pattern: string, prefix?: string, limit = 100) {
  const needle = pattern.trim().toLowerCase();
  if (!needle) throw new Error("search text may not be empty");
  if (needle.length > 500) throw new Error("search text is too long");
  const db = getDb();
  const clean = prefix ? normalizePath(prefix) + "/" : "";
  const rows = await db
    .select({ path: workspaceFiles.path, content: workspaceFiles.content })
    .from(workspaceFiles)
    .where(
      clean
        ? and(eq(workspaceFiles.user_id, userId), like(workspaceFiles.path, `${clean}%`))
        : eq(workspaceFiles.user_id, userId),
    )
    .orderBy(asc(workspaceFiles.path));

  const matches: Array<{ path: string; line: number; text: string }> = [];
  for (const r of rows) {
    const lines = (r.content ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches.push({ path: r.path, line: i + 1, text: lines[i].slice(0, 200) });
        if (matches.length >= limit) return { matches, truncated: true };
      }
    }
  }
  return { matches, truncated: false };
}

export async function wipe(userId: string) {
  await getDb().delete(workspaceFiles).where(eq(workspaceFiles.user_id, userId));
  return { ok: true };
}

/** Seed the agent's config tree on first use. */
export async function ensureAgentConfig(userId: string, coachName: string) {
  let existing: Record<string, unknown> = {};
  const configExists = await exists(userId, ".agent/config.json");
  const readmeExists = await exists(userId, ".agent/README.md");
  if (configExists) {
    try {
      existing = JSON.parse((await read(userId, ".agent/config.json")).content) as Record<
        string,
        unknown
      >;
    } catch {
      existing = {};
    }
  }
  if (existing.version === 2 && existing.coach === coachName && readmeExists) return;

  const config = {
    ...existing,
    version: 2,
    coach: coachName,
    created_at:
      typeof existing.created_at === "string"
        ? existing.created_at
        : new Date().toISOString().slice(0, 10),
    conventions: {
      schedule: "schedule/current.md",
      plan: "plans/current.md",
      nutrition: "nutrition/targets.md",
    },
    integrations: {},
  };
  await write(userId, ".agent/config.json", JSON.stringify(config, null, 2));
  if (!readmeExists || existing.version !== 2) {
    await write(
      userId,
      ".agent/README.md",
      `# Agent workspace

This is your private, persistent workspace. Organize files however helps you coach
this user. Conventions the UI reads:

- \`schedule/current.md\` — weekly training schedule
- \`plans/current.md\` — current workout plan
- \`nutrition/targets.md\` — calorie/macro targets

Use \`.agent/\` for your own config and scratch. Keep files tidy.
`,
    );
  }
}
