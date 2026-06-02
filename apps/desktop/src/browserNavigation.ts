import * as Path from "node:path";
import { pathToFileURL } from "node:url";

const FILE_URL_PATTERN = /^file:/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;
const ABOUT_URL_PATTERN = /^about:/i;

function isAbsoluteFileSystemPath(value: string): boolean {
  return Path.isAbsolute(value);
}

export function normalizeBrowserNavigationUrl(rawUrl: string): string {
  const target = rawUrl.trim();
  if (!target) {
    return "about:blank";
  }

  if (FILE_URL_PATTERN.test(target)) {
    return new URL(target).toString();
  }

  if (ABOUT_URL_PATTERN.test(target) || HTTP_URL_PATTERN.test(target)) {
    return target;
  }

  if (isAbsoluteFileSystemPath(target)) {
    return pathToFileURL(Path.resolve(target)).toString();
  }

  return `http://${target}`;
}
