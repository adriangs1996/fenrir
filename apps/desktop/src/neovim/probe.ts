import * as ChildProcess from "node:child_process";

export interface NvimProbeResult {
  available: boolean;
  version: string | null;
  binary: string | null;
  error: string | null;
}

let cached: NvimProbeResult | null = null;

export async function probeNvim(): Promise<NvimProbeResult> {
  if (cached) return cached;
  const result = await new Promise<NvimProbeResult>((resolve) => {
    let resolved = false;
    const settle = (r: NvimProbeResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };

    let proc: ChildProcess.ChildProcess;
    try {
      proc = ChildProcess.spawn("nvim", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      settle({
        available: false,
        version: null,
        binary: null,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("error", (err) => {
      settle({ available: false, version: null, binary: null, error: err.message });
    });

    proc.on("exit", (code) => {
      if (code !== 0) {
        settle({
          available: false,
          version: null,
          binary: null,
          error: `nvim --version exited with code ${code}`,
        });
        return;
      }
      const firstLine = stdout.split("\n")[0]?.trim() ?? null;
      settle({
        available: true,
        version: firstLine,
        binary: "nvim",
        error: null,
      });
    });

    setTimeout(
      () =>
        settle({
          available: false,
          version: null,
          binary: null,
          error: "nvim --version timed out",
        }),
      3000,
    );
  });
  cached = result;
  return result;
}

export function getCachedProbeResult(): NvimProbeResult | null {
  return cached;
}

/** Reset cached result. Only for testing. */
export function _resetCachedProbeResult(): void {
  cached = null;
}
