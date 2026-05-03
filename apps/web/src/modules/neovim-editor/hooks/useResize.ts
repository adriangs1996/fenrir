import { useEffect } from "react";
import { useNeovimStore } from "../stores/neovimStore";

export function useResize(nvim: any, cols: number, rows: number) {
  const resizeStore = useNeovimStore((s) => s.setGridSize);

  useEffect(() => {
    if (!nvim) return;
    if (cols === 0 || rows === 0) return;

    // 1. resize store FIRST
    resizeStore(rows, cols);

    // 2. then notify Neovim
    nvim.uiTryResize(cols, rows);
  }, [nvim, cols, rows, resizeStore]);
}
