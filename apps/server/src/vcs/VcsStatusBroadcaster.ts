import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import type {
  GitManagerServiceError,
  VcsStatusInput,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "@fenrir/contracts";

import { GitWorkflowService } from "../git/Services/GitWorkflowService.ts";

const DEFAULT_VCS_STATUS_REFRESH_INTERVAL = Duration.seconds(30);
export const LOCAL_VCS_STATUS_REFRESH_INTERVAL = Duration.seconds(2);
const VCS_STATUS_REFRESH_FAILURE_BASE_DELAY = Duration.seconds(30);
const VCS_STATUS_REFRESH_FAILURE_MAX_DELAY = Duration.minutes(15);

interface VcsStatusChange {
  readonly cwd: string;
  readonly event: VcsStatusStreamEvent;
}

interface CachedValue<T> {
  readonly fingerprint: string;
  readonly value: T;
}

interface CachedVcsStatus {
  readonly local: CachedValue<VcsStatusLocalResult> | null;
  readonly remote: CachedValue<VcsStatusRemoteResult | null> | null;
}

interface ActiveStatusPoller {
  readonly fiber: Fiber.Fiber<void, never>;
  readonly subscriberCount: number;
}

type ActiveStatusPollerMap = SynchronizedRef.SynchronizedRef<Map<string, ActiveStatusPoller>>;

const EMPTY_VCS_STATUS_REMOTE: VcsStatusRemoteResult = {
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  aheadOfDefaultCount: 0,
  pr: null,
};

interface StreamStatusOptions {
  readonly automaticRemoteRefreshInterval?: Effect.Effect<Duration.Duration, never>;
}

export function remoteRefreshFailureDelay(
  consecutiveFailures: number,
  configuredInterval: Duration.Duration,
) {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const backoffMs =
    Duration.toMillis(VCS_STATUS_REFRESH_FAILURE_BASE_DELAY) * Math.pow(2, exponent);
  const cappedBackoff = Duration.min(
    Duration.millis(backoffMs),
    VCS_STATUS_REFRESH_FAILURE_MAX_DELAY,
  );
  return Duration.max(configuredInterval, cappedBackoff);
}

export interface VcsStatusBroadcasterShape {
  readonly getStatus: (
    input: VcsStatusInput,
  ) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
  readonly refreshLocalStatus: (
    cwd: string,
  ) => Effect.Effect<VcsStatusLocalResult, GitManagerServiceError>;
  readonly refreshStatus: (cwd: string) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
  readonly streamStatus: (
    input: VcsStatusInput,
    options?: StreamStatusOptions,
  ) => Stream.Stream<VcsStatusStreamEvent, GitManagerServiceError>;
}

export class VcsStatusBroadcaster extends Context.Service<
  VcsStatusBroadcaster,
  VcsStatusBroadcasterShape
>()("fenrir/vcs/VcsStatusBroadcaster") {}

function fingerprintStatusPart(status: unknown): string {
  return JSON.stringify(status);
}

function mergeVcsStatusParts(
  local: VcsStatusLocalResult,
  remote: VcsStatusRemoteResult | null,
): VcsStatusResult {
  return {
    ...local,
    ...(remote ?? EMPTY_VCS_STATUS_REMOTE),
  };
}

function shouldRefreshRemoteAfterLocalStatusChange(
  previous: VcsStatusLocalResult | null,
  next: VcsStatusLocalResult,
): boolean {
  if (previous === null) {
    return false;
  }
  return (
    previous.isRepo !== next.isRepo ||
    previous.refName !== next.refName ||
    previous.isDefaultRef !== next.isDefaultRef ||
    previous.hasPrimaryRemote !== next.hasPrimaryRemote ||
    fingerprintStatusPart(previous.sourceControlProvider ?? null) !==
      fingerprintStatusPart(next.sourceControlProvider ?? null)
  );
}

const normalizeCwd = (cwd: string) =>
  Effect.service(FileSystem.FileSystem).pipe(
    Effect.flatMap((fs) => fs.realPath(cwd)),
    Effect.orElseSucceed(() => cwd),
  );

export const layer = Layer.effect(
  VcsStatusBroadcaster,
  Effect.gen(function* () {
    const workflow = yield* GitWorkflowService;
    const fs = yield* FileSystem.FileSystem;
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<VcsStatusChange>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const broadcasterScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    const cacheRef = yield* Ref.make(new Map<string, CachedVcsStatus>());
    const remotePollersRef = yield* SynchronizedRef.make(new Map<string, ActiveStatusPoller>());
    const localPollersRef = yield* SynchronizedRef.make(new Map<string, ActiveStatusPoller>());

    const getCachedStatus = Effect.fn("VcsStatusBroadcaster.getCachedStatus")(function* (
      cwd: string,
    ) {
      return yield* Ref.get(cacheRef).pipe(Effect.map((cache) => cache.get(cwd) ?? null));
    });

    const updateCachedLocalStatus = Effect.fn("VcsStatusBroadcaster.updateCachedLocalStatus")(
      function* (cwd: string, local: VcsStatusLocalResult, options?: { publish?: boolean }) {
        const nextLocal = {
          fingerprint: fingerprintStatusPart(local),
          value: local,
        } satisfies CachedValue<VcsStatusLocalResult>;
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(cwd) ?? { local: null, remote: null };
          const nextCache = new Map(cache);
          nextCache.set(cwd, {
            ...previous,
            local: nextLocal,
          });
          return [previous.local?.fingerprint !== nextLocal.fingerprint, nextCache] as const;
        });

        if (options?.publish && shouldPublish) {
          yield* PubSub.publish(changesPubSub, {
            cwd,
            event: {
              _tag: "localUpdated",
              local,
            },
          });
        }

        return local;
      },
    );

    const updateCachedRemoteStatus = Effect.fn("VcsStatusBroadcaster.updateCachedRemoteStatus")(
      function* (
        cwd: string,
        remote: VcsStatusRemoteResult | null,
        options?: { publish?: boolean },
      ) {
        const nextRemote = {
          fingerprint: fingerprintStatusPart(remote),
          value: remote,
        } satisfies CachedValue<VcsStatusRemoteResult | null>;
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(cwd) ?? { local: null, remote: null };
          const nextCache = new Map(cache);
          nextCache.set(cwd, {
            ...previous,
            remote: nextRemote,
          });
          return [previous.remote?.fingerprint !== nextRemote.fingerprint, nextCache] as const;
        });

        if (options?.publish && shouldPublish) {
          yield* PubSub.publish(changesPubSub, {
            cwd,
            event: {
              _tag: "remoteUpdated",
              remote,
            },
          });
        }

        return remote;
      },
    );

    const loadLocalStatus = Effect.fn("VcsStatusBroadcaster.loadLocalStatus")(function* (
      cwd: string,
    ) {
      const local = yield* workflow.localStatus({ cwd });
      return yield* updateCachedLocalStatus(cwd, local);
    });

    const loadRemoteStatus = Effect.fn("VcsStatusBroadcaster.loadRemoteStatus")(function* (
      cwd: string,
    ) {
      const remote = yield* workflow.remoteStatus({ cwd });
      return yield* updateCachedRemoteStatus(cwd, remote);
    });

    const getOrLoadLocalStatus = Effect.fn("VcsStatusBroadcaster.getOrLoadLocalStatus")(function* (
      cwd: string,
    ) {
      const cached = yield* getCachedStatus(cwd);
      if (cached?.local) {
        return cached.local.value;
      }
      return yield* loadLocalStatus(cwd);
    });

    const getOrLoadRemoteStatus = Effect.fn("VcsStatusBroadcaster.getOrLoadRemoteStatus")(
      function* (cwd: string) {
        const cached = yield* getCachedStatus(cwd);
        if (cached?.remote) {
          return cached.remote.value;
        }
        return yield* loadRemoteStatus(cwd);
      },
    );

    const withFileSystem = Effect.provideService(FileSystem.FileSystem, fs);

    const getStatus: VcsStatusBroadcasterShape["getStatus"] = Effect.fn(
      "VcsStatusBroadcaster.getStatus",
    )(function* (input) {
      const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
      const [local, remote] = yield* Effect.all([
        getOrLoadLocalStatus(cwd),
        getOrLoadRemoteStatus(cwd),
      ]);
      return mergeVcsStatusParts(local, remote);
    });

    const refreshLocalStatus: VcsStatusBroadcasterShape["refreshLocalStatus"] = Effect.fn(
      "VcsStatusBroadcaster.refreshLocalStatus",
    )(function* (rawCwd) {
      const cwd = yield* withFileSystem(normalizeCwd(rawCwd));
      yield* workflow.invalidateLocalStatus(cwd);
      const local = yield* workflow.localStatus({ cwd });
      return yield* updateCachedLocalStatus(cwd, local, { publish: true });
    });

    const refreshRemoteStatus = Effect.fn("VcsStatusBroadcaster.refreshRemoteStatus")(function* (
      cwd: string,
    ) {
      yield* workflow.invalidateRemoteStatus(cwd);
      const remote = yield* workflow.remoteStatus({ cwd });
      return yield* updateCachedRemoteStatus(cwd, remote, { publish: true });
    });

    const refreshStatus: VcsStatusBroadcasterShape["refreshStatus"] = Effect.fn(
      "VcsStatusBroadcaster.refreshStatus",
    )(function* (rawCwd) {
      const cwd = yield* withFileSystem(normalizeCwd(rawCwd));
      const [local, remote] = yield* Effect.all([
        refreshLocalStatus(cwd),
        refreshRemoteStatus(cwd),
      ]);
      return mergeVcsStatusParts(local, remote);
    });

    const makeRemoteRefreshLoop = (
      cwd: string,
      automaticRemoteRefreshInterval: Effect.Effect<Duration.Duration, never>,
    ) => {
      return Effect.gen(function* () {
        const consecutiveFailuresRef = yield* Ref.make(0);
        const refreshRemoteStatusIfEnabled = Effect.gen(function* () {
          const configuredInterval = yield* automaticRemoteRefreshInterval;
          const activeInterval = Duration.isZero(configuredInterval)
            ? DEFAULT_VCS_STATUS_REFRESH_INTERVAL
            : configuredInterval;
          if (Duration.isZero(configuredInterval)) {
            return activeInterval;
          }

          const exit = yield* refreshRemoteStatus(cwd).pipe(Effect.exit);
          if (Exit.isSuccess(exit)) {
            yield* Ref.set(consecutiveFailuresRef, 0);
            return activeInterval;
          }

          const consecutiveFailures = yield* Ref.updateAndGet(
            consecutiveFailuresRef,
            (count) => count + 1,
          );
          const nextDelay = remoteRefreshFailureDelay(consecutiveFailures, activeInterval);
          yield* Effect.logWarning("VCS remote status refresh failed", {
            cwd,
            detail: exit.cause.toString(),
            consecutiveFailures,
            nextDelayMs: Duration.toMillis(nextDelay),
          });
          return nextDelay;
        });

        return yield* refreshRemoteStatusIfEnabled.pipe(
          Effect.repeat(
            Schedule.identity<Duration.Duration>().pipe(
              Schedule.addDelay((delay) => Effect.succeed(delay)),
            ),
          ),
          Effect.asVoid,
        );
      });
    };

    const makeLocalRefreshLoop = (cwd: string) =>
      Effect.gen(function* () {
        const refreshLocalStatusIfChanged = Effect.gen(function* () {
          const previousLocal = (yield* getCachedStatus(cwd))?.local?.value ?? null;
          const exit = yield* refreshLocalStatus(cwd).pipe(Effect.exit);
          if (Exit.isFailure(exit)) {
            yield* Effect.logDebug("VCS local status refresh failed", {
              cwd,
              detail: exit.cause.toString(),
            });
            return;
          }

          if (!shouldRefreshRemoteAfterLocalStatusChange(previousLocal, exit.value)) {
            return;
          }

          const remoteExit = yield* refreshRemoteStatus(cwd).pipe(Effect.exit);
          if (Exit.isFailure(remoteExit)) {
            yield* Effect.logDebug("VCS remote status refresh after local change failed", {
              cwd,
              detail: remoteExit.cause.toString(),
            });
          }
        });

        return yield* Effect.sleep(LOCAL_VCS_STATUS_REFRESH_INTERVAL).pipe(
          Effect.andThen(refreshLocalStatusIfChanged),
          Effect.repeat(Schedule.spaced(LOCAL_VCS_STATUS_REFRESH_INTERVAL)),
          Effect.asVoid,
        );
      });

    const retainStatusPoller = Effect.fn("VcsStatusBroadcaster.retainStatusPoller")(function* (
      activePollersRef: ActiveStatusPollerMap,
      cwd: string,
      makeLoop: (cwd: string) => Effect.Effect<void, never>,
    ) {
      yield* SynchronizedRef.modifyEffect(activePollersRef, (activePollers) => {
        const existing = activePollers.get(cwd);
        if (existing) {
          const nextPollers = new Map(activePollers);
          nextPollers.set(cwd, {
            ...existing,
            subscriberCount: existing.subscriberCount + 1,
          });
          return Effect.succeed([undefined, nextPollers] as const);
        }

        return makeLoop(cwd).pipe(
          Effect.forkIn(broadcasterScope),
          Effect.map((fiber) => {
            const nextPollers = new Map(activePollers);
            nextPollers.set(cwd, {
              fiber,
              subscriberCount: 1,
            });
            return [undefined, nextPollers] as const;
          }),
        );
      });
    });

    const releaseStatusPoller = Effect.fn("VcsStatusBroadcaster.releaseStatusPoller")(function* (
      activePollersRef: ActiveStatusPollerMap,
      cwd: string,
    ) {
      const pollerToInterrupt = yield* SynchronizedRef.modify(activePollersRef, (activePollers) => {
        const existing = activePollers.get(cwd);
        if (!existing) {
          return [null, activePollers] as const;
        }

        if (existing.subscriberCount > 1) {
          const nextPollers = new Map(activePollers);
          nextPollers.set(cwd, {
            ...existing,
            subscriberCount: existing.subscriberCount - 1,
          });
          return [null, nextPollers] as const;
        }

        const nextPollers = new Map(activePollers);
        nextPollers.delete(cwd);
        return [existing.fiber, nextPollers] as const;
      });

      if (pollerToInterrupt) {
        yield* Fiber.interrupt(pollerToInterrupt).pipe(Effect.ignore);
      }
    });

    const retainLocalPoller = (cwd: string) =>
      retainStatusPoller(localPollersRef, cwd, makeLocalRefreshLoop);

    const releaseLocalPoller = (cwd: string) => releaseStatusPoller(localPollersRef, cwd);

    const retainRemotePoller = Effect.fn("VcsStatusBroadcaster.retainRemotePoller")(function* (
      cwd: string,
      automaticRemoteRefreshInterval: Effect.Effect<Duration.Duration, never>,
    ) {
      yield* retainStatusPoller(remotePollersRef, cwd, (loopCwd) =>
        makeRemoteRefreshLoop(loopCwd, automaticRemoteRefreshInterval),
      );
    });

    const releaseRemotePoller = (cwd: string) => releaseStatusPoller(remotePollersRef, cwd);

    const streamStatus: VcsStatusBroadcasterShape["streamStatus"] = (input, options) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
          const subscription = yield* PubSub.subscribe(changesPubSub);
          const initialLocal = yield* getOrLoadLocalStatus(cwd);
          const initialRemote = (yield* getCachedStatus(cwd))?.remote?.value ?? null;
          yield* retainRemotePoller(
            cwd,
            options?.automaticRemoteRefreshInterval ??
              Effect.succeed(DEFAULT_VCS_STATUS_REFRESH_INTERVAL),
          );
          yield* retainLocalPoller(cwd);

          const release = Effect.all([releaseRemotePoller(cwd), releaseLocalPoller(cwd)]).pipe(
            Effect.ignore,
            Effect.asVoid,
          );

          return Stream.concat(
            Stream.make({
              _tag: "snapshot" as const,
              local: initialLocal,
              remote: initialRemote,
            }),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((event) => event.cwd === cwd),
              Stream.map((event) => event.event),
            ),
          ).pipe(Stream.ensuring(release));
        }),
      );

    return VcsStatusBroadcaster.of({
      getStatus,
      refreshLocalStatus,
      refreshStatus,
      streamStatus,
    });
  }),
);
