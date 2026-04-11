/**
 * AI Pulse — Daily AI News Bot Worker
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Parser = require("rss-parser");
const axios = require("axios");

// ─── 0. Fail-Fast Environment Check ───────────────────────────────────────
const COHERE_API_KEY = process.env.COHERE_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GH_MODELS_KEY = process.env.GH_MODELS_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!COHERE_API_KEY && !OPENROUTER_API_KEY && !GH_MODELS_KEY) {
  console.error(
    "❌ FATAL ERROR: At least one of COHERE_API_KEY, OPENROUTER_API_KEY, or GH_MODELS_KEY must be set.",
  );
  process.exit(1);
}

// ─── RSS Feed Sources ─────────────────────────────────────────────────────
const RSS_FEEDS = [
  {
    name: "Google Research Blog",
    url: "https://research.google/blog/rss",
    home: "https://research.google/blog/",
  },
  {
    name: "AI News",
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
    url: "https://www.wired.com/feed/tag/ai/latest/rss",
    home: "https://wired.com/tag/ai/",
  },
  {
    name: "The Verge AI",
    url: "https://theverge.com/rss/ai-artificial-intelligence/index.xml",
    home: "https://theverge.com/ai-artificial-intelligence",
  },
  {
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
    home: "https://www.technologyreview.com/topic/artificial-intelligence/",
  },
];

const parser = new Parser({ timeout: 15000 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Changed to {SOURCE} so we can inject the real source name dynamically
const SUMMARIZE_PROMPT = `Summarize this AI news article in the style of an X tweet. Max 240 characters. Use plain English. Write two short sentences: first what happened, second why it matters. End with via {SOURCE}. Do not include hashtags or links. Keep it copy-paste ready.`;

// ─── 1. Fetch & Filter RSS Feeds ──────────────────────────────────────────
async function fetchAllFeeds() {
  console.log(`[RSS] Fetching ${RSS_FEEDS.length} feeds...`);
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        return parsed.items.map((item) => ({
          title: item.title || "Untitled",
          summary:
            item.contentSnippet ||
            item.content ||
            item.description ||
            item.summary ||
            "No summary available.",
          url: item.link || "",
          sourceName: feed.name,
          sourceHomeUrl: feed.home,
          publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
        }));
      } catch (err) {
        return [];
      }
    }),
  );
  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

function filterLast24HoursWAT(articles) {
  const nowWAT = new Date(new Date().getTime() + 1 * 60 * 60 * 1000);
  const cutoffWAT = new Date(nowWAT.getTime() - 24 * 60 * 60 * 1000);
  return articles.filter((article) => {
    const pubWAT = new Date(
      new Date(article.publishedAt).getTime() + 1 * 60 * 60 * 1000,
    );
    return pubWAT >= cutoffWAT && pubWAT <= nowWAT;
  });
}

// ─── AI-Relevance Filter ──────────────────────────────────────────────────
const AI_KEYWORDS =
  /\b(ai|artificial intelligence|machine learning|deep learning|neural|llm|gpt|chatgpt|gemini|claude|anthropic|openai|generative|diffusion|transformer|nlp|computer vision|robotics|autonomous|copilot|midjourney|stable diffusion|deepmind|hugging face|langchain|rag|fine-?tun|foundational model|large language model|training data)\b/i;

function filterAIRelevant(articles) {
  return articles.filter((article) => {
    const text = `${article.title} ${article.summary}`;
    return AI_KEYWORDS.test(text);
  });
}

function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const hash = crypto.createHash("sha256").update(article.url).digest("hex");
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

// ─── 2. LLM Summarization ────────────────────────────────────────────────
async function summarizeWithCohere(title, summary, sourceName) {
  const prompt = `${SUMMARIZE_PROMPT.replace("{SOURCE}", sourceName)}\n\nTitle: ${title}\nSummary: ${summary}`;

  try {
    const response = await axios.post(
      "https://api.cohere.ai/v1/chat",
      {
        message: prompt,
        model: "command-r",
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${COHERE_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const text = response.data?.text;
    if (!text || text.trim().length === 0) {
      throw new Error("Cohere returned an empty response");
    }
    return text.replace(/^["'`]+|["'`]+$/g, "").trim();
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    throw new Error(`Cohere API failed: ${detail}`);
  }
}

async function summarizeWithOpenRouter(title, summary, sourceName) {
  const prompt = `${SUMMARIZE_PROMPT.replace("{SOURCE}", sourceName)}\n\nTitle: ${title}\nSummary: ${summary}`;

  // Reliable free models for fallback (verified April 2026)
  const freeModels = [
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "minimax/minimax-m2.5:free",
    "mistralai/mistral-7b-instruct:free",
    "openrouter/free", // Smart router as final safety net
  ];

  const errors = [];
  for (const orModel of freeModels) {
    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: orModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 280,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/ai-pulse",
            "X-Title": "AI Pulse",
          },
        },
      );
      const content = response.data?.choices?.[0]?.message?.content;
      if (!content || content.trim().length === 0) {
        throw new Error("Empty response from model");
      }
      return content.replace(/^["'`]+|["'`]+$/g, "").trim();
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.message;
      console.log(`   ↳ OpenRouter [${orModel}]: ${detail}`);
      errors.push(`${orModel}: ${detail}`);
      // Add a short delay between model retries to avoid rate limiting
      await sleep(2000);
    }
  }
  throw new Error(`All OpenRouter models failed:\n${errors.join("\n")}`);
}

async function summarizeWithGitHubModels(title, summary, sourceName) {
  const prompt = `${SUMMARIZE_PROMPT.replace("{SOURCE}", sourceName)}\n\nTitle: ${title}\nSummary: ${summary}`;

  try {
    const response = await axios.post(
      "https://models.github.ai/inference/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that summarizes news articles concisely.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 280,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${GH_MODELS_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      throw new Error("Empty response from GitHub Models");
    }
    return content.replace(/^["'`]+|["'`]+$/g, "").trim();
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    throw new Error(`GitHub Models API failed: ${detail}`);
  }
}

function generateFallback(title, sourceName) {
  const short = title.length > 180 ? title.slice(0, 180) + "..." : title;
  return `${short} — a significant development in AI that warrants attention. via ${sourceName}`;
}

async function summarizeArticle(title, summary, sourceName) {
  // Tier 1: Try Cohere
  if (COHERE_API_KEY && COHERE_API_KEY.length > 10) {
    try {
      return await summarizeWithCohere(title, summary, sourceName);
    } catch (err) {
      console.error(`\n❌ [Cohere Error]: ${err.message}`);
    }
  }

  // Tier 2: Fall back to OpenRouter
  if (OPENROUTER_API_KEY && OPENROUTER_API_KEY.length > 10) {
    console.log("   ↳ Cohere failed, falling back to OpenRouter...");
    try {
      return await summarizeWithOpenRouter(title, summary, sourceName);
    } catch (orErr) {
      console.error(
        `   ↳ ❌ [OpenRouter Error]: ${orErr.response?.data?.error?.message || orErr.message}`,
      );
    }
  } else {
    console.log("   ↳ Skipping OpenRouter (API Key missing or invalid)");
  }

  // Tier 3: Fall back to GitHub Models
  if (GH_MODELS_KEY && GH_MODELS_KEY.length > 10) {
    console.log("   ↳ OpenRouter failed, falling back to GitHub Models...");
    try {
      return await summarizeWithGitHubModels(title, summary, sourceName);
    } catch (ghErr) {
      console.error(
        `   ↳ ❌ [GitHub Models Error]: ${ghErr.response?.data?.error?.message || ghErr.message}`,
      );
    }
  } else {
    console.log("   ↳ Skipping GitHub Models (API Key missing or invalid)");
  }

  // All providers failed — use fallback
  console.log("   ↳ All AI providers failed. Using fallback summary.");
  return generateFallback(title, sourceName);
}

async function processArticles(articles) {
  console.log(`\n[LLM] Summarizing ${articles.length} articles...`);
  const results = [];
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    console.log(
      `[LLM] Processing (${i + 1}/${articles.length}): ${article.title.slice(0, 50)}...`,
    );

    // Respect API rate limits between articles
    if (i > 0) {
      await sleep(8000);
    }

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
  }
  return results;
}

// ─── 3. Telegram Delivery ─────────────────────────────────────────────────
async function sendToTelegram(results) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[Telegram] Skipping delivery — bot token or chat ID missing.");
    return;
  }

  console.log(`\n[Telegram] Delivering ${results.length} articles...`);

  for (const item of results) {
    const messageString = `${item.tweetText}\n\nRead more: ${item.articleUrl}`;

    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        { chat_id: TELEGRAM_CHAT_ID, text: messageString },
        { headers: { "Content-Type": "application/json" } },
      );
      console.log(`✅ Sent: ${item.tweetText.slice(0, 50)}...`);
    } catch (err) {
      const detail = err.response?.data?.description || err.message;
      console.error(`❌ Telegram send failed: ${detail}`);
    }

    await sleep(1500);
  }

  console.log("[Telegram] All articles delivered.");
}

// ─── Main Execution ───────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(50));
  console.log("[AI PULSE] Worker started —", new Date().toISOString());
  console.log("─── Diagnostic Check ───");
  console.log(
    `COHERE_KEY: ${COHERE_API_KEY ? "Loaded (starts with " + COHERE_API_KEY.slice(0, 4) + ")" : "MISSING"}`,
  );
  console.log(
    `OPENROUTER_KEY: ${OPENROUTER_API_KEY ? "Loaded (starts with " + OPENROUTER_API_KEY.slice(0, 8) + ")" : "MISSING"}`,
  );
  console.log(
    `GH_MODELS_KEY: ${GH_MODELS_KEY ? "Loaded (starts with " + GH_MODELS_KEY.slice(0, 6) + ")" : "MISSING"}`,
  );
  console.log("=".repeat(50));

  const allArticles = await fetchAllFeeds();
  console.log(`[RSS] Total articles fetched: ${allArticles.length}`);
  const recent = filterLast24HoursWAT(allArticles);
  console.log(`[RSS] Articles from last 24h: ${recent.length}`);
  const relevant = filterAIRelevant(recent);
  console.log(`[RSS] AI-relevant articles: ${relevant.length}`);
  const unique = deduplicateArticles(relevant);
  console.log(`[RSS] After dedup: ${unique.length}`);

  if (unique.length === 0) {
    console.log("[AI PULSE] No new articles today.");
    return;
  }

  const results = await processArticles(unique);

  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "today.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`[DATA] Saved ${results.length} articles.`);

  await sendToTelegram(results);

  console.log("=".repeat(50));
}

if (require.main === module) {
  main().catch((err) => console.error("[FATAL]", err));
}
