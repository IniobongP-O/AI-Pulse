import { useState } from 'react';

const CHAR_LIMIT = 280;

/**
 * TweetCard — three-tier layout for a single AI news summary.
 *
 * Top:    Source name → hyperlink to sourceHomeUrl
 * Middle: Generated tweetText
 * Bottom: "Copy Tweet" + "Open Article" buttons + live character count
 */
export default function TweetCard({ tweetText, articleUrl, sourceName, sourceHomeUrl }) {
  const [copied, setCopied] = useState(false);

  // Copy text = tweetText + space + articleUrl
  const copyText = `${tweetText} ${articleUrl}`;
  const charCount = copyText.length;
  const overLimit = charCount > CHAR_LIMIT;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = copyText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <article className="card-glow rounded-xl p-5 flex flex-col gap-4">
      {/* ── Top: Source ── */}
      <div className="flex items-center gap-2">
        <a
          href={sourceHomeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 hover:text-indigo-300 font-semibold text-sm truncate transition-colors"
        >
          {sourceName}
        </a>
        <span className="flex-1" />
        <span
          className={`text-xs tabular-nums font-mono px-2 py-0.5 rounded ${
            overLimit
              ? 'bg-red-900/50 text-red-400'
              : 'bg-gray-800 text-gray-400'
          }`}
        >
          {charCount}/{CHAR_LIMIT}
        </span>
      </div>

      {/* ── Middle: Tweet text ── */}
      <p className="text-gray-100 text-base leading-relaxed whitespace-pre-wrap">
        {tweetText}
      </p>

      {/* ── Bottom: Actions ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleCopy}
          className={`btn-secondary flex items-center gap-1.5 ${
            copied ? '!bg-emerald-700 !text-white' : ''
          }`}
          title="Copy tweet + link to clipboard"
        >
          {copied ? (
            <>
              <CheckIcon /> Copied!
            </>
          ) : (
            <>
              <CopyIcon /> Copy Tweet
            </>
          )}
        </button>

        <a
          href={articleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary flex items-center gap-1.5 no-underline"
        >
          <LinkIcon /> Open Article
        </a>
      </div>
    </article>
  );
}

/* ── Inline SVG icons ── */

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
