import { useCallback, useMemo, useState } from "react";
import type { SystemFont } from "@fenrir/contracts";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxGroup,
  ComboboxGroupLabel,
} from "../ui/combobox";

interface FontPickerProps {
  value: string;
  onChange: (fontFamily: string) => void;
  fonts: SystemFont[];
  filterMonospace?: boolean;
  isLoading?: boolean;
}

const CATEGORY_LABELS: Record<SystemFont["category"], string> = {
  monospace: "Monospace",
  "sans-serif": "Sans-Serif",
  serif: "Serif",
  other: "Other",
};

const CATEGORY_ORDER: SystemFont["category"][] = ["monospace", "sans-serif", "serif", "other"];

export function FontPicker({
  value,
  onChange,
  fonts,
  filterMonospace = false,
  isLoading = false,
}: FontPickerProps) {
  const [showAllFonts, setShowAllFonts] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const visibleFonts = useMemo(
    () =>
      filterMonospace && !showAllFonts ? fonts.filter((f) => f.category === "monospace") : fonts,
    [fonts, filterMonospace, showAllFonts],
  );

  // Font family names as string items for Combobox
  const items = useMemo(() => visibleFonts.map((f) => f.family), [visibleFonts]);

  // Filter items based on input value using simple case-insensitive contains
  const filteredItems = useMemo(() => {
    if (!inputValue) return items;
    const query = inputValue.toLowerCase();
    return items.filter((family) => family.toLowerCase().includes(query));
  }, [items, inputValue]);

  // Build a lookup map for category grouping
  const fontCategoryMap = useMemo(() => {
    const map = new Map<string, SystemFont["category"]>();
    for (const font of fonts) {
      map.set(font.family, font.category);
    }
    return map;
  }, [fonts]);

  // Group filtered items by category
  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: filteredItems.filter((family) => fontCategoryMap.get(family) === category),
    })).filter((group) => group.items.length > 0);
  }, [filteredItems, fontCategoryMap]);

  // Check if current value is non-monospace in terminal mode
  const selectedCategory = fontCategoryMap.get(value);
  const showMonospaceWarning =
    filterMonospace && selectedCategory && selectedCategory !== "monospace";

  const handleValueChange = useCallback(
    (newValue: string | null) => {
      if (typeof newValue === "string") {
        onChange(newValue);
      }
    },
    [onChange],
  );

  return (
    <div className="w-full sm:w-64">
      <Combobox
        items={items}
        filteredItems={filteredItems}
        value={value}
        onValueChange={handleValueChange}
        onInputValueChange={(v) => setInputValue(v)}
      >
        <ComboboxInput
          placeholder={isLoading ? "Loading fonts..." : "Select font..."}
          size="default"
        />
        <ComboboxPopup sideOffset={4} align="end">
          <ComboboxList className="max-h-64">
            {grouped.map((group) => (
              <ComboboxGroup key={group.category}>
                <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                {group.items.map((family) => (
                  <ComboboxItem key={family} value={family}>
                    <span style={{ fontFamily: `"${family}"` }}>{family}</span>
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            ))}
            <ComboboxEmpty>No matching fonts found</ComboboxEmpty>
          </ComboboxList>
          {filterMonospace && (
            <button
              type="button"
              className="w-full border-t border-border/60 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                setShowAllFonts((prev) => !prev);
              }}
            >
              {showAllFonts ? "Show monospace only" : "Show all fonts"}
            </button>
          )}
        </ComboboxPopup>
      </Combobox>
      {showMonospaceWarning && (
        <p className="mt-1 text-xs text-warning">
          Not monospace — may cause display issues in terminal
        </p>
      )}
    </div>
  );
}
