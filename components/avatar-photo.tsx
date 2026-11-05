"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A remote photo that removes itself if it can't load, leaving the initials
 * behind it. Institution sites can block hotlinked images, and a failed image
 * would otherwise show the browser's broken-image icon.
 */
export function AvatarPhoto({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);

  // A photo can fail before hydration, when onError isn't listening yet.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return null;
  // Plain <img> avoids allow-listing every host.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
