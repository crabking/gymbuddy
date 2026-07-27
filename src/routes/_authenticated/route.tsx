import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/auth.functions";
import { getProfile } from "@/lib/gym-buddy.functions";
import { getPolicyStatus } from "@/lib/policy.functions";
import { hardNavigateToAuth, isUnauthorizedError } from "@/lib/client-session";
import { LanguageProvider } from "@/components/LanguageProvider";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    try {
      const user = await getCurrentUser({ data: undefined });
      if (!user) {
        await hardNavigateToAuth(context.queryClient);
        throw redirect({ to: "/auth" });
      }
      await context.queryClient.ensureQueryData({
        queryKey: ["profile"],
        queryFn: () => getProfile({ data: undefined }),
      });
      const policy = await context.queryClient.ensureQueryData({
        queryKey: ["policy-status"],
        queryFn: () => getPolicyStatus({ data: undefined }),
      });
      if (!policy.complete && location.pathname !== "/consent") {
        throw redirect({ to: "/consent" });
      }
      if (policy.complete && location.pathname === "/consent") {
        throw redirect({ to: "/chat" });
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
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { data: profile } = useSuspenseQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile({ data: undefined }),
  });
  return (
    <LanguageProvider language={profile?.preferred_language}>
      <Outlet />
    </LanguageProvider>
  );
}
