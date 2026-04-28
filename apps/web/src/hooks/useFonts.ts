import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SystemFont } from "@fenrir/contracts";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

async function fetchFonts(): Promise<SystemFont[]> {
  const url = resolvePrimaryEnvironmentHttpUrl("/api/fonts");
  const response = await fetch(url, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch fonts: ${response.status}`);
  }

  return response.json();
}

export function useFonts() {
  const { data: fonts = [], isLoading } = useQuery({
    queryKey: ["system-fonts"],
    queryFn: fetchFonts,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 2,
  });

  const monospaceFonts = useMemo(() => fonts.filter((f) => f.category === "monospace"), [fonts]);

  return { fonts, monospaceFonts, isLoading };
}
