"use client";

import { useEffect } from "react";

type SiteTagsResponse = {
  data?: {
    head_tag?: string | null;
    body_start_tag?: string | null;
    body_end_tag?: string | null;
  };
};

const SLOT_ATTR = "data-runtime-site-tag";

const removeInjected = (slot: string) => {
  document
    .querySelectorAll<HTMLElement>(`[${SLOT_ATTR}="${slot}"]`)
    .forEach((node) => node.remove());
};

const markWithSlot = (node: Node, slot: string) => {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  element.setAttribute(SLOT_ATTR, slot);
  Array.from(element.childNodes).forEach((child) => markWithSlot(child, slot));
};

const reactivateScripts = (slot: string) => {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>(`script[${SLOT_ATTR}="${slot}"]`)
  );

  scripts.forEach((script) => {
    const replacement = document.createElement("script");
    Array.from(script.attributes).forEach((attr) =>
      replacement.setAttribute(attr.name, attr.value)
    );
    replacement.text = script.text;
    script.parentNode?.replaceChild(replacement, script);
  });
};

const injectSnippet = ({
  slot,
  snippet,
  target,
  position,
}: {
  slot: string;
  snippet?: string | null;
  target: HTMLElement;
  position: "append" | "prepend";
}) => {
  removeInjected(slot);

  if (!snippet || !snippet.trim()) return;

  const template = document.createElement("template");
  template.innerHTML = snippet;
  const nodes = Array.from(template.content.childNodes);

  nodes.forEach((node) => markWithSlot(node, slot));

  const fragment = document.createDocumentFragment();
  nodes.forEach((node) => fragment.appendChild(node));

  if (position === "prepend") {
    target.prepend(fragment);
  } else {
    target.append(fragment);
  }

  reactivateScripts(slot);
};

export default function RuntimeTagInjector() {
  useEffect(() => {
    let disposed = false;

    const load = async () => {
      try {
        const res = await fetch("/api/site-tags", { cache: "no-store" });
        if (!res.ok || disposed) return;

        const json = (await res.json()) as SiteTagsResponse;
        if (disposed) return;

        injectSnippet({
          slot: "head",
          snippet: json.data?.head_tag ?? null,
          target: document.head,
          position: "append",
        });
        injectSnippet({
          slot: "body-start",
          snippet: json.data?.body_start_tag ?? null,
          target: document.body,
          position: "prepend",
        });
        injectSnippet({
          slot: "body-end",
          snippet: json.data?.body_end_tag ?? null,
          target: document.body,
          position: "append",
        });
      } catch {
        // ignore
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, []);

  return null;
}
