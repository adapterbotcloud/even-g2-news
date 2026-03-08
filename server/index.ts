import express from 'express'
import cors from 'cors'
import Parser from 'rss-parser'
import path from 'path'
import { fileURLToPath } from 'url'

const app = express()
const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EvenG2News/1.0)' },
  customFields: { item: ['description'] },
})

app.use(cors())
app.use(express.json())

// Serve built frontend
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use(express.static(path.join(__dirname, '..', 'dist')))

interface NewsItem {
  title: string
  source: string
  date: string
  link: string
  summary: string
  publishedAt: number
}

const RSS_FEEDS: Record<string, string> = {
  G1: 'https://g1.globo.com/rss/g1/',
  Folha: 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml',
  Valor: 'https://pox.globo.com/rss/valor/',
  'Estadão': 'https://www.estadao.com.br/arc/outboundfeeds/rss/?outputType=xml',
  'Folha Pol': 'https://feeds.folha.uol.com.br/poder/rss091.xml',
}

let cachedNews: NewsItem[] = []
let lastFetch = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 min

async function fetchAllFeeds(): Promise<NewsItem[]> {
  const now = Date.now()
  if (cachedNews.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedNews
  }

  const allItems: NewsItem[] = []

  for (const [source, url] of Object.entries(RSS_FEEDS)) {
    try {
      const feed = await parser.parseURL(url)
      const items = (feed.items || []).slice(0, 5).map((item) => {
        const publishedAt = item.pubDate ? Date.parse(item.pubDate) : 0
        return {
          title: (item.title || 'Sem título').slice(0, 200),
          source,
          date:
            publishedAt > 0
              ? new Date(publishedAt).toLocaleString('pt-BR', {
                  timeZone: 'America/Fortaleza',
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit',
                })
              : '',
          link: item.link || '',
          summary: (item.contentSnippet || item.content || '').replace(/<[^>]*>/g, '').slice(0, 500),
          publishedAt,
        }
      })

      allItems.push(...items)
      console.log(`✅ ${source}: ${items.length} notícias`)
    } catch (err) {
      console.error(`❌ ${source}: ${(err as Error).message}`)
    }
  }

  // Sort by publication date (newest first), mixing all sources.
  allItems.sort((a, b) => b.publishedAt - a.publishedAt)
  cachedNews = allItems
  lastFetch = now
  console.log(`Total: ${allItems.length} notícias em cache`)
  return allItems
}

// GET /api/sources - source names
app.get('/api/sources', (req, res) => {
  res.json({ sources: Object.keys(RSS_FEEDS).map((name) => ({ name })) })
})

// GET /api/news - all news or by source
app.get('/api/news', async (req, res) => {
  try {
    const source = req.query.source as string | undefined
    let news = await fetchAllFeeds()
    if (source && source !== 'Todas') {
      news = news.filter((n) => n.source === source)
    }
    res.json({ items: news, sources: Object.keys(RSS_FEEDS) })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar notícias' })
  }
})

// GET /api/news/:index - single item (for glasses display)
app.get('/api/news/:index', async (req, res) => {
  try {
    const news = await fetchAllFeeds()
    const idx = parseInt(req.params.index) || 0
    if (idx >= 0 && idx < news.length) {
      res.json({ item: news[idx], total: news.length, index: idx })
    } else {
      res.json({ item: null, total: news.length, index: idx })
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar notícia' })
  }
})

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
})

const PORT = process.env.NEWS_PORT || 3005
app.listen(PORT, () => {
  console.log(`📰 News server running on port ${PORT}`)
  fetchAllFeeds() // pre-warm cache
})
