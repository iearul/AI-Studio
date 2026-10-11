"use client";

import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type LightboxImage = {
  src: string;
  alt: string;
  caption?: string;
};

type LightboxState = { images: LightboxImage[]; index: number };

/**
 * Full-screen image viewer. Render `element` once per page and call `open`
 * with the group of images the clicked one belongs to.
 */
export function useLightbox() {
  const [state, setState] = useState<LightboxState>();
  const open = useCallback((images: LightboxImage[], index = 0) => {
    if (images.length > 0) setState({ images, index });
  }, []);
  const element = state ? (
    <Lightbox
      images={state.images}
      index={state.index}
      onIndex={(index) => setState({ ...state, index })}
      onClose={() => setState(undefined)}
    />
  ) : null;
  return { open, element };
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const image = images[index]!;
  const multiple = images.length > 1;
  const previous = useCallback(
    () => onIndex((index - 1 + images.length) % images.length),
    [images.length, index, onIndex],
  );
  const next = useCallback(
    () => onIndex((index + 1) % images.length),
    [images.length, index, onIndex],
  );

  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (multiple && event.key === "ArrowLeft") previous();
      else if (multiple && event.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiple, next, onClose, previous]);

  return createPortal(
    <div
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      onClick={onClose}
    >
      <figure
        className="lightbox-figure"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lightbox-image">
          <Image
            unoptimized
            fill
            sizes="100vw"
            src={image.src}
            alt={image.alt}
          />
        </div>
        <figcaption>
          <span>{image.caption ?? image.alt}</span>
          {multiple && (
            <small>
              {index + 1} / {images.length}
            </small>
          )}
          <a href={image.src} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> Open original
          </a>
        </figcaption>
      </figure>
      <button
        ref={closeButton}
        className="lightbox-button lightbox-close"
        aria-label="Close image"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      {multiple && (
        <>
          <button
            className="lightbox-button lightbox-previous"
            aria-label="Previous image"
            onClick={(event) => {
              event.stopPropagation();
              previous();
            }}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            className="lightbox-button lightbox-next"
            aria-label="Next image"
            onClick={(event) => {
              event.stopPropagation();
              next();
            }}
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
