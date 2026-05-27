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

  return (
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
        className="w-[min(32rem,calc(100vw-1rem))] overflow-hidden p-0 [--viewport-inline-padding:0]"
      >
        <div className="flex h-[26rem] min-h-0 overflow-hidden">
          {showSidebar ? (
            <div
              data-model-picker-sidebar="true"
              className="flex w-40 shrink-0 flex-col gap-1 border-r bg-muted/28 p-2"
            >
              <SidebarSectionButton
                label="Favorites"
                selected={selectedSection === "favorites"}
                onClick={() => setSelectedSection("favorites")}
                icon={<StarIcon className="size-4" />}
              />
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
                          "size-4",
                          providerIconClassName(provider, "text-muted-foreground/80"),
                        )}
                      />
                    }
                  />
                );
              })}
              <div className="mt-1 border-t pt-2">
                {COMING_SOON_PROVIDER_OPTIONS.map((option) => {
                  const OptionIcon = option.icon;
                  return (
                    <SidebarSectionButton
                      key={option.id}
                      label={option.label}
                      description="Coming soon"
                      disabled
                      icon={<OptionIcon className="size-4 text-muted-foreground/80" />}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b p-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/55" />
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
                  className="pl-9"
                />
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-2">
                {props.lockedProvider !== null && !isSearching ? (
                  <SectionHeader
                    title={getProviderOptionLabel(props.providers ?? [], props.lockedProvider)}
                  />
                ) : null}
                {isSearching ? (
                  searchResults.length > 0 ? (
                    <div className="space-y-1">
                      {searchResults.map((item) => (
                        <ModelPickerRow
                          key={providerModelKey(item.provider, item.slug)}
                          item={item}
                          current={props.provider === item.provider && props.model === item.slug}
                          showProviderMeta
                          onSelect={handleModelChange}
                          onToggleFavorite={toggleFavorite}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyStateMessage message="No matching models." />
                  )
                ) : selectedSection === "favorites" && visibleFavorites.length === 0 ? (
                  <EmptyStateMessage message="No favorite models yet." />
                ) : (
                  <div className="space-y-3">
                    {visibleFavorites.length > 0 ? (
                      <section>
                        <SectionHeader title="Favorites" />
                        <div className="space-y-1">
                          {visibleFavorites.map((item) => (
                            <ModelPickerRow
                              key={providerModelKey(item.provider, item.slug)}
                              item={item}
                              current={
                                props.provider === item.provider && props.model === item.slug
                              }
                              showProviderMeta={selectedSection === "favorites"}
                              onSelect={handleModelChange}
                              onToggleFavorite={toggleFavorite}
                            />
                          ))}
                        </div>
                      </section>
                    ) : null}
                    {visibleModels.length > 0 ? (
                      <section>
                        <SectionHeader
                          title={visibleFavorites.length > 0 ? "All models" : "Models"}
                        />
                        <div className="space-y-1">
                          {visibleModels.map((item) => (
                            <ModelPickerRow
                              key={providerModelKey(item.provider, item.slug)}
                              item={item}
                              current={
                                props.provider === item.provider && props.model === item.slug
                              }
                              showProviderMeta={selectedSection === "favorites"}
                              onSelect={handleModelChange}
                              onToggleFavorite={toggleFavorite}
                            />
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
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
  return (
    <button
      type="button"
      disabled={props.disabled}
      aria-label={props.label}
      onClick={props.onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
        props.selected
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/65 hover:text-foreground",
        props.disabled &&
          "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
      )}
    >
      <span className="shrink-0">{props.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{props.label}</span>
        {props.description ? (
          <span className="block truncate text-[11px] text-muted-foreground/75">
            {props.description}
          </span>
        ) : null}
      </span>
      {props.description === "Coming soon" ? (
        <Clock3Icon className="size-3 shrink-0 text-muted-foreground/65" />
      ) : null}
    </button>
  );
});

const SectionHeader = memo(function SectionHeader(props: { title: string }) {
  return (
    <div className="px-1 pb-1.5">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        {props.title}
      </p>
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
  onSelect: (provider: ProviderSelectionKind, model: string) => void;
  onToggleFavorite: (provider: ProviderSelectionKind, model: string) => void;
}) {
  const ProviderIcon = getProviderIcon(props.item.provider);
  const favoriteButtonLabel = props.item.isFavorite ? "Remove from favorites" : "Add to favorites";

  return (
    <div
      data-model-picker-model={providerModelKey(props.item.provider, props.item.slug)}
      className={cn(
        "group flex items-stretch gap-1 rounded-md border border-transparent pr-1 transition-colors",
        props.current && "border-border bg-accent/55",
      )}
    >
      <button
        type="button"
        onClick={() => props.onSelect(props.item.provider, props.item.slug)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/50",
          props.current && "hover:bg-transparent",
        )}
      >
        <ProviderIcon
          className={cn(
            "size-4 shrink-0",
            providerIconClassName(props.item.provider, "text-muted-foreground/78"),
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{props.item.name}</span>
          <span className="block truncate text-xs text-muted-foreground/75">
            {props.showProviderMeta
              ? [props.item.providerLabel, props.item.subProvider, props.item.slug]
                  .filter(Boolean)
                  .join(" · ")
              : props.item.subProvider
                ? `${props.item.subProvider} · ${props.item.slug}`
                : props.item.slug}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={favoriteButtonLabel}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onToggleFavorite(props.item.provider, props.item.slug);
        }}
        className={cn(
          "my-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/72 transition-colors hover:bg-accent hover:text-foreground",
          props.item.isFavorite && "text-amber-500 hover:text-amber-500",
        )}
      >
        <StarIcon className={cn("size-4", props.item.isFavorite && "fill-current")} />
      </button>
    </div>
  );
});
