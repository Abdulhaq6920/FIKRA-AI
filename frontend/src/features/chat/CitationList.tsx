"use client";

/**
 * Citation list rendered below assistant messages.
 * Each chip shows the source document title, page number, and source number.
 */

import { useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { Citation } from "@/types";

/** A document title that is actually a domain earns a real favicon. */
export function citationDomain(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const match = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i
  );
  if (!match) return null;
  const host = match[1].toLowerCase();
  return /\.(com|org|net|io|ai|co|gov|edu|dev|app|info|biz|xyz|me|tv)$/.test(host)
    ? host
    : null;
}

function CitationFavicon({ title }: { title: string }) {
  const [failed, setFailed] = useState(false);
  const domain = citationDomain(title);
  if (!domain || failed) {
    return <FileText className="h-2.5 w-2.5 text-brand-300" aria-hidden="true" />;
  }
  return (
    // Favicons are decorative; the chip label carries the document name.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={12}
      height={12}
      loading="lazy"
      className="h-3 w-3 rounded-[3px]"
      onError={() => setFailed(true)}
    />
  );
}

export function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1" aria-label="Sources">
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-surface-600">
        Sources
      </span>
      {citations.map((citation) => (
        <span
          key={`${citation.document_id}-${citation.source_number}`}
          title={`${citation.document_title}${
            citation.page_number ? ` · page ${citation.page_number}` : ""
          }\n${citation.excerpt}`}
          className="glass-chip inline-flex max-w-[16rem] items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] text-surface-300"
        >
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-100/10">
            <CitationFavicon title={citation.document_title} />
          </span>
          <span className="truncate">{citation.document_title}</span>
          {citation.page_number && (
            <span className="flex-shrink-0 text-[9px] text-surface-500">
              p.{citation.page_number}
            </span>
          )}
          <span className="flex-shrink-0 rounded-full bg-brand-500/10 px-1 text-[8px] font-semibold text-brand-300">
            {citation.source_number}
          </span>
        </span>
      ))}
    </div>
  );
}
