"use client";

/**
 * Chat answer rendering.
 *
 * Answers arrive as GitHub-flavoured Markdown. This component gives normal
 * prose a clean, readable layout, and gives code a dedicated "canvas": a
 * syntax-highlighted block with copy, download, and full-screen controls.
 *
 * Source markers are intentionally removed from the visible answer — citation
 * provenance is still persisted server-side for analytics.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Download, Maximize2, X } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils/cn";

const SOURCE_MARKER = /\s*\[Sources?\s+\d+(?:\s*[,–-]\s*\d+)*\]/gi;

/** Remove inline `[Source N]` markers so answers read as clean prose. */
export function stripSourceMarkers(text: string): string {
  return text
    .replace(SOURCE_MARKER, "")
    .replace(/[ \t]+$/gm, "");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadCode(code: string, language: string): void {
  const extension =
    language === "typescript"
      ? "ts"
      : language === "javascript"
        ? "js"
        : language === "python"
          ? "py"
          : language === "bash" || language === "shell"
            ? "sh"
            : language === "plaintext" || language === "code"
              ? "txt"
              : language;
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fikra-snippet.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function CodeCanvas({
  code,
  language,
  onClose,
}: {
  code: string;
  language: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const handleCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[#0b1120] text-slate-200 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`${language} code canvas`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#0f172a] px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-md bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            {language}
          </span>
          <span className="truncate text-xs text-slate-400">Code canvas</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => downloadCode(code, language)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close code canvas"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <SyntaxHighlighter
          style={oneDark as Record<string, React.CSSProperties>}
          language={language}
          showLineNumbers
          wrapLongLines={false}
          customStyle={{
            margin: 0,
            minHeight: "100%",
            background: "transparent",
            padding: "1.5rem",
            fontSize: "13px",
            lineHeight: 1.65,
          }}
          lineNumberStyle={{ color: "#475569", minWidth: "2.5em" }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
      <p className="border-t border-white/10 bg-[#0f172a] px-4 py-2 text-[10px] text-slate-500 md:px-6">
        Press Esc to close · scroll for the rest of the snippet
      </p>
    </div>,
    document.body,
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const closeCanvas = useCallback(() => setCanvasOpen(false), []);

  const handleCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-[#0b1120]">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#0f172a] px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {language}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Copy code"
              title="Copy code"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setCanvasOpen(true)}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-cyan-300"
              aria-label="Open code canvas"
              title="Open code canvas"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="max-h-[26rem] overflow-auto">
          <SyntaxHighlighter
            style={oneDark as Record<string, React.CSSProperties>}
            language={language}
            PreTag="div"
            wrapLongLines={false}
            customStyle={{
              margin: 0,
              background: "transparent",
              padding: "0.85rem 1rem",
              fontSize: "12px",
              lineHeight: 1.6,
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
      {canvasOpen && (
        <CodeCanvas code={code} language={language} onClose={closeCanvas} />
      )}
    </>
  );
}

const markdownComponents: Components = {
  // CodeBlock supplies its own container; discard the default <pre> wrapper.
  pre: ({ children }) => <>{children}</>,
  code({ className, children, ...props }) {
    const match = /language-([\w+#.-]+)/.exec(className ?? "");
    const raw = String(children).replace(/\n$/, "");
    const isBlock = Boolean(match) || raw.includes("\n");
    if (!isBlock) {
      return (
        <code
          className="rounded-md border border-surface-700/60 bg-surface-800 px-1.5 py-0.5 font-mono text-[0.85em] text-surface-100"
          {...props}
        >
          {children}
        </code>
      );
    }
    return <CodeBlock code={raw} language={(match?.[1] ?? "code").toLowerCase()} />;
  },
  p: ({ children }) => <p className="mb-2.5 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2.5 list-disc space-y-1 pl-5 marker:text-surface-500">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2.5 list-decimal space-y-1 pl-5 marker:text-surface-500">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-1 text-base font-semibold text-surface-50">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-[15px] font-semibold text-surface-50 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-sm font-semibold text-surface-100 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-2 text-sm font-medium text-surface-200">{children}</h4>
  ),
  strong: ({ children }) => <strong className="font-semibold text-surface-50">{children}</strong>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-cyan-300 underline decoration-cyan-400/40 underline-offset-2 hover:decoration-cyan-300"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2.5 border-l-2 border-cyan-400/40 bg-surface-800/40 py-1.5 pl-3 text-surface-300">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-surface-800" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-surface-800">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-850">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-surface-800 px-3 py-2 font-semibold text-surface-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-surface-800/60 px-3 py-2 align-top text-surface-300">
      {children}
    </td>
  ),
  tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
  input: ({ checked, ...props }) => (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      className="mr-1.5 h-3.5 w-3.5 accent-cyan-400"
      {...props}
    />
  ),
};

export function MarkdownContent({
  content,
  streaming = false,
  className,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
}) {
  const cleaned = useMemo(() => stripSourceMarkers(content), [content]);

  return (
    <div className={cn("chat-markdown text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {cleaned}
      </ReactMarkdown>
      {streaming && (
        <span className="ml-1 inline-block h-4 w-1.5 animate-pulse align-middle bg-cyan-300" />
      )}
    </div>
  );
}
