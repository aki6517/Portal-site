"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type Props = Omit<ImageProps, "src"> & {
  srcCandidates: Array<string | null | undefined>;
  fallback?: ReactNode;
};

const toCandidateList = (srcCandidates: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      srcCandidates
        .map((item) => (item ?? "").trim())
        .filter((item) => item.length > 0)
    )
  );

export default function ImageWithFallback({
  srcCandidates,
  fallback = null,
  alt,
  ...imageProps
}: Props) {
  const candidates = useMemo(() => toCandidateList(srcCandidates), [srcCandidates]);
  const [index, setIndex] = useState(0);
  const cacheKey = candidates.join("::");

  useEffect(() => {
    setIndex(0);
  }, [cacheKey]);

  const src = candidates[index];
  if (!src) return <>{fallback}</>;

  return (
    <Image
      {...imageProps}
      src={src}
      alt={alt}
      onError={() => setIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev))}
    />
  );
}
