import { createFileRoute } from "@tanstack/react-router";
import { getAuthenticatedUser } from "@/lib/identity.server";
import { exportAccountData } from "@/lib/account-data.server";

export const Route = createFileRoute("/api/account-export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getAuthenticatedUser(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const data = await exportAccountData(user.id);
        const date = new Date().toISOString().slice(0, 10);
        return new Response(JSON.stringify(data, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="coach-account-export-${date}.json"`,
            "Cache-Control": "no-store, private",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex",
          },
        });
      },
    },
  },
});
