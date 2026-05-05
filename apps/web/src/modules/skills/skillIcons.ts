import {
  BookOpenIcon,
  BugIcon,
  CodeIcon,
  FlameIcon,
  FlaskConicalIcon,
  MessageCircleIcon,
  PaletteIcon,
  RocketIcon,
  SearchIcon,
  ShieldIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import type { SkillIcon } from "@fenrir/contracts";

export const SKILL_ICONS: Record<SkillIcon, LucideIcon> = {
  default: ZapIcon,
  flame: FlameIcon,
  search: SearchIcon,
  code: CodeIcon,
  bug: BugIcon,
  test: FlaskConicalIcon,
  docs: BookOpenIcon,
  security: ShieldIcon,
  deploy: RocketIcon,
  design: PaletteIcon,
  chat: MessageCircleIcon,
};

/** Returns the lucide icon for a skill's icon field, defaulting to ZapIcon. */
export function getSkillIcon(icon: SkillIcon | undefined): LucideIcon {
  return (icon != null ? SKILL_ICONS[icon] : undefined) ?? ZapIcon;
}
