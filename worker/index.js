/**
 * AI Pulse — Daily AI News Bot Worker
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Parser = require("rss-parser");
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const axios = require("axios");

// ─── 0. Fail-Fast Environment Check ───────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!GEMINI_API_KEY) {
  console.error("❌ FATAL ERROR: GEMINI_API_KEY is missing or undefined.");
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

const parser = new Parser({ timeout: 15000 });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  safetySettings: [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ],
});

// Changed to {SOURCE} so we can inject the real source name dynamically
const SUMMARIZE_PROMPT = `Summarize this Al news article in the style of an X tweet. Max 240 characters. Use plain English. Write two short sentences: first what happened, second why it matters. End with via {SOURCE}. Do not include hashtags or links. Keep it copy-paste ready.`;

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
async function summarizeWithGemini(title, summary, sourceName) {
  const prompt = `${SUMMARIZE_PROMPT.replace("{SOURCE}", sourceName)}\n\nTitle: ${title}\nSummary: ${summary}`;
  const result = await model.generateContent(prompt);
  return result.response
    .text()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

async function summarizeWithOpenRouter(title, summary, sourceName) {
  const prompt = `${SUMMARIZE_PROMPT.replace("{SOURCE}", sourceName)}\n\nTitle: ${title}\nSummary: ${summary}`;

  // A list of reliable free models to cycle through
  const freeModels = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-lite-preview-02-05:free",
    "mistralai/mistral-7b-instruct:free",
    "meta-llama/llama-3-8b-instruct:free",
    "qwen/qwen-2.5-7b-instruct:free",
  ];

  for (const model of freeModels) {
    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: model,
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
      return response.data.choices[0].message.content
        .replace(/^["'`]+|["'`]+$/g, "")
        .trim();
    } catch (err) {
      console.log(`   ↳ (OpenRouter model ${model} busy, trying next...)`);
    }
  }
  throw new Error("All OpenRouter free providers returned errors.");
}

function generateFallback(title, sourceName) {
  const short = title.length > 180 ? title.slice(0, 180) + "..." : title;
  return `${short} — a significant development in AI that warrants attention. via ${sourceName}`;
}

async function summarizeArticle(title, summary, sourceName) {
  try {
    return await summarizeWithGemini(title, summary, sourceName);
  } catch (err) {
    console.error(`\n❌ [Gemini Error]: ${err.message}`);

    // We try OpenRouter for ANY Gemini failure now, not just rate limits
    if (OPENROUTER_API_KEY && OPENROUTER_API_KEY.length > 10) {
      console.log("   ↳ Trying OpenRouter Fallback...");
      try {
        return await summarizeWithOpenRouter(title, summary, sourceName);
      } catch (orErr) {
        console.error(
          `   ↳ ❌ [OpenRouter Error]: ${orErr.response?.data?.error?.message || orErr.message}`,
        );
        return generateFallback(title, sourceName);
      }
    } else {
      console.log("   ↳ Skipping OpenRouter (API Key missing or invalid)");
      return generateFallback(title, sourceName);
    }
  }
}

async function processArticles(articles) {
  console.log(`\n[LLM] Summarizing ${articles.length} articles...`);
  const results = [];
  for (const article of articles) {
    console.log(`[LLM] Processing: ${article.title.slice(0, 50)}...`);
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
    await new Promise((r) => setTimeout(r, 4500)); // Crucial 4.5s delay
  }
  return results;
}

// ─── Main Execution ───────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(50));
  console.log("[AI PULSE] Worker started —", new Date().toISOString());
  console.log("─── Diagnostic Check ───");
  console.log(
    `GEMINI_KEY: ${GEMINI_API_KEY ? "Loaded (starts with " + GEMINI_API_KEY.slice(0, 4) + ")" : "MISSING"}`,
  );
  console.log(
    `OPENROUTER_KEY: ${OPENROUTER_API_KEY ? "Loaded (starts with " + OPENROUTER_API_KEY.slice(0, 8) + ")" : "MISSING"}`,
  );
  console.log("=".repeat(50));

  const allArticles = await fetchAllFeeds();
  const recent = filterLast24HoursWAT(allArticles);
  const unique = deduplicateArticles(recent);

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
  console.log("=".repeat(50));
}

if (require.main === module) {
  main().catch((err) => console.error("[FATAL]", err));
}
