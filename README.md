# AI Pulse — Daily AI News Bot

A zero-cost daily AI news bot that fetches articles from top research blogs, summarizes them using Gemini 2.0 Flash, and delivers tweet-style summaries via Telegram.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  10 RSS Feeds   │────▶│  Node.js Worker  │────▶│   Telegram   │
│  (Google,       │     │  (Gemini 2.0     │     │   Bot        │
│   OpenAI, etc.) │     │   Flash +        │     │   Delivery   │
└─────────────────┘     │   Fallback)      │     └──────────────┘
                        └────────┬─────────┘
                                 │
                          ┌──────▼───────┐
                          │ data/        │
                          │ today.json   │
                          └──────────────┘

Orchestrated by GitHub Actions (daily at 6:00 AM WAT)
        │
        ▼ push to main
┌──────────────────┐
│  Vercel Auto-    │
│  Deploy (frontend)│
└──────────────────┘
```

## Setup

### 1. Worker (Backend)

```bash
cd worker
cp .env.example .env
# Fill in your API keys in .env
npm install
npm run once       # Run once
npm run schedule   # Run as persistent local scheduler
```

### 2. Frontend (React + Vite + Tailwind)

```bash
cd frontend
npm install
npm run dev        # Development server
npm run build      # Production build → dist/
```

Deploy to [Vercel](https://vercel.com): point Vercel at the `frontend` directory. Any push to `main` that updates `worker/data/today.json` triggers an auto-redeploy.

### 3. GitHub Actions — Required Secrets

Go to **Settings → Secrets → Actions** and add:

| Secret                | Description                                                                       |
| --------------------- | --------------------------------------------------------------------------------- |
| `COHERE_API_KEY`      | Cohere API key (primary summarizer)                                               |
| `OPENROUTER_API_KEY`  | OpenRouter API key (fallback model)                                               |
| `GH_MODELS_KEY`       | GitHub Models API key (secondary fallback)                                        |
| `TELEGRAM_BOT_TOKEN`  | Telegram Bot token from @BotFather                                                |
| `TELEGRAM_CHAT_ID`    | Target chat/channel ID                                                            |
| `GH_PAT` _(optional)_ | Personal Access Token with `repo` scope — ensures the push triggers Vercel deploy |

### 4. Environment Variables

| Variable             | Used By | Description                |
| -------------------- | ------- | -------------------------- |
| `COHERE_API_KEY`     | Worker  | Cohere primary key         |
| `OPENROUTER_API_KEY` | Worker  | OpenRouter fallback key    |
| `GH_MODELS_KEY`      | Worker  | GitHub Models fallback key |
| `TELEGRAM_BOT_TOKEN` | Worker  | Bot token                  |
| `TELEGRAM_CHAT_ID`   | Worker  | Chat ID                    |

## RSS Sources

- Google Research Blog
- DeepMind Blog
- OpenAI News
- BAIR Berkeley
- MIT News AI
- TechCrunch AI
- VentureBeat AI
- WIRED AI
- The Verge AI
- MIT Technology Review

## How It Works

1. **Fetch** — All 10 RSS feeds fetched in parallel via `rss-parser`
2. **Filter** — Only articles published in the last 24 hours (WAT / UTC+1)
3. **Deduplicate** — SHA256 hash of URL removes duplicates
4. **Summarize** — Gemini 2.0 Flash generates tweet-style summaries (≤ 240 chars)
5. **Fallback** — OpenRouter `meta-llama/llama-3.3-70b-instruct:free` on rate limit
6. **Save** — Results written to `worker/data/today.json`
7. **Deliver** — Each summary sent via Telegram as `tweetText\nRead: articleUrl`
8. **Commit & Push** — `today.json` committed to `main` → triggers Vercel auto-deploy
9. **Frontend** — React app fetches `today.json` from `raw.githubusercontent.com` and renders cards

## Output Format

Each entry in `worker/data/today.json`:

```json
{
  "tweetText": "Google releases new multimodal model...",
  "articleUrl": "https://...",
  "sourceName": "Google Research Blog",
  "sourceHomeUrl": "https://research.google/blog/",
  "publishedAt": "2026-04-09T10:00:00.000Z"
}
```

## Frontend Features

- **Dark mode** — Tailwind `class` strategy, always-on dark theme
- **TweetCard** — Three-tier layout: source link → tweet text → Copy/Open buttons
- **Copy Tweet** — Copies `tweetText + " " + articleUrl` to clipboard
- **Character counter** — Live `count/280` badge, turns red when over limit
- **Copy All** — Concatenates all summaries with `---` separators for X thread pasting
- **Data source** — `raw.githubusercontent.com/{repo}/main/worker/data/today.json` with cache-busting

## File Structure

```
ai-news/
├── .github/workflows/
│   └── daily-run.yml          # CI/CD — cron @ 05:00 UTC
├── worker/
│   ├── .env.example
│   ├── .gitignore
│   ├── index.js               # Main worker entry point
│   ├── package.json
│   └── data/
│       └── today.json         # Generated daily
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── vercel.json
│   ├── public/
│   │   └── today.json         # Served during dev
│   └── src/
│       ├── main.jsx
│       ├── App.jsx             # Layout + Copy All
│       ├── index.css           # Tailwind + custom classes
│       ├── hooks/
│       │   └── useNewsData.js  # Fetches from raw.githubusercontent.com
│       └── components/
│           └── TweetCard.jsx   # 3-tier card with copy/open/counter
└── README.md
```

## License

MIT

# AI-Pulse
