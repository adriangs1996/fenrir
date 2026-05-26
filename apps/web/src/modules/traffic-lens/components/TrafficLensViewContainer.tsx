import {
  BatteryFullIcon,
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  Grid2x2Icon,
  HouseIcon,
  LockIcon,
  RotateCwIcon,
  SearchIcon,
  Share2Icon,
  SignalHighIcon,
  WifiIcon,
} from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";
import { cn } from "~/lib/utils";
import { useTrafficLensBounds } from "../hooks/useTrafficLensBounds";
import {
  getTrafficLensMobilePreset,
  type TrafficLensMobilePresetDefinition,
} from "../mobilePresets";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

function getMobileChromeLabel(url: string): string {
  if (!url) {
    return "about:blank";
  }

  try {
    const parsed = new URL(url);
    return parsed.host || parsed.href;
  } catch {
    return url;
  }
}

function DeviceStage(props: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 w-full flex-1 overflow-auto bg-[radial-gradient(circle_at_18%_12%,rgba(92,224,255,0.09),transparent_22%),radial-gradient(circle_at_84%_88%,rgba(255,194,102,0.08),transparent_24%),linear-gradient(180deg,#0c0d10_0%,#141922_44%,#0b0d12_100%)]">
      <div className="flex min-h-full w-full items-start justify-center px-8 py-10">
        {props.children}
      </div>
    </div>
  );
}

function StatusCluster(props: { tone?: "light" | "dark" }) {
  const toneClass = props.tone === "dark" ? "text-[#121826]" : "text-white";
  return (
    <div className={cn("flex items-center gap-1.5", toneClass)}>
      <SignalHighIcon className="h-4 w-4" />
      <WifiIcon className="h-4 w-4" />
      <BatteryFullIcon className="h-4 w-4" />
    </div>
  );
}

function UrlPill(props: {
  label: string;
  tone?: "light" | "dark";
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const light = props.tone === "light";
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-3 rounded-[1.15rem] px-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]",
        light
          ? "bg-white text-[#202531] shadow-[0_16px_42px_rgba(15,23,42,0.1)]"
          : "bg-[#1b1d23] text-white/88",
      )}
    >
      {props.leading}
      <div className="min-w-0 flex-1 truncate text-center text-[0.92rem] font-medium">
        {props.label}
      </div>
      {props.trailing}
    </div>
  );
}

function ScreenViewport(props: {
  viewportRef: RefObject<HTMLDivElement | null>;
  preset: TrafficLensMobilePresetDefinition;
  className?: string;
}) {
  return (
    <div
      ref={props.viewportRef}
      className={cn(
        "overflow-hidden ring-1 ring-black/45 shadow-[0_22px_60px_rgba(0,0,0,0.28)]",
        props.className,
      )}
      style={{
        width: props.preset.screenWidth,
        height: props.preset.screenHeight,
      }}
    />
  );
}

function IosPhoneHardware() {
  return (
    <>
      <div className="absolute -left-[0.32rem] top-[20%] h-[11%] w-[0.22rem] rounded-full bg-white/35" />
      <div className="absolute -left-[0.32rem] top-[34.5%] h-[7.2%] w-[0.22rem] rounded-full bg-white/35" />
      <div className="absolute -left-[0.32rem] top-[43.5%] h-[7.2%] w-[0.22rem] rounded-full bg-white/35" />
      <div className="absolute -right-[0.32rem] top-[31%] h-[15%] w-[0.22rem] rounded-full bg-white/30" />
    </>
  );
}

function IosPhoneShell(props: {
  preset: TrafficLensMobilePresetDefinition;
  viewportRef: RefObject<HTMLDivElement | null>;
  label: string;
}) {
  return (
    <div
      className="relative max-w-full flex-none"
      style={{ width: props.preset.shellWidth, height: props.preset.shellHeight }}
    >
      <div className="absolute inset-0 rounded-[3.75rem] bg-[linear-gradient(135deg,#11161e_0%,#687385_14%,#0e1218_28%,#b6c0cf_49%,#11161f_67%,#798597_86%,#0a0d12_100%)] shadow-[0_52px_160px_rgba(0,0,0,0.52)]" />
      <div className="absolute inset-[0.28rem] rounded-[3.55rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.03)_18%,rgba(255,255,255,0)_35%)] opacity-70" />
      <IosPhoneHardware />

      <div className="absolute inset-[0.65rem] rounded-[3.15rem] bg-[#030405] p-[0.72rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
        <div className="flex h-full flex-col overflow-hidden rounded-[2.7rem] bg-[#020203]">
          <div className="relative flex h-[4.55rem] flex-none items-end justify-between bg-black px-8 pb-3 text-white">
            <span className="text-[1.95rem] font-semibold tracking-[-0.06em]">9:41</span>
            <StatusCluster />
            <div className="pointer-events-none absolute inset-x-0 top-2.5 flex justify-center">
              <div className="flex h-[2.28rem] w-[9.3rem] items-center justify-center rounded-full bg-[#0b0b0d] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
                <div className="h-[0.32rem] w-[4.2rem] rounded-full bg-white/10" />
              </div>
            </div>
          </div>

          <div className="bg-black px-[0.42rem] pb-[0.38rem]">
            <ScreenViewport
              viewportRef={props.viewportRef}
              preset={props.preset}
              className="rounded-[2.2rem] bg-white"
            />
          </div>

          <div className="flex flex-none flex-col bg-[#0a0c10] px-4 pb-3 pt-3.5 text-white">
            <div className="rounded-[1.5rem] bg-[linear-gradient(180deg,#14171d_0%,#11141b_100%)] px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_18px_50px_rgba(0,0,0,0.35)]">
              <UrlPill
                label={props.label}
                leading={<span className="text-[1.65rem] leading-none text-white/72">Aa</span>}
                trailing={<RotateCwIcon className="h-4.5 w-4.5 text-white/72" />}
              />
              <div className="mt-3 flex items-center justify-between px-2 text-white/88">
                <ChevronLeftIcon className="h-6 w-6" />
                <ChevronRightIcon className="h-6 w-6" />
                <Share2Icon className="h-5.5 w-5.5" />
                <BookmarkIcon className="h-5.5 w-5.5" />
                <Grid2x2Icon className="h-5.5 w-5.5" />
              </div>
            </div>
            <div className="mt-3 flex justify-center">
              <div className="h-1.5 w-[32%] rounded-full bg-white/70" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AndroidPhoneShell(props: {
  preset: TrafficLensMobilePresetDefinition;
  viewportRef: RefObject<HTMLDivElement | null>;
  label: string;
}) {
  return (
    <div
      className="relative max-w-full flex-none"
      style={{ width: props.preset.shellWidth, height: props.preset.shellHeight }}
    >
      <div className="absolute inset-0 rounded-[3.25rem] bg-[linear-gradient(180deg,#11141a_0%,#1f2530_16%,#0a0d12_50%,#222832_84%,#10131a_100%)] shadow-[0_50px_155px_rgba(0,0,0,0.52)]" />
      <div className="absolute inset-[0.55rem] rounded-[2.85rem] bg-[#040608] p-[0.58rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
        <div className="flex h-full flex-col overflow-hidden rounded-[2.4rem] bg-[#0c1014]">
          <div className="relative flex h-[3.2rem] flex-none items-end justify-between bg-[#090c10] px-6 pb-2.5 text-white">
            <span className="text-[0.98rem] font-medium tracking-[0.02em]">9:41</span>
            <StatusCluster />
            <div className="absolute inset-x-0 top-2.5 flex justify-center">
              <div className="h-3.5 w-3.5 rounded-full bg-black shadow-[0_0_0_3px_#11161c]" />
            </div>
          </div>

          <div className="flex h-[4.9rem] flex-none items-center bg-[linear-gradient(180deg,#12171d_0%,#0e1218_100%)] px-4.5 text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.05)]">
            <UrlPill
              label={props.label}
              leading={<SearchIcon className="h-4.5 w-4.5 text-white/64" />}
              trailing={<EllipsisIcon className="h-4.5 w-4.5 text-white/72" />}
            />
          </div>

          <div className="bg-[#090c11] px-[0.32rem] py-[0.32rem]">
            <ScreenViewport
              viewportRef={props.viewportRef}
              preset={props.preset}
              className="rounded-[2rem] bg-white"
            />
          </div>

          <div className="flex flex-none flex-col bg-[#0b0f15] px-7 pb-4 pt-3 text-white">
            <div className="flex items-center justify-between text-white/78">
              <ChevronLeftIcon className="h-6 w-6" />
              <HouseIcon className="h-5.5 w-5.5" />
              <Grid2x2Icon className="h-5.5 w-5.5" />
            </div>
            <div className="mt-3 flex justify-center">
              <div className="h-1.5 w-[26%] rounded-full bg-white/56" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IosTabletShell(props: {
  preset: TrafficLensMobilePresetDefinition;
  viewportRef: RefObject<HTMLDivElement | null>;
  label: string;
}) {
  return (
    <div
      className="relative max-w-full flex-none"
      style={{ width: props.preset.shellWidth, height: props.preset.shellHeight }}
    >
      <div className="absolute inset-0 rounded-[3.5rem] bg-[linear-gradient(135deg,#11161c_0%,#bdc7d6_17%,#1a2027_31%,#edf2f8_52%,#151a21_73%,#8d99a8_100%)] shadow-[0_52px_160px_rgba(0,0,0,0.48)]" />
      <div className="absolute inset-[0.65rem] rounded-[3.05rem] bg-[#070b10] p-[0.75rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
        <div className="flex h-full flex-col overflow-hidden rounded-[2.55rem] bg-[#eef2f7]">
          <div className="flex h-[5.4rem] flex-none items-center gap-5 bg-[linear-gradient(180deg,#eef2f7_0%,#e7ebf2_100%)] px-6 text-[#101826] shadow-[inset_0_-1px_0_rgba(16,24,38,0.08)]">
            <span className="text-[0.96rem] font-semibold tracking-[0.14em] uppercase">
              Simulator
            </span>
            <div className="min-w-0 flex-1">
              <UrlPill
                label={props.label}
                tone="light"
                leading={<LockIcon className="h-4.5 w-4.5 text-slate-500" />}
                trailing={<RotateCwIcon className="h-4.5 w-4.5 text-slate-500" />}
              />
            </div>
            <StatusCluster tone="dark" />
          </div>

          <div className="bg-[#e9edf4] px-[0.34rem] py-[0.34rem]">
            <ScreenViewport
              viewportRef={props.viewportRef}
              preset={props.preset}
              className="rounded-[2rem] bg-white"
            />
          </div>

          <div className="flex flex-none items-center justify-between bg-[linear-gradient(180deg,#e8edf4_0%,#e4e9f2_100%)] px-7 pb-3.5 pt-3 text-[#425066] shadow-[inset_0_1px_0_rgba(16,24,38,0.08)]">
            <div className="flex items-center gap-4">
              <ChevronLeftIcon className="h-6 w-6" />
              <ChevronRightIcon className="h-6 w-6" />
            </div>
            <div className="h-1.5 w-[18%] rounded-full bg-slate-400/55" />
            <div className="flex items-center gap-4">
              <Share2Icon className="h-5.5 w-5.5" />
              <CopyIcon className="h-5.5 w-5.5" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TrafficLensViewContainer() {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const activeTab = useTrafficLensStore((s) => (s.activeTabId ? s.tabs[s.activeTabId] : null));
  const viewportRef = useRef<HTMLDivElement>(null);

  useTrafficLensBounds(viewportRef);

  if (!activeTabId || !activeTab) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        No tab selected. Open a new tab from the sidebar.
      </div>
    );
  }

  const mobileMode = (activeTab.viewMode ?? "desktop") === "mobile";
  const mobileChromeLabel = getMobileChromeLabel(activeTab.url);
  const mobilePreset = getTrafficLensMobilePreset(activeTab.mobilePreset);

  if (!mobileMode) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0)_18%)]">
        <div ref={viewportRef} className="h-full min-h-0 w-full flex-1" />
      </div>
    );
  }

  return (
    <DeviceStage>
      {mobilePreset.shellKind === "ios-phone" ? (
        <IosPhoneShell preset={mobilePreset} viewportRef={viewportRef} label={mobileChromeLabel} />
      ) : mobilePreset.shellKind === "android-phone" ? (
        <AndroidPhoneShell
          preset={mobilePreset}
          viewportRef={viewportRef}
          label={mobileChromeLabel}
        />
      ) : (
        <IosTabletShell preset={mobilePreset} viewportRef={viewportRef} label={mobileChromeLabel} />
      )}
    </DeviceStage>
  );
}
