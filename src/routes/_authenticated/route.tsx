import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const user = await getCurrentUser({ data: undefined });
    if (!user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: () => <Outlet />,
});
