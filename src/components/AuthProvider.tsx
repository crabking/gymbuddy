import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/tanstack-react-start";
import { clerkFrontendEnabled, clerkPublishableKey } from "@/lib/auth-config";

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!clerkFrontendEnabled) return children;
  return (
    <ClerkProvider publishableKey={clerkPublishableKey} signInUrl="/auth" signUpUrl="/auth">
      {children}
    </ClerkProvider>
  );
}
