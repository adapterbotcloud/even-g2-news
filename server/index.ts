import express from 'express'
import cors from 'cors'
import Parser from 'rss-parser'
import path from 'path'
import { fileURLToPath } from 'url'
import { promises as fs } from 'fs'

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

interface SourceConfig {
  name: string
  url: string
  enabled: boolean
}

const DATA_DIR = path.join(__dirname, '..', 'data')
const SOURCES_FILE = path.join(DATA_DIR, 'sources.json')
const DEFAULT_SOURCES: SourceConfig[] = [
  { name: 'O Povo', url: 'https://www.opovo.com.br/rss.xml', enabled: true },
  { name: 'Diário do Nordeste', url: 'https://diariodonordeste.verdesmares.com.br/rss.xml', enabled: true },
  { name: 'UOL', url: 'https://rss.uol.com.br/feed/noticias.xml', enabled: true },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/', enabled: true },
  { name: 'Valor Econômico', url: 'https://pox.globo.com/rss/valor/', enabled: true },
]

let cachedNews: NewsItem[] = []
let lastFetch = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 min

function normalizeSource(raw: Partial<SourceConfig> | null | undefined): SourceConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim()
  const url = String(raw.url || '').trim()
  if (!name || !url) return null
  return {
    name,
    url,
    enabled: raw.enabled !== false,
  }
}

function clearNewsCache() {
  cachedNews = []
  lastFetch = 0
}

async function ensureSourcesFile() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    await fs.access(SOURCES_FILE)
  } catch {
    await fs.writeFile(SOURCES_FILE, `${JSON.stringify(DEFAULT_SOURCES, null, 2)}\n`, 'utf-8')
  }
}

async function readSources(): Promise<SourceConfig[]> {
  await ensureSourcesFile()
  try {
    const raw = await fs.readFile(SOURCES_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('sources.json inválido')

    const seenNames = new Set<string>()
    const sources = parsed
      .map((entry) => normalizeSource(entry))
      .filter((entry): entry is SourceConfig => !!entry)
      .filter((entry) => {
        if (seenNames.has(entry.name)) return false
        seenNames.add(entry.name)
        return true
      })

    if (sources.length === 0) {
      await writeSources(DEFAULT_SOURCES)
      return [...DEFAULT_SOURCES]
    }

    return sources
  } catch {
    await writeSources(DEFAULT_SOURCES)
    return [...DEFAULT_SOURCES]
  }
}

async function writeSources(sources: SourceConfig[]) {
  await ensureSourcesFile()
  await fs.writeFile(SOURCES_FILE, `${JSON.stringify(sources, null, 2)}\n`, 'utf-8')
  clearNewsCache()
}

async function fetchAllFeeds(): Promise<NewsItem[]> {
  const now = Date.now()
  if (cachedNews.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedNews
  }

  const allItems: NewsItem[] = []
  const configuredSources = await readSources()
  const enabledSources = configuredSources.filter((source) => source.enabled)

  for (const { name: source, url } of enabledSources) {
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

// GET /api/sources - ordered list [{name, url, enabled}]
app.get('/api/sources', async (req, res) => {
  try {
    const sources = await readSources()
    res.json({ sources })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar fontes' })
  }
})

// POST /api/sources - replace full list
app.post('/api/sources', async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : req.body?.sources
    if (!Array.isArray(payload)) {
      return res.status(400).json({ error: 'Envie uma lista de fontes' })
    }

    const seenNames = new Set<string>()
    const sources = payload
      .map((entry) => normalizeSource(entry))
      .filter((entry): entry is SourceConfig => !!entry)
      .filter((entry) => {
        if (seenNames.has(entry.name)) return false
        seenNames.add(entry.name)
        return true
      })

    await writeSources(sources)
    res.json({ ok: true, sources })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar fontes' })
  }
})

// POST /api/sources/add - add {name, url}
app.post('/api/sources/add', async (req, res) => {
  try {
    const entry = normalizeSource(req.body)
    if (!entry) {
      return res.status(400).json({ error: 'Fonte inválida. Use {name, url}' })
    }

    const sources = await readSources()
    if (sources.some((source) => source.name === entry.name)) {
      return res.status(409).json({ error: 'Já existe uma fonte com esse nome' })
    }

    const updated = [...sources, { ...entry, enabled: true }]
    await writeSources(updated)
    res.json({ ok: true, sources: updated })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar fonte' })
  }
})

// DELETE /api/sources/:name - remove by name
app.delete('/api/sources/:name', async (req, res) => {
  try {
    const targetName = decodeURIComponent(req.params.name || '').trim()
    if (!targetName) {
      return res.status(400).json({ error: 'Nome da fonte é obrigatório' })
    }

    const sources = await readSources()
    const updated = sources.filter((source) => source.name !== targetName)

    if (updated.length === sources.length) {
      return res.status(404).json({ error: 'Fonte não encontrada' })
    }

    await writeSources(updated)
    res.json({ ok: true, sources: updated })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover fonte' })
  }
})

// PUT /api/sources/reorder - reorder sources [{name, url, enabled}]
app.put('/api/sources/reorder', async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : req.body?.sources
    if (!Array.isArray(payload)) {
      return res.status(400).json({ error: 'Envie uma lista de fontes' })
    }

    const seenNames = new Set<string>()
    const reordered = payload
      .map((entry) => normalizeSource(entry))
      .filter((entry): entry is SourceConfig => !!entry)
      .filter((entry) => {
        if (seenNames.has(entry.name)) return false
        seenNames.add(entry.name)
        return true
      })

    await writeSources(reordered)
    res.json({ ok: true, sources: reordered })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao reordenar fontes' })
  }
})

// GET /api/news - all news or by source
app.get('/api/news', async (req, res) => {
  try {
    const source = req.query.source as string | undefined
    let news = await fetchAllFeeds()
    if (source && source !== 'Todas') {
      news = news.filter((n) => n.source === source)
    }
    const sources = (await readSources()).filter((item) => item.enabled).map((item) => item.name)
    res.json({ items: news, sources })
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
app.listen(PORT, async () => {
  console.log(`📰 News server running on port ${PORT}`)
  await ensureSourcesFile()
  fetchAllFeeds() // pre-warm cache
})
