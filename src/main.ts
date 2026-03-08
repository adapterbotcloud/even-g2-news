import {
  waitForEvenAppBridge,
  EvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// ─── State ───
let bridge: EvenAppBridge | null = null
let newsItems: Array<{
  title: string
  source: string
  date: string
  summary: string
}> = []
let currentIndex = 0
let currentSource = 'Todas'
const sources = ['Todas', 'G1', 'Folha', 'Valor', 'Estadão', 'Folha Pol']
let sourceIndex = 0

// ─── G2 Display ───
const CANVAS_W = 576
const CANVAS_H = 288

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

async function showOnGlasses(headerText: string, bodyText: string) {
  if (!bridge) return

  try {
    // Header: source + navigation info
    const headerContainer = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: CANVAS_W,
      height: 40,
      borderWidth: 1,
      borderColor: 8,
      borderRdaius: 0,
      paddingLength: 4,
      containerID: 1,
      containerName: 'header',
      content: truncate(headerText, 100),
      isEventCapture: 0,
    })

    // Body: news content
    const bodyContainer = new TextContainerProperty({
      xPosition: 0,
      yPosition: 44,
      width: CANVAS_W,
      height: CANVAS_H - 44,
      borderWidth: 0,
      borderColor: 5,
      borderRdaius: 0,
      paddingLength: 6,
      containerID: 2,
      containerName: 'body',
      content: truncate(bodyText, 900),
      isEventCapture: 1,
    })

    await bridge.createStartUpPageContainer(2, [headerContainer, bodyContainer])
  } catch (err) {
    console.error('Display error:', err)
  }
}

async function updateBody(text: string) {
  if (!bridge) return
  try {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 2,
        containerName: 'body',
        contentOffset: 0,
        contentLength: 900,
        content: truncate(text, 900),
      })
    )
  } catch {
    // fallback to full rebuild
    await showCurrentNews()
  }
}

async function showCurrentNews() {
  if (newsItems.length === 0) {
    await showOnGlasses('📰 BR News', 'Carregando notícias...')
    return
  }

  const item = newsItems[currentIndex]
  if (!item) return

  const header = `${item.source} | ${item.date}  [${currentIndex + 1}/${newsItems.length}]`

  let body = `${item.title}\n\n`
  if (item.summary) {
    body += item.summary
  }

  await showOnGlasses(header, body)
  updateBrowserUI()
}

function nextNews() {
  if (newsItems.length === 0) return
  currentIndex = (currentIndex + 1) % newsItems.length
  showCurrentNews()
}

function prevNews() {
  if (newsItems.length === 0) return
  currentIndex = (currentIndex - 1 + newsItems.length) % newsItems.length
  showCurrentNews()
}

function nextSource() {
  sourceIndex = (sourceIndex + 1) % sources.length
  currentSource = sources[sourceIndex]
  currentIndex = 0
  fetchNews()
}

// ─── Data ───
async function fetchNews() {
  try {
    const param = currentSource !== 'Todas' ? `?source=${encodeURIComponent(currentSource)}` : ''
    const res = await fetch(`/api/news${param}`)
    const data = await res.json()
    newsItems = data.items || []
    currentIndex = 0
    console.log(`📰 ${newsItems.length} notícias (${currentSource})`)
    await showCurrentNews()
  } catch (err) {
    console.error('Fetch error:', err)
    if (bridge) {
      await showOnGlasses('📰 BR News', 'Erro ao carregar notícias.\nVerifique a conexão.')
    }
  }
}

// ─── Browser UI (settings page) ───
function updateBrowserUI() {
  const el = document.getElementById('current-news')
  if (!el) return
  const statusEl = document.getElementById('status')

  if (statusEl) {
    statusEl.textContent = bridge
      ? `✅ Conectado | Fonte: ${currentSource} | ${newsItems.length} notícias`
      : '⏳ Aguardando conexão com G2...'
  }

  if (newsItems.length === 0) {
    el.innerHTML = '<p>Carregando...</p>'
    return
  }

  el.innerHTML = newsItems
    .slice(0, 15)
    .map(
      (item, i) => `
    <div class="news-item" style="${i === currentIndex ? 'border-color: #0f0;' : ''}">
      <span class="news-source">${item.source}</span>
      <span class="news-time">${item.date}</span>
      <p class="news-title">${item.title}</p>
    </div>
  `
    )
    .join('')
}

// ─── Input Events ───
function setupInputHandlers() {
  if (!bridge) return

  // Touch gestures on temple tips
  bridge.addEventListener('SINGLE_TAP_EVENT', () => nextNews())
  bridge.addEventListener('DOUBLE_TAP_EVENT', () => nextSource())
  bridge.addEventListener('LONG_PRESS_EVENT', () => {
    currentIndex = 0
    fetchNews() // refresh
  })

  // Ring scroll
  bridge.addEventListener('SCROLL_DOWN_EVENT', () => nextNews())
  bridge.addEventListener('SCROLL_UP_EVENT', () => prevNews())

  // Scroll boundaries
  bridge.addEventListener('SCROLL_BOTTOM_EVENT', () => nextNews())
  bridge.addEventListener('SCROLL_TOP_EVENT', () => prevNews())

  // Head gestures
  bridge.addEventListener('NOD_DOWN_EVENT', () => nextNews())
  bridge.addEventListener('NOD_UP_EVENT', () => prevNews())

  console.log('🎮 Input handlers registered')
}

// ─── Init ───
async function init() {
  const statusEl = document.getElementById('status')

  try {
    bridge = await waitForEvenAppBridge()
    if (statusEl) statusEl.textContent = '✅ Conectado ao G2!'
    console.log('🔗 Bridge connected')

    setupInputHandlers()
    await showOnGlasses('📰 BR News', 'Carregando notícias brasileiras...')
    await fetchNews()

    // Auto-refresh every 5 minutes
    setInterval(fetchNews, 5 * 60 * 1000)
  } catch (err) {
    console.warn('Bridge not available (running in browser?)')
    if (statusEl) statusEl.textContent = '🖥 Modo browser (sem G2)'
    // Still fetch news for browser preview
    await fetchNews()
  }
}

init()
