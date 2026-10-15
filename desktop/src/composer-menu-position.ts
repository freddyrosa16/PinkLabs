interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

export interface ComposerMenuPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

// Keep the whole composer clear, not just the picker button inside it.
export function positionComposerMenu({
  trigger,
  composer,
  viewport,
  layoutHeight,
  menuHeight,
  align,
}: {
  trigger: Rect;
  composer: Rect;
  viewport: { top: number; left: number; width: number; height: number };
  layoutHeight: number;
  menuHeight: number;
  align: "left" | "right";
}): ComposerMenuPosition {
  const inset = 12;
  const gap = 8;
  const width = Math.max(
    0,
    Math.min(320, Math.max(240, trigger.width), viewport.width - inset * 2),
  );
  const left = Math.max(
    viewport.left + inset,
    Math.min(
      align === "right" ? trigger.right - width : trigger.left,
      viewport.left + viewport.width - inset - width,
    ),
  );
  const above = Math.max(0, composer.top - gap - viewport.top - inset);
  const below = Math.max(
    0,
    viewport.top + viewport.height - inset - composer.bottom - gap,
  );
  const desiredHeight = Math.min(320, menuHeight);
  const useBelow =
    below >= desiredHeight || (above < desiredHeight && below >= above);
  return {
    left,
    width,
    maxHeight: Math.min(320, useBelow ? below : above),
    ...(useBelow
      ? { top: composer.bottom + gap }
      : { bottom: layoutHeight - composer.top + gap }),
  };
}
