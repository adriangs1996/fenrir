import {
  type ImgHTMLAttributes,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { primaryAuthRequestInit } from "../../environments/primary";
import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";

function isBlobOrDataUrl(value: string): boolean {
  return value.startsWith("blob:") || value.startsWith("data:");
}

function resolveAuthenticatedImageFetchUrl(src: string | undefined): string | null {
  const trimmed = src?.trim();
  if (!trimmed || isBlobOrDataUrl(trimmed)) {
    return null;
  }

  if (trimmed.startsWith("/attachments/")) {
    try {
      return resolvePrimaryEnvironmentHttpUrl(trimmed);
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function useAuthenticatedImageSrc(src: string | undefined): {
  readonly resolvedSrc: string | undefined;
  readonly loadWithAuth: () => void;
} {
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const blobSrcRef = useRef<string | null>(null);
  const attemptedFetchUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const revokeBlobSrc = useCallback(() => {
    const current = blobSrcRef.current;
    if (current) {
      URL.revokeObjectURL(current);
      blobSrcRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      revokeBlobSrc();
    };
  }, [revokeBlobSrc]);

  useEffect(() => {
    attemptedFetchUrlRef.current = null;
    revokeBlobSrc();
    setBlobSrc(null);
  }, [revokeBlobSrc, src]);

  const loadWithAuth = useCallback(() => {
    const fetchUrl = resolveAuthenticatedImageFetchUrl(src);
    if (!fetchUrl || attemptedFetchUrlRef.current === fetchUrl) {
      return;
    }

    attemptedFetchUrlRef.current = fetchUrl;
    void (async () => {
      const response = await fetch(fetchUrl, primaryAuthRequestInit());
      if (!response.ok) {
        return;
      }

      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      if (!mountedRef.current || attemptedFetchUrlRef.current !== fetchUrl) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      revokeBlobSrc();
      blobSrcRef.current = objectUrl;
      setBlobSrc(objectUrl);
    })().catch(() => undefined);
  }, [revokeBlobSrc, src]);

  return {
    resolvedSrc: blobSrc ?? src,
    loadWithAuth,
  };
}

export function AuthenticatedImage({
  src,
  onError,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const { resolvedSrc, loadWithAuth } = useAuthenticatedImageSrc(src);

  const handleError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      loadWithAuth();
      onError?.(event);
    },
    [loadWithAuth, onError],
  );

  return <img {...props} src={resolvedSrc} onError={handleError} />;
}
