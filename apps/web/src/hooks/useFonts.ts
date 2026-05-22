import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SystemFont } from "@fenrir/contracts";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

const SYSTEM_FONTS_STALE_TIME_MS = 10_000;
const SYSTEM_FONTS_GC_TIME_MS = 60_000;
const SYSTEM_FONTS_QUERY_KEY = ["system-fonts"] as const;

async function fetchFonts(refresh = false): Promise<SystemFont[]> {
  const url = resolvePrimaryEnvironmentHttpUrl(
    "/api/fonts",
    refresh ? { refresh: "1" } : undefined,
  );
  const response = await fetch(url, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch fonts: ${response.status}`);
  }

  return response.json();
}

export function useFonts() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: fonts = [], isLoading } = useQuery({
    queryKey: SYSTEM_FONTS_QUERY_KEY,
    queryFn: () => fetchFonts(),
    staleTime: SYSTEM_FONTS_STALE_TIME_MS,
    gcTime: SYSTEM_FONTS_GC_TIME_MS,
    retry: 2,
  });

  const refreshFonts = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await queryClient.fetchQuery({
        queryKey: SYSTEM_FONTS_QUERY_KEY,
        queryFn: () => fetchFonts(true),
        staleTime: 0,
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  const monospaceFonts = useMemo(() => fonts.filter((f) => f.category === "monospace"), [fonts]);

  return { fonts, monospaceFonts, isLoading, isRefreshing, refreshFonts };
}
