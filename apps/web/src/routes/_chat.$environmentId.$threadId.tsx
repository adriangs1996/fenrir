import { Outlet, createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  selectEnvironmentState,
  selectThreadDetailsHydratedByRef,
  selectThreadExistsByRef,
  useStore,
} from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { parseThreadRouteSearch } from "../threadRouteSearch";
import { resolveThreadRouteRef } from "../threadRoutes";
import { SidebarInset } from "~/components/ui/sidebar";
import { hydrateEnvironmentThreadSnapshot } from "~/environments/runtime";
import {
  useInternalPlanRunnerThreadIds,
  useInternalPlanRunnerThreadOwners,
} from "~/modules/plan-runner";
import { isUserBrowsableThread } from "~/threadVisibility";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const isNestedThreadToolRoute = useLocation({
    select: (location) => location.pathname.endsWith("/gitdiff"),
  });
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const threadDetailsHydrated = useStore((store) =>
    selectThreadDetailsHydratedByRef(store, threadRef),
  );
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  // Internal plan-runner threads (executor/reviewer/analyzer/integration) are
  // implementation detail. Direct route access is blocked: redirect to the
  // owning run view if known, otherwise fall back to the generic
  // not-available behavior (route home) rather than rendering the thread.
  const internalPlanRunnerThreadIds = useInternalPlanRunnerThreadIds();
  const internalPlanRunnerThreadOwners = useInternalPlanRunnerThreadOwners();
  const isInternalPlanRunnerThread =
    threadRef !== null && internalPlanRunnerThreadIds.has(threadRef.threadId);
  const isHiddenThread = serverThread !== undefined && !isUserBrowsableThread(serverThread);
  const owningRunIdForThread =
    threadRef !== null ? (internalPlanRunnerThreadOwners.get(threadRef.threadId) ?? null) : null;

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (isInternalPlanRunnerThread) {
      if (owningRunIdForThread !== null) {
        void navigate({
          to: "/plan-runner/$runId",
          params: { runId: owningRunIdForThread },
          replace: true,
        });
      } else {
        // Owning run unresolvable — fall back to generic not-available
        // behavior (route home) instead of exposing the internal thread.
        void navigate({ to: "/", replace: true });
      }
      return;
    }

    if (isHiddenThread) {
      void navigate({ to: "/", replace: true });
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [
    bootstrapComplete,
    environmentHasAnyThreads,
    isInternalPlanRunnerThread,
    isHiddenThread,
    navigate,
    owningRunIdForThread,
    routeThreadExists,
    threadRef,
  ]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete || !threadExists || threadDetailsHydrated) {
      return;
    }

    void hydrateEnvironmentThreadSnapshot(threadRef).catch(() => undefined);
  }, [bootstrapComplete, threadDetailsHydrated, threadExists, threadRef]);

  if (
    !threadRef ||
    !bootstrapComplete ||
    !routeThreadExists ||
    isInternalPlanRunnerThread ||
    isHiddenThread
  ) {
    return null;
  }

  if (threadExists && !threadDetailsHydrated) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading thread…
        </div>
      </SidebarInset>
    );
  }

  if (isNestedThreadToolRoute) {
    return <Outlet />;
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <ChatView
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        routeKind="server"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseThreadRouteSearch(search),
  component: ChatThreadRouteView,
});
