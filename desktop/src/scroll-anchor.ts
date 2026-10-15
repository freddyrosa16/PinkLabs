export type ScrollAnchor = { restore: () => void; cancel: () => void };

/** Keep a visible control in place across one imminent React layout change. */
export function captureScrollAnchor(
  anchor: HTMLElement | null,
): ScrollAnchor | null {
  const scroller = anchor?.closest<HTMLElement>(".repo-scroll");
  if (!anchor || !scroller || !anchor.isConnected) return null;
  const viewport = scroller.getBoundingClientRect();
  const before = anchor.getBoundingClientRect();
  if (
    before.height === 0 ||
    before.bottom <= viewport.top ||
    before.top >= viewport.bottom
  )
    return null;

  let active = true;
  // A new interaction wins over restoring a previously captured position.
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  function cancel() {
    active = false;
    for (const event of events)
      scroller!.removeEventListener(event, cancel, true);
  }
  for (const event of events)
    scroller.addEventListener(event, cancel, { capture: true, passive: true });

  return {
    cancel,
    restore() {
      const shouldRestore = active;
      cancel();
      if (
        !shouldRestore ||
        !anchor.isConnected ||
        anchor.closest(".repo-scroll") !== scroller
      )
        return;
      const after = anchor.getBoundingClientRect();
      if (after.height === 0) return;
      // Measure after browser scroll anchoring, so an adjustment it already made
      // is not applied twice. Do not use smooth scrolling for a layout correction.
      const delta =
        after.top -
        scroller.getBoundingClientRect().top -
        (before.top - viewport.top);
      if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
    },
  };
}
