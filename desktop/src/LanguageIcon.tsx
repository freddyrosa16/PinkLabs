const languageAssets: Record<string, string> = {
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  html: "html",
  html5: "html",
  css: "css",
  css3: "css",
  go: "go",
  rust: "rust",
  swift: "swift",
  java: "java",
  c: "c",
  "c++": "cplusplus",
  "c#": "csharp",
  ruby: "ruby",
  kotlin: "kotlin",
  php: "php",
  shell: "shell",
  bash: "shell",
};

export function LanguageIcon({
  name,
  color,
}: {
  name: string;
  color?: string;
}) {
  const key = name.trim().toLowerCase();
  const asset = Object.hasOwn(languageAssets, key)
    ? languageAssets[key]
    : undefined;
  if (!asset) {
    return (
      <i
        className="language-dot"
        style={{ backgroundColor: color || "currentColor" }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      className="language-icon"
      src={`./languages/${asset}.svg`}
      alt=""
      aria-hidden="true"
    />
  );
}
