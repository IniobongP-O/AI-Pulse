import { useState, useEffect } from "react";

/**
 * Fetches today.json from the GitHub repository via raw.githubusercontent.com.
 * Falls back to a local /data/today.json path during development.
 *
 * @param {string} repoPath - e.g. "USERNAME/REPO/main/worker/data/today.json"
 * @returns {{ data: Array|null, loading: boolean, error: string|null }}
 */
export default function useNewsData(repoPath) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const urls = repoPath
      ? [`https://raw.githubusercontent.com/${repoPath}?t=${Date.now()}`]
      : ["/today.json"];

    async function fetchFrom(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
      return res.json();
    }

    (async () => {
      try {
        setLoading(true);
        const result = await fetchFrom(urls[0]);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (urls.length > 1) {
          try {
            const fallback = await fetchFrom(urls[1]);
            if (!cancelled) {
              setData(fallback);
              setError(null);
            }
            return;
          } catch {
            // fall through to error
          }
        }
        if (!cancelled) {
          setError(err.message);
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  return { data, loading, error };
}
