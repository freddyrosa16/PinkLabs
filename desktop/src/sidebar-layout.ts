export const DEFAULT_SIDEBAR_WIDTH = 230;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 340;
export const SIDEBAR_COLLAPSE_THRESHOLD = 140;
export const SIDEBAR_STORAGE_KEY = "pink-labs.sidebar.v1";

const MIN_CONTENT_WIDTH = 420;

export interface SidebarPreference {
  width: number;
  collapsed: boolean;
}

export function sidebarMaxWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return MAX_SIDEBAR_WIDTH;
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.floor(viewportWidth) - MIN_CONTENT_WIDTH),
  );
}

export function clampSidebarWidth(
  width: number,
  viewportWidth: number,
): number {
  const candidate = Number.isFinite(width)
    ? Math.floor(width)
    : DEFAULT_SIDEBAR_WIDTH;
  return Math.min(
    sidebarMaxWidth(viewportWidth),
    Math.max(MIN_SIDEBAR_WIDTH, candidate),
  );
}

export function settleSidebarWidth(
  width: number,
  viewportWidth: number,
): number {
  const candidate = Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH;
  return candidate < SIDEBAR_COLLAPSE_THRESHOLD
    ? 0
    : clampSidebarWidth(candidate, viewportWidth);
}

export function readSidebarPreference(raw: string | null): SidebarPreference {
  const fallback = { width: DEFAULT_SIDEBAR_WIDTH, collapsed: false };
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("width" in value) ||
      typeof value.width !== "number" ||
      !Number.isFinite(value.width) ||
      !("collapsed" in value) ||
      typeof value.collapsed !== "boolean"
    ) {
      return fallback;
    }
    return {
      width: clampSidebarWidth(
        value.width,
        MAX_SIDEBAR_WIDTH + MIN_CONTENT_WIDTH,
      ),
      collapsed: value.collapsed,
    };
  } catch {
    return fallback;
  }
}
