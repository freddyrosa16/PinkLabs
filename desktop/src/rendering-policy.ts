// Automatic requests from repository content are restricted separately from
// links the user deliberately opens in their browser.
const githubImageHosts = new Set([
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
  "camo.githubusercontent.com",
  "avatars.githubusercontent.com",
]);

export function webContentUrl(
  value: string | undefined,
  base?: string,
): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, base);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function githubImageUrl(
  value: string | undefined,
  base?: string,
  avatar = false,
): string | null {
  const resolved = webContentUrl(value, base);
  if (!resolved) return null;
  const url = new URL(resolved);
  if (
    url.protocol !== "https:" ||
    url.port ||
    (avatar
      ? url.hostname !== "avatars.githubusercontent.com"
      : !githubImageHosts.has(url.hostname))
  )
    return null;
  return url.href;
}
