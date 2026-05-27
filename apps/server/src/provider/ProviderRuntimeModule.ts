import { Effect, Layer } from "effect";

import { ServerConfig } from "../config.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../persistence/Layers/ProviderSessionRuntime.ts";
import { AnalyticsServiceLayerLive } from "../telemetry/Layers/AnalyticsService.ts";
import { makeClaudeAdapterLive } from "./Layers/ClaudeAdapter.ts";
import { makeCodexAdapterLive } from "./Layers/CodexAdapter.ts";
import { makeCursorAdapterLive } from "./Layers/CursorAdapter.ts";
import { makeEventNdjsonLogger } from "./Layers/EventNdjsonLogger.ts";
import { makeOpenCodeAdapterLive } from "./Layers/OpenCodeAdapter.ts";
import { ProviderAdapterRegistryLive } from "./Layers/ProviderAdapterRegistry.ts";
import { ProviderInstanceRegistryLive } from "./Layers/ProviderInstanceRegistry.ts";
import { makeProviderServiceLive } from "./Layers/ProviderService.ts";
import { ProviderSessionDirectoryLive } from "./Layers/ProviderSessionDirectory.ts";
import { ProviderSessionReaperLive } from "./Layers/ProviderSessionReaper.ts";

export const ProviderSessionDirectoryLayerLive = ProviderSessionDirectoryLive.pipe(
  Layer.provide(ProviderSessionRuntimeRepositoryLive),
);

export const ProviderRuntimeServiceLive = Layer.unwrap(
  Effect.gen(function* () {
    const { providerEventLogPath } = yield* ServerConfig;
    const nativeEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "native",
    });
    const canonicalEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "canonical",
    });
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const claudeAdapterLayer = makeClaudeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const cursorAdapterLayer = makeCursorAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const openCodeAdapterLayer = makeOpenCodeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeAdapterLayer),
      Layer.provide(cursorAdapterLayer),
      Layer.provide(openCodeAdapterLayer),
      Layer.provideMerge(ProviderSessionDirectoryLayerLive),
      Layer.provideMerge(ProviderInstanceRegistryLive),
    );

    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provideMerge(ProviderSessionDirectoryLayerLive),
    );
  }),
);

export const ProviderRuntimeLifecycleLive = ProviderSessionReaperLive.pipe(
  Layer.provideMerge(
    ProviderRuntimeServiceLive.pipe(Layer.provideMerge(AnalyticsServiceLayerLive)),
  ),
  Layer.provideMerge(ProviderSessionDirectoryLayerLive),
);
