import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { GLOBAL_SCRIPT_RUN_COMMAND_PATTERN, MAX_SCRIPT_ID_LENGTH } from "@fenrir/contracts";
import { ServerConfig } from "./config";
import { GlobalActionsLive, GlobalActionsService } from "./globalActions";

const isGlobalScriptRunCommand = Schema.is(GLOBAL_SCRIPT_RUN_COMMAND_PATTERN);

const makeGlobalActionsLayer = () =>
  GlobalActionsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "fenrir-global-actions-test-",
        }),
      ),
    ),
  );

const writeGlobalActionsJson = (entries: unknown[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { globalActionsPath } = yield* ServerConfig;

    yield* fileSystem.makeDirectory(path.dirname(globalActionsPath), { recursive: true });
    yield* fileSystem.writeFileString(globalActionsPath, `${JSON.stringify(entries, null, 2)}\n`);
  });

it.layer(NodeServices.layer)("global actions", (it) => {
  it.effect("creates keybinding-compatible ids for long global action names", () =>
    Effect.gen(function* () {
      const globalActions = yield* GlobalActionsService;

      const created = yield* globalActions.create({
        name: "Shutdown Guruwalk Projects",
        command: "~/sandbox/gwagent/projects down",
        icon: "play",
      });

      assert.isAtMost(created.id.length, MAX_SCRIPT_ID_LENGTH);
      assert.isTrue(isGlobalScriptRunCommand(`global-script.${created.id}.run`));
    }).pipe(Effect.provide(makeGlobalActionsLayer())),
  );

  it.effect("ignores persisted global actions with ids that cannot be keybinding commands", () =>
    Effect.gen(function* () {
      yield* writeGlobalActionsJson([
        {
          id: "shutdown-guruwalk-projects",
          name: "Shutdown Guruwalk Projects",
          command: "~/sandbox/gwagent/projects down",
          icon: "play",
        },
        {
          id: "top-ports-scan",
          name: "Top Ports Scan",
          command: "nmap -sVC -Pn -oA nmap {{target}}",
          icon: "play",
        },
      ]);

      const globalActions = yield* GlobalActionsService;
      const actions = yield* globalActions.getAll;

      assert.deepEqual(
        actions.map((action) => action.id),
        ["top-ports-scan"],
      );
    }).pipe(Effect.provide(makeGlobalActionsLayer())),
  );
});
