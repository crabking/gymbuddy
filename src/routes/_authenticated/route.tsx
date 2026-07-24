import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth.functions";
import { hardNavigateToAuth, isUnauthorizedError } from "@/lib/client-session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    try {
      const user = await getCurrentUser({ data: undefined });
      if (!user) {
        await hardNavigateToAuth(context.queryClient);
        throw redirect({ to: "/auth" });
      }
      return { user };
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await hardNavigateToAuth(context.queryClient);
        throw redirect({ to: "/auth" });
      }
      throw error;
    }
  },
  component: () => <Outlet />,
});
