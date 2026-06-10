import { Duration, Effect, FileSystem, Path, Scope, Stream } from "effect";

/**
 * Debounced `fs.watch` consumers shared by the JSON-config services
 * (`serverSettings.ts`, `globalActions.ts`, `keybindings.ts`) and the plan
 * runner.
 *
 * Editors emit multiple events per save (truncate, write, rename) and
 * `fs.watch` can fire before the content has been flushed to disk, so events
 * are debounced before `onChange` runs. The consumer is forked into `scope`;
 * `onChange` failures and watch-stream failures are logged and ignored so a
 * watcher never takes down its owning service.
 */
interface WatchInput<E> {
  readonly debounce: Duration.Duration;
  readonly scope: Scope.Scope;
  readonly onChange: Effect.Effect<unknown, E>;
}

const forkDebouncedConsumer = <A, StreamError, E>(
  events: Stream.Stream<A, StreamError>,
  input: WatchInput<E>,
) => {
  const onChangeSafely = input.onChange.pipe(Effect.ignoreCause({ log: true }));
  return Stream.runForEach(events, () => onChangeSafely).pipe(
    Effect.ignoreCause({ log: true }),
    Effect.forkIn(input.scope),
    Effect.asVoid,
  );
};

/**
 * Watch a single file by watching its parent directory and filtering events
 * down to the target path. The directory must already exist.
 */
export const watchFileDebounced = <E>(input: WatchInput<E> & { readonly filePath: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.dirname(input.filePath);
    const filename = path.basename(input.filePath);
    const resolvedPath = path.resolve(input.filePath);

    const events = fs.watch(directory).pipe(
      Stream.filter(
        (event) =>
          event.path === filename ||
          event.path === input.filePath ||
          path.resolve(directory, event.path) === resolvedPath,
      ),
      Stream.debounce(input.debounce),
    );

    yield* forkDebouncedConsumer(events, input);
  });

/** Watch every entry in a directory. The directory must already exist. */
export const watchDirectoryDebounced = <E>(input: WatchInput<E> & { readonly directory: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* forkDebouncedConsumer(
      fs.watch(input.directory).pipe(Stream.debounce(input.debounce)),
      input,
    );
  });
