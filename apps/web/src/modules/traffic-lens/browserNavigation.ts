const HTTP_URL_PATTERN = /^https?:\/\//i;
const FILE_URL_PATTERN = /^file:/i;
const ABOUT_URL_PATTERN = /^about:/i;
const POSIX_ABSOLUTE_PATH_PATTERN = /^\//;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/;

function isAbsoluteFileSystemPath(value: string): boolean {
  return (
    POSIX_ABSOLUTE_PATH_PATTERN.test(value) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) ||
    WINDOWS_UNC_PATH_PATTERN.test(value)
  );
}

export function normalizeBrowserAddressInput(rawInput: string): string | null {
  const target = rawInput.trim();
  if (!target) {
    return null;
  }

  if (
    HTTP_URL_PATTERN.test(target) ||
    FILE_URL_PATTERN.test(target) ||
    ABOUT_URL_PATTERN.test(target) ||
    isAbsoluteFileSystemPath(target)
  ) {
    return target;
  }

  return `http://${target}`;
}
