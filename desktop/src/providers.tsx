import type { Provider } from "./types";

export const providers: { id: Provider; name: string; asset: string }[] = [
  { id: "claude", name: "Claude", asset: "claude-color.svg" },
  { id: "openai", name: "OpenAI / Codex", asset: "openai.svg" },
  { id: "grok", name: "Grok", asset: "grok.svg" },
];
export function ProviderIcon({ provider }: { provider: Provider }) {
  const p = providers.find((p) => p.id === provider)!;
  return (
    <img
      className={`provider-icon ${provider === "claude" ? "" : "monochrome"}`}
      src={`./providers/${p.asset}`}
      alt={p.name}
    />
  );
}
