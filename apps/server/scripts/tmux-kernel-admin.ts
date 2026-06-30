#!/usr/bin/env bun

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { NetService } from "@fenrir/shared/Net";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import type * as CliError from "effect/unstable/cli/CliError";

import { cli } from "../src/cli.ts";
import { version } from "../package.json" with { type: "json" };

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

(
  Command.runWith(cli, { version })(["tmux-kernel", ...process.argv.slice(2)]) as Effect.Effect<
    void,
    CliError.CliError | Error
  >
).pipe(Effect.scoped, Effect.provide(CliRuntimeLayer), NodeRuntime.runMain);
