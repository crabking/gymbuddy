import { tool } from "ai";
import { z } from "zod";
import * as ws from "@/lib/workspace.server";

// Generic Claude-Code-style file tools over the per-user virtual filesystem.
// The agent uses these to operate freely in its workspace; the existing
// domain tools (save_workout_plan, …) remain as higher-level shortcuts.
export function workspaceTools(userId: string) {
  const wrap =
    <T>(fn: () => Promise<T>) =>
    async () => {
      try {
        return { ok: true, ...(await fn()) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    };

  return {
    fs_ls: tool({
      description:
        "List files in the workspace (optionally under a directory prefix). Returns path, size, and last-updated for each.",
      inputSchema: z.object({ path: z.string().nullable().describe("Directory prefix, or null for the whole tree") }),
      execute: ({ path }) =>
        wrap(async () => ({ files: await ws.list(userId, path ?? undefined) }))(),
    }),
    fs_read: tool({
      description: "Read the full contents of a workspace file by path.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) => wrap(() => ws.read(userId, path))(),
    }),
    fs_write: tool({
      description:
        "Create or overwrite a workspace file with the given content. Creates parent 'directories' implicitly.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: ({ path, content }) => wrap(() => ws.write(userId, path, content))(),
    }),
    fs_edit: tool({
      description:
        "Replace a substring in a workspace file. By default replaces the first occurrence; set replace_all to replace every occurrence.",
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().nullable(),
      }),
      execute: ({ path, old_string, new_string, replace_all }) =>
        wrap(() => ws.edit(userId, path, old_string, new_string, replace_all ?? false))(),
    }),
    fs_append: tool({
      description: "Append text to the end of a workspace file (creating it if needed).",
      inputSchema: z.object({ path: z.string(), text: z.string() }),
      execute: ({ path, text }) => wrap(() => ws.append(userId, path, text))(),
    }),
    fs_move: tool({
      description: "Move/rename a workspace file from one path to another.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: ({ from, to }) => wrap(() => ws.move(userId, from, to))(),
    }),
    fs_delete: tool({
      description: "Delete a workspace file by path.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) => wrap(() => ws.remove(userId, path))(),
    }),
    fs_grep: tool({
      description:
        "Search the workspace for a regular expression. Returns matching path, line number, and line text.",
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().nullable().describe("Directory prefix to limit the search, or null for everything"),
      }),
      execute: ({ pattern, path }) => wrap(() => ws.grep(userId, pattern, path ?? undefined))(),
    }),
  };
}
