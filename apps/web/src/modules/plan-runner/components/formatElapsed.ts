/**
 * Elapsed time between two ISO instants, falling back to "now" while the work
 * is still running. Shared by the plan-runner views (run header, history rows,
 * DAG nodes).
 */
export function formatElapsed(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
