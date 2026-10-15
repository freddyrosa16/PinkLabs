import "./animated-icons.css";

// Lucide paths, pinned sources and licenses: ../THIRD_PARTY_NOTICES.md.
type AnimatedIconName =
  "pencil" | "telescope" | "pull-request" | "code" | "folder" | "refresh";

export function AnimatedIcon({
  name,
  size = 16,
}: {
  name: AnimatedIconName;
  size?: number;
}) {
  return (
    <svg
      className="animated-icon"
      data-icon={name}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "pencil" && (
        <g className="animated-icon__motion">
          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          <path d="m15 5 4 4" />
        </g>
      )}
      {name === "telescope" && (
        <>
          <g className="animated-icon__motion">
            <path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44" />
            <path d="m13.56 11.747 4.332-.924" />
            <path d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z" />
            <path d="m6.158 8.633 1.114 4.456" />
          </g>
          <path d="m16 21-3.105-6.21" />
          <path d="m8 21 3.105-6.21" />
          <circle cx="12" cy="13" r="2" />
        </>
      )}
      {name === "pull-request" && (
        <>
          <circle cx="6" cy="6" r="3" />
          <line x1="6" x2="6" y1="9" y2="21" />
          <g className="animated-icon__motion">
            <circle cx="18" cy="18" r="3" />
            <path d="M13 6h3a2 2 0 0 1 2 2v7" />
          </g>
        </>
      )}
      {name === "code" && (
        <>
          <g className="animated-icon__motion animated-icon__right">
            <path d="m16 18 6-6-6-6" />
          </g>
          <g className="animated-icon__motion animated-icon__left">
            <path d="m8 6-6 6 6 6" />
          </g>
        </>
      )}
      {name === "folder" && (
        <g className="animated-icon__motion">
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </g>
      )}
      {name === "refresh" && (
        <g className="animated-icon__motion">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </g>
      )}
    </svg>
  );
}
