import { createContext, useContext } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { external } from "./api";
import { githubImageUrl, webContentUrl } from "./rendering-policy";

const InsideMarkdownLink = createContext(false);

function MarkdownImage({
  src,
  alt,
  imageBase,
  images,
}: {
  src?: string;
  alt?: string;
  imageBase?: string;
  images: "repository" | "placeholder";
}) {
  const insideLink = useContext(InsideMarkdownLink);
  const url = images === "repository" ? githubImageUrl(src, imageBase) : null;
  if (url)
    return (
      <img
        src={url}
        alt={alt || ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    );
  const link =
    images === "repository" && !insideLink
      ? webContentUrl(src, imageBase)
      : null;
  return (
    <span className="muted">
      {alt ? `[Image: ${alt}]` : "[Image]"}
      {link && (
        <>
          {" "}
          <button
            type="button"
            className="markdown-link"
            aria-label={
              alt ? `Open image in browser: ${alt}` : "Open image in browser"
            }
            onClick={() => external(link)}
          >
            Open image ↗
          </button>
        </>
      )}
    </span>
  );
}

export function RepositoryAvatar({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const url = githubImageUrl(src, undefined, true);
  return url ? (
    <img
      className={className}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      className={className}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    />
  );
}

/** README supports sanitized HTML; PR text keeps HTML disabled. In both modes,
 * links use the external opener and untrusted content cannot add resource props. */
export function SafeMarkdown({
  children,
  html = false,
  linkBase,
  imageBase,
  images = "placeholder",
}: {
  children: string;
  html?: boolean;
  linkBase?: string;
  imageBase?: string;
  images?: "repository" | "placeholder";
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={html ? [rehypeRaw, rehypeSanitize] : []}
      skipHtml={!html}
      // The sanitizer permits source/srcset by default. Remove it so <picture>
      // cannot bypass the img URL policy with a second automatic request.
      disallowedElements={["source"]}
      components={{
        a: ({ href, children: label }) => {
          const url = webContentUrl(href, linkBase);
          return url ? (
            <InsideMarkdownLink.Provider value={true}>
              <button
                type="button"
                className="markdown-link"
                title="Open link in browser"
                onClick={() => external(url)}
              >
                {label}
              </button>
            </InsideMarkdownLink.Provider>
          ) : (
            <span>{label}</span>
          );
        },
        img: ({ src, alt }) => (
          <MarkdownImage
            src={src}
            alt={alt}
            imageBase={imageBase}
            images={images}
          />
        ),
      }}
    >
      {children}
    </Markdown>
  );
}
