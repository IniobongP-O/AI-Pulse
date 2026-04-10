import { useState } from 'react';
import useNewsData from './hooks/useNewsData';
import TweetCard from './components/TweetCard';

// ── CONFIG ──────────────────────────────────────────────────────────────
// Set your GitHub repo path: USERNAME/REPO/BRANCH/worker/data/today.json
// Leave null to use local /data/today.json (for dev / Vercel deployment
// that serves the file from the public folder).
const GITHUB_RAW_PATH = null; // e.g. "myuser/ai-pulse/main/worker/data/today.json"

// ── Copy All helper ─────────────────────────────────────────────────────
function buildCopyAllText(items) {
  return items
    .map((item) => `${item.tweetText} ${item.articleUrl}`)
    .join('\n\n---\n\n');
}

export default function App() {
  const { data, loading, error } = useNewsData(GITHUB_RAW_PATH);
  const [allCopied, setAllCopied] = useState(false);

  async function handleCopyAll() {
    if (!data || data.length === 0) return;
    const text = buildCopyAllText(data);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col min-h-screen">
      {/* ── Header ── */}
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <span className="text-3xl">⚡</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              AI Pulse
            </h1>
            <p className="text-sm text-gray-500">
              Daily AI news • Summarized &amp; ready to post
            </p>
          </div>
        </div>

        <button
          onClick={handleCopyAll}
          disabled={!data || data.length === 0}
          className={`btn-primary flex items-center gap-2 ${
            allCopied ? '!bg-emerald-600' : ''
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {allCopied ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Copied All!
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              Copy All
            </>
          )}
        </button>
      </header>

      {/* ── Content ── */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <SpinnerIcon />
            <span>Fetching today's news…</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 font-semibold mb-1">Failed to load</p>
            <p className="text-sm text-gray-500">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && data?.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          No articles found for today.
        </div>
      )}

      {!loading && !error && data && data.length > 0 && (
        <div className="flex flex-col gap-5">
          {data.map((item, i) => (
            <TweetCard key={item.articleUrl + i} {...item} />
          ))}
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="mt-12 pt-6 border-t border-gray-800 text-center text-xs text-gray-600">
        Powered by Gemini 2.0 Flash • Data from{' '}
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-400"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-8 h-8 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
