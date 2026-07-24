import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { hardNavigateToAuth, isUnauthorizedError } from "./lib/client-session";

export const getRouter = () => {
  const queryClientRef: { current?: QueryClient } = {};
  const handleError = (error: unknown) => {
    if (isUnauthorizedError(error) && queryClientRef.current) {
      void hardNavigateToAuth(queryClientRef.current);
    }
  };
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => !isUnauthorizedError(error) && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  });
  queryClientRef.current = queryClient;

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
