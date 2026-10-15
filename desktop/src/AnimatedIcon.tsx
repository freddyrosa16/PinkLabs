import "./animated-icons.css";

// Original interface drawings, plus retained Lucide PR/refresh paths.
// Pinned sources and licenses: ../THIRD_PARTY_NOTICES.md.
type AnimatedIconName =
  | "pencil"
  | "telescope"
  | "pull-request"
  | "code"
  | "folder"
  | "refresh"
  | "sidebar-close"
  | "sidebar-open";

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
        <>
          <path d="M7 4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H9l-5 3v-5a4 4 0 0 1-1-2V8a4 4 0 0 1 4-4Z" />
          <g className="animated-icon__motion animated-icon__compose">
            <path d="M12 8v6m-3-3h6" />
          </g>
        </>
      )}
      {name === "telescope" && (
        <>
          <rect x="5" y="8" width="14" height="12" rx="4" />
          <path d="M12 8V5M2 12v4m20-4v4m-13 1h6" />
          <circle cx="12" cy="3" r="1" />
          <g className="animated-icon__motion animated-icon__eyes">
            <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
          </g>
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
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M3 8h18" />
          <g className="animated-icon__motion animated-icon__prompt">
            <path d="m7 11 3 3-3 3" />
          </g>
          <g className="animated-icon__motion animated-icon__cursor">
            <path d="M13 17h4" />
          </g>
        </>
      )}
      {name === "folder" && (
        <>
          <path d="M3 17V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v2" />
          <g className="animated-icon__motion animated-icon__flap">
            <path d="M5 11h16l-2 8H5a2 2 0 0 1-2-2Z" />
          </g>
        </>
      )}
      {(name === "sidebar-close" || name === "sidebar-open") && (
        <>
          <rect
            x="3"
            y="4"
            width="6"
            height="16"
            rx="2"
            fill="currentColor"
            opacity="0.12"
            stroke="none"
          />
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M9 4v16" />
          <g className="animated-icon__motion">
            <path
              d={name === "sidebar-close" ? "m17 9-3 3 3 3" : "m13 9 3 3-3 3"}
            />
          </g>
        </>
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
