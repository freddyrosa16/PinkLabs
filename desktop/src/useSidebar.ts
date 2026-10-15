import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  clampSidebarWidth,
  MIN_SIDEBAR_WIDTH,
  readSidebarPreference,
  settleSidebarWidth,
  sidebarMaxWidth,
  SIDEBAR_STORAGE_KEY,
} from "./sidebar-layout";

export function useSidebar() {
  const [preference, setPreference] = useState(() => {
    try {
      return readSidebarPreference(localStorage.getItem(SIDEBAR_STORAGE_KEY));
    } catch {
      return readSidebarPreference(null);
    }
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{
    id: number;
    startX: number;
    startWidth: number;
    width: number;
    contentFloor: number;
    target: HTMLDivElement;
  } | null>(null);
  const mobile = viewport <= 620;
  const expandedWidth = clampSidebarWidth(preference.width, viewport);
  const width = dragWidth ?? (preference.collapsed ? 0 : expandedWidth);

  function endCapture() {
    const current = gesture.current;
    gesture.current = null;
    setDragWidth(null);
    if (current?.target.hasPointerCapture(current.id)) {
      current.target.releasePointerCapture(current.id);
    }
  }
  useEffect(() => {
    const resize = () => {
      endCapture();
      setViewport(window.innerWidth);
    };
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        endCapture();
      }
    };
    const blur = () => endCapture();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", blur);
      const current = gesture.current;
      gesture.current = null;
      if (current?.target.hasPointerCapture(current.id))
        current.target.releasePointerCapture(current.id);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(preference));
    } catch {
      /* Resizing still works when browser storage is unavailable. */
    }
  }, [preference]);
  useEffect(() => {
    if (mobile) return;
    if (
      preference.collapsed &&
      sidebarRef.current?.contains(document.activeElement)
    ) {
      restoreRef.current?.focus({ preventScroll: true });
    } else if (
      !preference.collapsed &&
      document.activeElement === restoreRef.current
    ) {
      toggleRef.current?.focus({ preventScroll: true });
    }
  }, [preference.collapsed, mobile]);

  function setCollapsed(collapsed: boolean) {
    endCapture();
    setPreference((previous) => ({ ...previous, collapsed }));
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (mobile || event.button !== 0 || !event.isPrimary || gesture.current)
      return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const startWidth = frameRef.current?.getBoundingClientRect().width ?? width;
    const startContentWidth =
      sidebarRef.current?.getBoundingClientRect().width ?? expandedWidth;
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      // Preserve content geometry when grabbing an in-flight slide.
      contentFloor:
        startWidth < startContentWidth - 1
          ? startContentWidth
          : MIN_SIDEBAR_WIDTH,
      target: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragWidth(startWidth);
  }
  function updatePointer(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    current.width = Math.min(
      sidebarMaxWidth(window.innerWidth),
      Math.max(0, current.startWidth + event.clientX - current.startX),
    );
    setDragWidth(current.width);
    return current.width;
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const latest = updatePointer(event);
    if (latest === undefined) return;
    const settled = settleSidebarWidth(latest, window.innerWidth);
    endCapture();
    setPreference((previous) => ({
      width: settled || previous.width,
      collapsed: settled === 0,
    }));
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next =
          width <= MIN_SIDEBAR_WIDTH
            ? 0
            : Math.max(MIN_SIDEBAR_WIDTH, width - 16);
        break;
      case "ArrowRight":
        next = preference.collapsed ? expandedWidth : width + 16;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = sidebarMaxWidth(viewport);
        break;
      case "Enter":
        next = preference.collapsed ? expandedWidth : 0;
        break;
      default:
        return;
    }
    event.preventDefault();
    endCapture();
    setPreference((previous) => ({
      width: next ? clampSidebarWidth(next, viewport) : previous.width,
      collapsed: next === 0,
    }));
  }
  return {
    width,
    contentWidth:
      dragWidth === null
        ? expandedWidth
        : Math.max(gesture.current?.contentFloor ?? MIN_SIDEBAR_WIDTH, width),
    collapsed: preference.collapsed,
    dragging: dragWidth !== null,
    mobile,
    maxWidth: sidebarMaxWidth(viewport),
    setCollapsed,
    frameRef,
    sidebarRef,
    restoreRef,
    toggleRef,
    resizeProps: {
      onPointerDown,
      onPointerMove: updatePointer,
      onPointerUp,
      onPointerCancel: endCapture,
      onLostPointerCapture: endCapture,
      onKeyDown,
    },
  };
}
