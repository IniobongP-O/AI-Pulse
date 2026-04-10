/**
 * AI Pulse — Daily AI News Bot Worker
 *
 * Entry point: node worker/index.js
 *
 * Pipeline:
 *   1. Fetch 10 RSS feeds in parallel
 *   2. Filter to last 24 hours WAT (UTC+1)
 *   3. Deduplicate by SHA256 of URL
 *   4. Summarize with Gemini 2.0 Flash (fallback: OpenRouter Llama 3.3 free)
 *   5. Save to data/today.json
 *   6. Deliver via Telegram Bot
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Parser = require("rss-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// ─── RSS Feed Sources ─────────────────────────────────────────────────────
const RSS_FEEDS = [
  {
    name: "Google Research Blog",
    url: "https://research.google/blog/rss",
    home: "https://research.google/blog/",
  },
  {
    name: "AI News Blog",
    url: "https://www.artificialintelligence-news.com/feed/",
    home: "https://www.artificialintelligence-news/",
  },
  {
    name: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
    home: "https://openai.com/news/",
  },
  {
    name: "BAIR Berkeley",
    url: "https://bair.berkeley.edu/blog/feed.xml",
    home: "https://bair.berkeley.edu/blog/",
  },
  {
    name: "MIT News AI",
    url: "https://news.mit.edu/rss/topic/artificial-intelligence",
    home: "https://news.mit.edu/topic/artificial-intelligence",
  },
  {
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed",
    home: "https://techcrunch.com/category/artificial-intelligence/",
  },
  {
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/feed",
    home: "https://venturebeat.com/category/ai/",
  },
  {
    name: "WIRED AI",
    url: "https://www.wired.com/feed/rss",
    home: "https://wired.com/tag/ai/",
  },
  {
    name: "The Verge AI",
    url: "https://theverge.com/rss/ai-artificial-intelligence/index.xml",
    home: "https://theverge.com/ai-artificial-intelligence",
  },
  {
    name: "MIT Technology Review",
    url: "https://technologyreview.com/topic/artificial-intelligence",
    home: "https://technologyreview.com/topic/artificial-intelligence/",
  },
];

// ─── Environment ──────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const parser = new Parser({ timeout: 15000 });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const SUMMARIZE_PROMPT = `Summarize this Al news article in the style of an X tweet. Max 240 characters. Use plain English.  Write two short sentences: first what happened, second why it matters. End with via [SourceName].  Do not include hashtags or links. Keep it copy-paste ready.`;

// ─── 1. Fetch all RSS feeds in parallel ───────────────────────────────────
async function fetchAllFeeds() {
  console.log(`[RSS] Fetching ${RSS_FEEDS.length} feeds...`);
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        return parsed.items.map((item) => ({
          title: item.title || "Untitled",
          summary: item.summary || item.contentSnippet || item.content || "",
          url: item.link || "",
          sourceName: feed.name,
          sourceHomeUrl: feed.home,
          publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
        }));
      } catch (err) {
        console.error(`[RSS] Failed to fetch ${feed.name}:`, err.message);
        return [];
      }
    }),
  );

  const articles = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  console.log(`[RSS] Fetched ${articles.length} total articles.`);
  return articles;
}

// ─── 2. Filter last 24 hours WAT (West Africa Time, UTC+1) ───────────────
function filterLast24HoursWAT(articles) {
  const now = new Date();
  const watOffset = 1 * 60 * 60 * 1000; // UTC+1
  const nowWAT = new Date(now.getTime() + watOffset);
  const cutoffWAT = new Date(nowWAT.getTime() - 24 * 60 * 60 * 1000);

  return articles.filter((article) => {
    const pubDate = new Date(article.publishedAt);
    const pubWAT = new Date(pubDate.getTime() + watOffset);
    return pubWAT >= cutoffWAT && pubWAT <= nowWAT;
  });
}

// ─── 3. Deduplicate by SHA256 of URL ─────────────────────────────────────
function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const hash = crypto.createHash("sha256").update(article.url).digest("hex");
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

// ─── 4. Summarize — Gemini with OpenRouter fallback ──────────────────────
async function summarizeWithGemini(title, summary) {
  const prompt = `${SUMMARIZE_PROMPT}\n\nTitle: ${title}\nSummary: ${summary}`;
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  return text.replace(/^["'`]+|["'`]+$/g, "").trim();
}

async function summarizeWithOpenRouter(title, summary) {
  console.log(
    "[LLM] Gemini rate limited — falling back to OpenRouter Llama 3.3:free",
  );
  const prompt = `${SUMMARIZE_PROMPT}\n\nTitle: ${title}\nSummary: ${summary}`;

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "meta-llama/llama-3.3-70b-instruct:free",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 280,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/ai-pulse",
        "X-Title": "AI Pulse Worker",
      },
    },
  );

  const text = response.data.choices[0].message.content.trim();
  return text.replace(/^["'`]+|["'`]+$/g, "").trim();
}

function generateFallback(title, sourceName) {
  const short = title.length > 180 ? title.slice(0, 180) + "..." : title;
  return `${short} — a significant development in AI that warrants attention. via ${sourceName}`;
}

async function summarizeArticle(title, summary, sourceName) {
  try {
    return await summarizeWithGemini(title, summary);
  } catch (err) {
    const isRateLimit =
      err.response?.status === 429 ||
      err.message?.includes("429") ||
      err.message?.includes("quota") ||
      err.message?.includes("rate limit");

    if (isRateLimit && OPENROUTER_API_KEY) {
      try {
        return await summarizeWithOpenRouter(title, summary);
      } catch (fallbackErr) {
        console.error("[LLM] OpenRouter fallback failed:", fallbackErr.message);
        return generateFallback(title, sourceName);
      }
    }
    console.error("[LLM] Gemini error:", err.message);
    return generateFallback(title, sourceName);
  }
}

// ─── 5. Process & build data objects ──────────────────────────────────────
async function processArticles(articles) {
  console.log(`[LLM] Summarizing ${articles.length} articles...`);
  const results = [];

  for (const article of articles) {
    console.log(`[LLM] Processing: ${article.title.slice(0, 60)}...`);
    const tweetText = await summarizeArticle(
      article.title,
      article.summary,
      article.sourceName,
    );

    results.push({
      tweetText,
      articleUrl: article.url,
      sourceName: article.sourceName,
      sourceHomeUrl: article.sourceHomeUrl,
      publishedAt: article.publishedAt,
    });

    // Pace requests to avoid rate limits
    await new Promise((r) => setTimeout(r, 1500));
  }

  return results;
}

// ─── 6. Save to data/today.json ──────────────────────────────────────────
function saveResults(results) {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const filePath = path.join(dataDir, "today.json");
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`[DATA] Saved ${results.length} articles to ${filePath}`);
}

// ─── 7. Deliver via Telegram Bot ─────────────────────────────────────────
async function sendToTelegram(results) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[TELEGRAM] Credentials not set — skipping delivery.");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (const item of results) {
    const message = `${item.tweetText}\nRead: ${item.articleUrl}`;
    try {
      await axios.post(url, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        disable_web_page_preview: false,
      });
      console.log(`[TELEGRAM] Sent: ${item.tweetText.slice(0, 50)}...`);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(
        `[TELEGRAM] Failed: ${err.response?.data?.description || err.message}`,
      );
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(50));
  console.log("[AI PULSE] Worker started —", new Date().toISOString());
  console.log("=".repeat(50));

  const allArticles = await fetchAllFeeds();
  const recent = filterLast24HoursWAT(allArticles);
  console.log(`[FILTER] ${recent.length} articles from last 24h WAT.`);

  const unique = deduplicateArticles(recent);
  console.log(`[DEDUP]  ${unique.length} unique articles.`);

  if (unique.length === 0) {
    console.log("[AI PULSE] No new articles today.");
    return;
  }

  const results = await processArticles(unique);
  saveResults(results);
  await sendToTelegram(results);

  console.log("=".repeat(50));
  console.log("[AI PULSE] Worker completed —", new Date().toISOString());
  console.log("=".repeat(50));
}

// Execute when run directly
if (require.main === module) {
  main().catch((err) => {
    console.error("[FATAL]", err);
    process.exit(1);
  });
}

module.exports = { main };
