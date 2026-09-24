// Renders a list of full http(s) links as compact hostname links.

import type { MouseEvent as ReactMouseEvent } from "react";
export function urlHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // Not a parseable URL — show it as-is rather than hiding it.
    return url;
  }
}

export interface UrlListProps {
  urls: readonly string[];
}

export default function UrlList({ urls }: UrlListProps) {
  if (urls.length === 0) {
    return <span className="muted">—</span>;
  }

  const stopPropagation = (event: ReactMouseEvent) => event.stopPropagation();

  return (
    <div className="url-list" onClick={stopPropagation}>
      {urls.map((url, index) => (
        <a
          key={`${index}:${url}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          onClick={stopPropagation}
        >
          {urlHostname(url)}
        </a>
      ))}
    </div>
  );
}
