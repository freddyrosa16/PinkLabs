import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon } from "@primer/octicons-react";
import "./composer-picker.css";

interface ComposerPickerProps {
  label: string;
  value: string;
  options: {
    value: string;
    label: string;
    icon?: ReactNode;
    description?: string;
  }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  align?: "left" | "right";
}

interface MenuPosition {
  left: number;
  bottom: number;
  width: number;
  maxHeight: number;
}

export function ComposerPicker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  align = "left",
}: ComposerPickerProps) {
  const id = useId();
  const menuId = `${id}-options`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const optionElements = useRef<(HTMLDivElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === activeValue),
  );
  const unavailable = disabled || !options.length;
  const expanded = open && !unavailable;
  const selectedLabel = selected?.label || value || "Choose";

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function openMenu(fallback: "first" | "last" = "first") {
    if (unavailable) return;
    const index =
      selectedIndex >= 0
        ? selectedIndex
        : fallback === "last"
          ? options.length - 1
          : 0;
    setActiveValue(options[index].value);
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || unavailable) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (unavailable || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Tab") {
      close();
      return; // Focus is still on the trigger, so normal Tab order is preserved.
    }
    if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else openMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home" || event.key === "End") {
      setActiveValue(
        options[event.key === "Home" ? 0 : options.length - 1].value,
      );
      setOpen(true);
    } else if (!expanded) openMenu(event.key === "ArrowUp" ? "last" : "first");
    else {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveValue(
        options[(activeIndex + step + options.length) % options.length].value,
      );
    }
  }

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  useLayoutEffect(() => {
    if (!expanded) return;
    function measure() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const inset = 12;
      const width = Math.min(
        320,
        Math.max(240, rect.width),
        window.innerWidth - inset * 2,
      );
      const idealLeft = align === "right" ? rect.right - width : rect.left;
      const left = Math.max(
        inset,
        Math.min(idealLeft, window.innerWidth - width - inset),
      );
      const bottom = Math.max(
        inset,
        Math.min(window.innerHeight - rect.top + 8, window.innerHeight - inset),
      );
      const maxHeight = Math.max(
        0,
        Math.min(320, window.innerHeight - bottom - inset),
      );
      setPosition((previous) =>
        previous?.left === left &&
        previous.bottom === bottom &&
        previous.width === width &&
        previous.maxHeight === maxHeight
          ? previous
          : { left, bottom, width, maxHeight },
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [expanded, align]);

  useLayoutEffect(() => {
    if (!expanded || !position) return;
    const option = optionElements.current[activeIndex];
    const list = menu.current;
    if (!option || !list) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }, [expanded, activeIndex, position]);

  useEffect(() => {
    if (!expanded) return;
    function dismissOutside(event: Event) {
      const target = event.target;
      if (
        target instanceof Node &&
        !trigger.current?.contains(target) &&
        !menu.current?.contains(target)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [expanded]);

  return (
    <div className="composer-picker">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="composer-picker-trigger"
        aria-label={`${label}: ${selectedLabel}`}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? menuId : undefined}
        aria-activedescendant={
          expanded ? `${id}-option-${activeIndex}` : undefined
        }
        disabled={unavailable}
        title={
          disabled
            ? `${label} is fixed for this conversation: ${selectedLabel}`
            : !options.length
              ? `No ${label.toLowerCase()} choices are available`
              : `${label}: ${selectedLabel}`
        }
        onKeyDown={onKeyDown}
        onClick={() => (expanded ? close() : openMenu())}
      >
        {selected?.icon && (
          <span className="composer-picker-icon" aria-hidden="true">
            {selected.icon}
          </span>
        )}
        <span className="composer-picker-value">{selectedLabel}</span>
        {!disabled && (
          <ChevronDownIcon className="composer-picker-chevron" size={12} />
        )}
      </button>
      {expanded &&
        position &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="listbox"
            aria-label={label}
            className="composer-picker-menu"
            style={position}
          >
            {options.map((option, index) => (
              <div
                ref={(element) => {
                  optionElements.current[index] = element;
                }}
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-label={option.label}
                aria-describedby={
                  option.description ? `${id}-description-${index}` : undefined
                }
                className={`composer-picker-option${index === activeIndex ? " is-active" : ""}`}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse") event.preventDefault();
                }}
                onPointerMove={() => setActiveValue(option.value)}
                onClick={() => choose(index)}
              >
                <span className="composer-picker-icon" aria-hidden="true">
                  {option.icon}
                </span>
                <span className="composer-picker-option-text">
                  <span className="composer-picker-option-label">
                    {option.label}
                  </span>
                  {option.description && (
                    <span
                      id={`${id}-description-${index}`}
                      className="composer-picker-description"
                    >
                      {option.description}
                    </span>
                  )}
                </span>
                <span className="composer-picker-check" aria-hidden="true">
                  {option.value === value && <CheckIcon size={15} />}
                </span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
