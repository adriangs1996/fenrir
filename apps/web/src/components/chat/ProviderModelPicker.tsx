import { type ProviderSelectionKind, type ServerProvider } from "@fenrir/contracts";
import { resolveSelectableModel } from "@fenrir/shared/model";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
import { Clock3Icon, SearchIcon, StarIcon } from "lucide-react";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { ClaudeAI, CursorIcon, Gemini, Icon, OpenAI, OpenCodeIcon } from "../Icons";
import { cn } from "~/lib/utils";
import {
  getProviderOptionLabel,
  getProviderSnapshot,
  getSelectableProviderKinds,
} from "../../providerModels";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import {
  providerModelKey,
  searchProviderModelPickerItems,
  splitProviderModelPickerSection,
  type ModelPickerSection,
  type ProviderModelPickerItem,
} from "./ProviderModelPicker.logic";

const PROVIDER_ICON_BY_PROVIDER: Record<string, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  opencode: OpenCodeIcon,
  cursor: CursorIcon,
  gemini: Gemini,
};

const COMING_SOON_PROVIDER_OPTIONS = [
  { id: "cursor", label: "Cursor", icon: CursorIcon },
  { id: "gemini", label: "Gemini", icon: Gemini },
] as const;

const SELECTED_SIDEBAR_BUTTON_CLASS = "bg-background text-foreground shadow-sm";
const SELECTED_SIDEBAR_INDICATOR_CLASS =
  "pointer-events-none absolute -right-1 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary";
const SIDEBAR_TOOLTIP_CLASS = "max-w-64 text-balance font-normal leading-snug";

function providerIconClassName(
  provider: ProviderSelectionKind | string,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}

function getProviderIcon(provider: ProviderSelectionKind | string): Icon {
  return PROVIDER_ICON_BY_PROVIDER[provider] ?? OpenAI;
}

function describeProviderAvailability(provider: ServerProvider | undefined): string | null {
  if (!provider) {
    return null;
  }
  if (provider.availability === "unavailable") {
    return provider.unavailableReason ?? "Unavailable in this Fenrir build";
  }
  if (!provider.enabled) {
    return "Disabled";
  }
  if (!provider.installed) {
    return "Not installed";
  }
  if (provider.status !== "ready") {
    return "Unavailable";
  }
  return null;
}

function sortFavoriteItems(
  items: ReadonlyArray<ProviderModelPickerItem>,
  favoriteOrder: ReadonlyMap<string, number>,
): ProviderModelPickerItem[] {
  return [...items].toSorted((a, b) => {
    const aOrder =
      favoriteOrder.get(providerModelKey(a.provider, a.slug)) ?? Number.MAX_SAFE_INTEGER;
    const bOrder =
      favoriteOrder.get(providerModelKey(b.provider, b.slug)) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    const providerDelta = a.providerLabel.localeCompare(b.providerLabel);
    if (providerDelta !== 0) {
      return providerDelta;
    }
    return a.name.localeCompare(b.name);
  });
}

function sortStandardItems(
  items: ReadonlyArray<ProviderModelPickerItem>,
): ProviderModelPickerItem[] {
  return [...items].toSorted((a, b) => a.name.localeCompare(b.name));
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderSelectionKind;
  model: string;
  lockedProvider: ProviderSelectionKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<
    string,
    ReadonlyArray<{
      slug: string;
      name: string;
      shortName?: string | undefined;
      subProvider?: string | undefined;
    }>
  >;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onProviderModelChange: (provider: ProviderSelectionKind, model: string) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const favorites = useSettings((settings) => settings.favorites ?? []);
  const { updateSettings } = useUpdateSettings();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const activeProvider = props.lockedProvider ?? props.provider;
  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider] ?? [];
  const selectedModelOption = selectedProviderOptions.find((option) => option.slug === props.model);
  const selectedModelLabel =
    selectedModelOption?.shortName ?? selectedModelOption?.name ?? props.model;
  const selectedModelSubtitle = selectedModelOption?.subProvider;
  const ProviderIcon = getProviderIcon(activeProvider);

  const [selectedSection, setSelectedSection] = useState<ModelPickerSection>(
    () => props.lockedProvider ?? (favorites.length > 0 ? "favorites" : activeProvider),
  );

  useEffect(() => {
    if (props.lockedProvider !== null) {
      setSelectedSection(props.lockedProvider);
      return;
    }
    setSelectedSection((current) => {
      if (current === "favorites" || current === props.provider) {
        return current;
      }
      return props.provider;
    });
  }, [props.lockedProvider, props.provider]);

  useEffect(() => {
    if (!isMenuOpen) {
      setSearchQuery("");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isMenuOpen]);

  const favoriteKeySet = useMemo(
    () => new Set(favorites.map((favorite) => providerModelKey(favorite.provider, favorite.model))),
    [favorites],
  );
  const favoriteOrder = useMemo(
    () =>
      new Map(
        favorites.map((favorite, index) => [
          providerModelKey(favorite.provider, favorite.model),
          index,
        ]),
      ),
    [favorites],
  );

  const availableProviders = useMemo(
    () =>
      props.providers && props.providers.length > 0
        ? getSelectableProviderKinds(props.providers).filter(
            (provider) => (props.modelOptionsByProvider[provider] ?? []).length > 0,
          )
        : Object.keys(props.modelOptionsByProvider),
    [props.modelOptionsByProvider, props.providers],
  );

  const availableModelItems = useMemo<ProviderModelPickerItem[]>(() => {
    return availableProviders.flatMap((provider) => {
      const liveProvider = props.providers
        ? getProviderSnapshot(props.providers, provider)
        : undefined;
      if (liveProvider && describeProviderAvailability(liveProvider) !== null) {
        return [];
      }
      return (props.modelOptionsByProvider[provider] ?? []).map((modelOption) => {
        const item: ProviderModelPickerItem = {
          provider,
          providerLabel: getProviderOptionLabel(props.providers ?? [], provider),
          slug: modelOption.slug,
          name: modelOption.name,
          isFavorite: favoriteKeySet.has(providerModelKey(provider, modelOption.slug)),
        };
        if (modelOption.shortName) {
          item.shortName = modelOption.shortName;
        }
        if (modelOption.subProvider) {
          item.subProvider = modelOption.subProvider;
        }
        return item;
      });
    });
  }, [availableProviders, favoriteKeySet, props.modelOptionsByProvider, props.providers]);

  const isSearching = searchQuery.trim().length > 0;
  const sectionGroups = useMemo(
    () =>
      splitProviderModelPickerSection(
        availableModelItems,
        props.lockedProvider ?? selectedSection,
        props.lockedProvider,
      ),
    [availableModelItems, props.lockedProvider, selectedSection],
  );
  const searchResults = useMemo(
    () => searchProviderModelPickerItems(availableModelItems, searchQuery, props.lockedProvider),
    [availableModelItems, props.lockedProvider, searchQuery],
  );

  const visibleFavorites = useMemo(
    () => sortFavoriteItems(sectionGroups.favorites, favoriteOrder),
    [favoriteOrder, sectionGroups.favorites],
  );
  const visibleModels = useMemo(
    () => sortStandardItems(sectionGroups.models),
    [sectionGroups.models],
  );

  const showSidebar = props.lockedProvider === null && !isSearching;

  const handleModelChange = (provider: ProviderSelectionKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    const options = props.modelOptionsByProvider[provider] ?? [];
    const resolvedModel = resolveSelectableModel(provider, value, options);
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    setIsMenuOpen(false);
  };

  const toggleFavorite = (provider: ProviderSelectionKind, model: string) => {
    const existing = favorites.findIndex(
      (favorite) => favorite.provider === provider && favorite.model === model,
    );
    if (existing >= 0) {
      updateSettings({
        favorites: favorites.filter(
          (favorite) => !(favorite.provider === provider && favorite.model === model),
        ),
      });
      return;
    }
    updateSettings({
      favorites: [...favorites, { provider, model }],
    });
  };

  const renderedRows = isSearching
    ? searchResults
    : selectedSection === "favorites"
      ? visibleFavorites
      : [...visibleFavorites, ...visibleModels];

  return (
    <TooltipProvider delay={0}>
      <Popover
        open={isMenuOpen}
        onOpenChange={(open) => {
          if (props.disabled) {
            setIsMenuOpen(false);
            return;
          }
          setIsMenuOpen(open);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              size="sm"
              variant={props.triggerVariant ?? "ghost"}
              data-chat-provider-model-picker="true"
              className={cn(
                "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
                props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
                props.triggerClassName,
              )}
              disabled={props.disabled}
            />
          }
        >
          <span
            className={cn(
              "flex min-w-0 w-full box-border items-center gap-2 overflow-hidden",
              props.compact ? "max-w-36 sm:pl-1" : undefined,
            )}
          >
            <ProviderIcon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                providerIconClassName(activeProvider, "text-muted-foreground/70"),
                props.activeProviderIconClassName,
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{selectedModelLabel}</span>
              {selectedModelSubtitle && !props.compact ? (
                <span className="block truncate text-[11px] leading-tight text-muted-foreground/65">
                  {selectedModelSubtitle}
                </span>
              ) : null}
            </span>
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
          </span>
        </PopoverTrigger>
        <PopoverPopup
          align="start"
          className="border-0 bg-transparent p-0 shadow-none before:hidden [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:p-0"
        >
          <div className="relative flex h-screen max-h-96 w-screen max-w-100 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
            {showSidebar ? (
              <ScrollArea
                hideScrollbars
                scrollFade
                className="w-12 shrink-0 border-r bg-muted/30"
                data-model-picker-sidebar="true"
              >
                <div className="flex min-h-full flex-col gap-1 p-1">
                  <div className="mb-1 border-b pb-1">
                    <SidebarSectionButton
                      label="Favorites"
                      selected={selectedSection === "favorites"}
                      onClick={() => setSelectedSection("favorites")}
                      icon={<StarIcon className="size-5 fill-current" />}
                    />
                  </div>
                  {availableProviders.map((provider) => {
                    const liveProvider = props.providers
                      ? getProviderSnapshot(props.providers, provider)
                      : undefined;
                    const availability = describeProviderAvailability(liveProvider);
                    const OptionIcon = getProviderIcon(provider);
                    const label = getProviderOptionLabel(props.providers ?? [], provider);
                    return (
                      <SidebarSectionButton
                        key={provider}
                        label={label}
                        {...(availability ? { description: availability } : {})}
                        selected={selectedSection === provider}
                        disabled={availability !== null}
                        onClick={() => setSelectedSection(provider)}
                        icon={
                          <OptionIcon
                            className={cn(
                              "size-5",
                              providerIconClassName(provider, "text-muted-foreground/85"),
                            )}
                          />
                        }
                      />
                    );
                  })}
                  <div className="mt-1 flex flex-col gap-1">
                    {COMING_SOON_PROVIDER_OPTIONS.map((option) => {
                      const OptionIcon = option.icon;
                      return (
                        <SidebarSectionButton
                          key={option.id}
                          label={option.label}
                          description="Coming soon"
                          disabled
                          icon={<OptionIcon className="size-5 text-muted-foreground/85" />}
                        />
                      );
                    })}
                  </div>
                </div>
              </ScrollArea>
            ) : null}
            <div className={cn("flex min-w-0 flex-1 flex-col", showSidebar && "border-l")}>
              {props.lockedProvider !== null && !showSidebar && !isSearching ? (
                <div className="flex items-center gap-2 border-b px-4 py-3">
                  <ProviderIcon className="size-5 shrink-0" />
                  <span className="text-sm font-medium">
                    {getProviderOptionLabel(props.providers ?? [], props.lockedProvider)}
                  </span>
                </div>
              ) : null}
              <div className="border-b px-3 py-2">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setIsMenuOpen(false);
                      }
                    }}
                    placeholder="Search models..."
                    className="h-8 rounded-md border-0 pl-9 shadow-none ring-0 focus-visible:ring-2 focus-visible:ring-primary/70"
                  />
                </div>
              </div>
              <ScrollArea className="relative min-h-0 flex-1 before:pointer-events-none before:absolute before:inset-0 before:bg-muted/40">
                <div className="relative divide-y px-2 py-1">
                  {renderedRows.length > 0 ? (
                    renderedRows.map((item, index) => (
                      <ModelPickerRow
                        key={providerModelKey(item.provider, item.slug)}
                        item={item}
                        current={props.provider === item.provider && props.model === item.slug}
                        showProviderMeta={isSearching || selectedSection === "favorites"}
                        jumpLabel={index < 9 ? `#${index + 1}` : null}
                        onSelect={handleModelChange}
                        onToggleFavorite={toggleFavorite}
                      />
                    ))
                  ) : isSearching ? (
                    <EmptyStateMessage message="No matching models." />
                  ) : selectedSection === "favorites" ? (
                    <EmptyStateMessage message="No favorite models yet." />
                  ) : (
                    <EmptyStateMessage message="No models found." />
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </TooltipProvider>
  );
});

const SidebarSectionButton = memo(function SidebarSectionButton(props: {
  label: string;
  description?: string;
  selected?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  onClick?: () => void;
}) {
  const tooltip = props.description ? `${props.label} - ${props.description}` : props.label;
  return (
    <div className="relative w-full">
      {props.selected ? <div className={SELECTED_SIDEBAR_INDICATOR_CLASS} /> : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={props.disabled}
              aria-label={props.label}
              onClick={props.onClick}
              className={cn(
                "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded transition-colors hover:bg-muted",
                props.selected
                  ? SELECTED_SIDEBAR_BUTTON_CLASS
                  : "text-muted-foreground hover:text-foreground",
                props.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              <span className="sr-only">
                {props.label}
                {props.description ? ` ${props.description}` : ""}
              </span>
              <span aria-hidden="true" className="shrink-0">
                {props.icon}
              </span>
              {props.description === "Coming soon" ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-0.5 top-0.5 z-10 flex size-3.5 items-center justify-center rounded-full bg-transparent text-muted-foreground shadow-sm"
                >
                  <Clock3Icon className="size-2" />
                </span>
              ) : null}
            </button>
          }
        />
        <TooltipPopup side="left" align="center" className={SIDEBAR_TOOLTIP_CLASS}>
          {tooltip}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});

const EmptyStateMessage = memo(function EmptyStateMessage(props: { message: string }) {
  return (
    <div className="px-3 py-6 text-center text-sm text-muted-foreground/75">{props.message}</div>
  );
});

const ModelPickerRow = memo(function ModelPickerRow(props: {
  item: ProviderModelPickerItem;
  current: boolean;
  showProviderMeta: boolean;
  jumpLabel: string | null;
  onSelect: (provider: ProviderSelectionKind, model: string) => void;
  onToggleFavorite: (provider: ProviderSelectionKind, model: string) => void;
}) {
  const ProviderIcon = getProviderIcon(props.item.provider);
  const favoriteButtonLabel = props.item.isFavorite ? "Remove from favorites" : "Add to favorites";

  return (
    <div
      data-model-picker-model={providerModelKey(props.item.provider, props.item.slug)}
      className={cn(
        "group flex items-stretch gap-1 rounded border border-transparent px-3 py-3 transition-colors",
        props.current && "bg-accent text-foreground",
      )}
    >
      <StarToggle
        isFavorite={props.item.isFavorite}
        label={favoriteButtonLabel}
        onToggle={() => props.onToggleFavorite(props.item.provider, props.item.slug)}
      />
      <button
        type="button"
        onClick={() => props.onSelect(props.item.provider, props.item.slug)}
        className={cn(
          "-my-3 flex min-w-0 flex-1 items-start rounded px-0 py-3 text-left transition-colors",
          props.current && "hover:bg-transparent",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-snug text-foreground">
            {props.item.shortName ?? props.item.name}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1 text-xs font-normal leading-snug text-muted-foreground/70">
            <ProviderIcon
              className={cn(
                "size-3 shrink-0",
                providerIconClassName(props.item.provider, "text-muted-foreground/78"),
              )}
            />
            <span className="truncate">
              {props.showProviderMeta
                ? [props.item.providerLabel, props.item.subProvider].filter(Boolean).join(" · ")
                : (props.item.subProvider ?? props.item.providerLabel)}
            </span>
          </span>
        </span>
      </button>
      {props.jumpLabel ? (
        <span className="flex h-5 min-w-9 shrink-0 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground">
          {props.jumpLabel}
        </span>
      ) : null}
    </div>
  );
});

const StarToggle = memo(function StarToggle(props: {
  isFavorite: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            role="switch"
            aria-checked={props.isFavorite}
            aria-label={props.label}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onToggle();
            }}
            className={cn(
              "mt-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/45 transition-colors hover:text-foreground",
              props.isFavorite && "text-yellow-500 hover:text-yellow-500",
            )}
          >
            <StarIcon className={cn("size-4", props.isFavorite && "fill-current")} />
          </button>
        }
      />
      <TooltipPopup side="top" align="center">
        {props.label}
      </TooltipPopup>
    </Tooltip>
  );
});
