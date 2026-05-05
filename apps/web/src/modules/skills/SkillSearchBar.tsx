import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

interface SkillSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SkillSearchBar({ value, onChange }: SkillSearchBarProps) {
  const [inputValue, setInputValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync when external value resets (e.g., view change clears the query).
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setInputValue(next);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), 150);
  };

  const handleClear = () => {
    setInputValue("");
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    onChange("");
  };

  return (
    <div className="relative flex items-center">
      <SearchIcon className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-muted-foreground/60" />
      <input
        type="text"
        value={inputValue}
        onChange={handleChange}
        placeholder="Search skills..."
        className={cn(
          "h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-7 text-sm",
          "text-foreground placeholder:text-muted-foreground/60",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
          "transition-shadow",
        )}
      />
      {inputValue.length > 0 && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 text-muted-foreground/60 hover:text-foreground"
          aria-label="Clear search"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
