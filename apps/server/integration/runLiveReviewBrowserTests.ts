import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";

import {
  type ReviewLiveBrowserEnvironment,
  withLiveReviewBrowserEnvironment,
} from "./setups/reviewLiveBrowser";

const LIVE_BROWSER_TEST_PATH = "src/modules/review/components/ReviewTabShell.live.browser.tsx";

function createBrowserTestEnvironment(setup: ReviewLiveBrowserEnvironment): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VITE_DEV_SERVER_URL: "/",
    VITE_HTTP_URL: setup.httpBaseUrl,
    VITE_WS_URL: setup.wsBaseUrl,
    VITE_REVIEW_E2E_BOOTSTRAP_TOKEN: setup.bootstrapToken,
    VITE_REVIEW_E2E_ENVIRONMENT_ID: setup.environmentId,
    VITE_REVIEW_E2E_EXPECTED_CHUNK_TEXT: setup.expectedChunkText,
    VITE_REVIEW_E2E_EXPECTED_FILE_PATH: setup.expectedFilePath,
    VITE_REVIEW_E2E_THREAD_ID: setup.threadId,
  };
}

function resolveWebAppDirectory(): string {
  return fileURLToPath(new URL("../../web", import.meta.url));
}

function resolveBunBinary(): string {
  return process.execPath;
}

function runLiveBrowserVitest(
  setup: ReviewLiveBrowserEnvironment,
  extraArgs: readonly string[],
): Effect.Effect<void, Error> {
  return Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          resolveBunBinary(),
          [
            "x",
            "vitest",
            "run",
            "--config",
            "vitest.browser.config.ts",
            LIVE_BROWSER_TEST_PATH,
            ...extraArgs,
          ],
          {
            cwd: resolveWebAppDirectory(),
            env: createBrowserTestEnvironment(setup),
            stdio: "inherit",
          },
        );

        child.once("error", function handleError(error): void {
          reject(error);
        });
        child.once("exit", function handleExit(code, signal): void {
          if (code === 0) {
            resolve();
            return;
          }

          const reason =
            signal !== null
              ? `Live browser review tests exited from signal ${signal}.`
              : `Live browser review tests failed with exit code ${code ?? -1}.`;
          reject(new Error(reason));
        });
      }),
  );
}

function logLiveBrowserSetup(setup: ReviewLiveBrowserEnvironment): Effect.Effect<void> {
  return Effect.sync(function printSetup(): void {
    console.log("Review live browser test environment");
    console.log(`  http: ${setup.httpBaseUrl}`);
    console.log(`  ws: ${setup.wsBaseUrl}`);
    console.log(`  environment: ${setup.environmentId}`);
    console.log(`  thread: ${setup.threadId}`);
    console.log(`  expected file: ${setup.expectedFilePath}`);
  });
}

function main(): Effect.Effect<void, Error, never> {
  const extraArgs = process.argv.slice(2);

  return Effect.scoped(
    withLiveReviewBrowserEnvironment(function runWithEnvironment(setup): Effect.Effect<
      void,
      Error
    > {
      return Effect.gen(function* () {
        yield* logLiveBrowserSetup(setup);
        yield* runLiveBrowserVitest(setup, extraArgs);
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}

await Effect.runPromise(main());
