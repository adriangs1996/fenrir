import { toastManager } from "../ui/toast";

type ToastId = ReturnType<typeof toastManager.add>;

const loadingToastByRunId = new Map<string, ToastId>();

export function registerActionRunLoadingToast(runId: string, toastId: ToastId): void {
  loadingToastByRunId.set(runId, toastId);
}

export function closeActionRunLoadingToast(runId: string): void {
  const toastId = loadingToastByRunId.get(runId);
  if (!toastId) return;
  loadingToastByRunId.delete(runId);
  toastManager.close(toastId);
}
