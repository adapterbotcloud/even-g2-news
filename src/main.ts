import {
  waitForEvenAppBridge,
  EvenAppBridge,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk'

type Screen = 'sources' | 'headlines'

interface NewsItem {
  title: string
  source: string
  date: string
  summary: string
}

interface SourceResponse {
  sources: Array<{ name: string }>
}

let bridge: EvenAppBridge | null = null
let currentScreen: Screen = 'sources'
let selectedSourceIndex = 0
let selectedNewsIndex = 0
let expandedHeadlineIndex: number | null = null

let sourceNames: string[] = ['G1', 'Folha', 'Valor', 'Estadão', 'Folha Pol']
const newsCache: Record<string, NewsItem[]> = {}

const W = 576
const H = 288

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 3)}...`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function showSourceList() {
  if (!bridge) return
  currentScreen = 'sources'

  const header = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: 36,
    borderWidth: 1,
    borderColor: 10,
    borderRdaius: 0,
    paddingLength: 4,
    containerID: 1,
    containerName: 'header',
    content: '📰 BR News ── Escolha a fonte',
    isEventCapture: 0,
  })

  const items = sourceNames.map((name, i) => {
    const cached = newsCache[name]
    const count = cached ? `(${cached.length})` : ''
    const marker = i === selectedSourceIndex ? '→ ' : '  '
    return `${marker}${name} ${count}`
  })

  const list = new ListContainerProperty({
    xPosition: 0,
    yPosition: 40,
    width: W,
    height: H - 40,
    borderWidth: 0,
    borderColor: 5,
    borderRdaius: 0,
    paddingLength: 6,
    containerID: 2,
    containerName: 'list',
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemName: items,
    }),
    isEventCapture: 1,
  })

  await bridge.createStartUpPageContainer(2, [header, list])
  renderBrowserUI()
}

async function showHeadlines() {
  if (!bridge) return
  currentScreen = 'headlines'

  const sourceName = sourceNames[selectedSourceIndex]
  const items = newsCache[sourceName] || []

  if (items.length === 0) {
    await showOnGlasses(sourceName, 'Carregando notícias...')
    await fetchSource(sourceName)
    return
  }

  const item = items[selectedNewsIndex]
  if (!item) return

  const header = `← ${sourceName} [${selectedNewsIndex + 1}/${items.length}]`
  let body = `${item.title}\n`
  if (item.date) body += `${item.date}\n`
  body += `\n${item.summary || ''}`

  await showOnGlasses(header, body)
  renderBrowserUI()
}

async function showOnGlasses(headerText: string, bodyText: string) {
  if (!bridge) return

  const header = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: 36,
    borderWidth: 1,
    borderColor: 10,
    borderRdaius: 0,
    paddingLength: 4,
    containerID: 1,
    containerName: 'header',
    content: truncate(headerText, 100),
    isEventCapture: 0,
  })

  const body = new TextContainerProperty({
    xPosition: 0,
    yPosition: 40,
    width: W,
    height: H - 40,
    borderWidth: 0,
    borderColor: 5,
    borderRdaius: 0,
    paddingLength: 6,
    containerID: 2,
    containerName: 'body',
    content: truncate(bodyText, 900),
    isEventCapture: 1,
  })

  await bridge.createStartUpPageContainer(2, [header, body])
}

async function fetchSource(sourceName: string) {
  try {
    const res = await fetch(`/api/news?source=${encodeURIComponent(sourceName)}`)
    const data = await res.json()
    newsCache[sourceName] = (data.items || []).slice(0, 5)
  } catch (err) {
    console.error(`Erro ${sourceName}:`, err)
    newsCache[sourceName] = []
  }
}

async function fetchSourcesList() {
  try {
    const res = await fetch('/api/sources')
    const data = (await res.json()) as SourceResponse
    const names = (data.sources || []).map((s) => s.name).filter(Boolean)
    if (names.length > 0) {
      sourceNames = names
    }
  } catch (err) {
    console.error('Erro ao buscar fontes, usando fallback local.', err)
  }
}

async function fetchAllSources() {
  await Promise.all(sourceNames.map((name) => fetchSource(name)))
}

function handleDown() {
  if (currentScreen === 'sources') {
    selectedSourceIndex = (selectedSourceIndex + 1) % sourceNames.length
    showSourceList()
  } else {
    const items = newsCache[sourceNames[selectedSourceIndex]] || []
    if (items.length === 0) return
    selectedNewsIndex = (selectedNewsIndex + 1) % items.length
    showHeadlines()
  }
}

function handleUp() {
  if (currentScreen === 'sources') {
    selectedSourceIndex = (selectedSourceIndex - 1 + sourceNames.length) % sourceNames.length
    showSourceList()
  } else {
    const items = newsCache[sourceNames[selectedSourceIndex]] || []
    if (items.length === 0) return
    selectedNewsIndex = (selectedNewsIndex - 1 + items.length) % items.length
    showHeadlines()
  }
}

function handleSelect() {
  if (currentScreen === 'sources') {
    selectedNewsIndex = 0
    expandedHeadlineIndex = null
    showHeadlines()
  }
}

function handleBack() {
  if (currentScreen === 'headlines') {
    showSourceList()
  }
}

function handleRefresh() {
  fetchAllSources().then(() => {
    if (currentScreen === 'sources') {
      showSourceList()
      return
    }
    showHeadlines()
  })
}

function setupInputHandlers() {
  if (!bridge) return

  bridge.addEventListener('SINGLE_TAP_EVENT', () => handleSelect())
  bridge.addEventListener('DOUBLE_TAP_EVENT', () => handleBack())
  bridge.addEventListener('LONG_PRESS_EVENT', () => handleRefresh())

  bridge.addEventListener('SCROLL_DOWN_EVENT', () => handleDown())
  bridge.addEventListener('SCROLL_UP_EVENT', () => handleUp())
  bridge.addEventListener('SCROLL_BOTTOM_EVENT', () => handleDown())
  bridge.addEventListener('SCROLL_TOP_EVENT', () => handleUp())

  bridge.addEventListener('NOD_DOWN_EVENT', () => handleDown())
  bridge.addEventListener('NOD_UP_EVENT', () => handleUp())
}

function renderBrowserUI() {
  const statusEl = document.getElementById('status')
  const viewEl = document.getElementById('browser-view')
  if (!statusEl || !viewEl) return

  statusEl.textContent = bridge
    ? `Conectado ao G2 | Tela: ${currentScreen === 'sources' ? 'Fontes' : sourceNames[selectedSourceIndex]}`
    : 'Modo browser (sem G2)'

  if (currentScreen === 'sources') {
    const cards = sourceNames
      .map((name, index) => {
        const count = newsCache[name]?.length || 0
        return `
        <button class="card source-card" data-role="source-card" data-source-index="${index}">
          <h3 class="source-card-title">${escapeHtml(name)}</h3>
          <div class="source-card-meta">${count} manchetes</div>
        </button>
      `
      })
      .join('')

    viewEl.className = 'view sources'
    viewEl.innerHTML = `
      <div class="view-header">
        <h2 class="view-title">Fontes</h2>
      </div>
      ${cards}
    `
    return
  }

  const sourceName = sourceNames[selectedSourceIndex]
  const items = newsCache[sourceName] || []

  const content =
    items.length === 0
      ? '<div class="empty-state">Nenhuma notícia disponível para esta fonte.</div>'
      : items
          .map((item, index) => {
            const isExpanded = expandedHeadlineIndex === index
            return `
          <article class="headline-item card">
            <button class="headline-toggle" data-role="headline-toggle" data-headline-index="${index}">
              <h3 class="headline-title">${escapeHtml(item.title || 'Sem título')}</h3>
              <div class="headline-date">${escapeHtml(item.date || 'Data indisponível')}</div>
            </button>
            ${
              isExpanded
                ? `<div class="headline-content">${escapeHtml(item.summary || 'Sem resumo disponível.')}</div>`
                : ''
            }
          </article>
        `
          })
          .join('')

  viewEl.className = 'view headlines'
  viewEl.innerHTML = `
    <div class="view-header">
      <button class="back-button" data-role="back-button" type="button">Voltar</button>
      <h2 class="view-title">${escapeHtml(sourceName)}</h2>
      <div></div>
    </div>
    ${content}
  `
}

function onBrowserClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const sourceCard = target.closest<HTMLElement>('[data-role="source-card"]')
  if (sourceCard) {
    selectedSourceIndex = Number(sourceCard.dataset.sourceIndex || 0)
    selectedNewsIndex = 0
    expandedHeadlineIndex = null
    currentScreen = 'headlines'
    if (bridge) {
      showHeadlines()
    } else {
      renderBrowserUI()
    }
    return
  }

  const backButton = target.closest<HTMLElement>('[data-role="back-button"]')
  if (backButton) {
    currentScreen = 'sources'
    expandedHeadlineIndex = null
    if (bridge) {
      showSourceList()
    } else {
      renderBrowserUI()
    }
    return
  }

  const headlineToggle = target.closest<HTMLElement>('[data-role="headline-toggle"]')
  if (headlineToggle) {
    const index = Number(headlineToggle.dataset.headlineIndex || 0)
    expandedHeadlineIndex = expandedHeadlineIndex === index ? null : index
    selectedNewsIndex = index
    if (bridge) {
      showHeadlines()
    } else {
      renderBrowserUI()
    }
  }
}

async function init() {
  const statusEl = document.getElementById('status')
  const browserView = document.getElementById('browser-view')

  await fetchSourcesList()
  await fetchAllSources()

  if (browserView) {
    browserView.addEventListener('click', onBrowserClick)
  }

  try {
    bridge = await waitForEvenAppBridge()
    if (statusEl) statusEl.textContent = 'Conectado ao G2'
    setupInputHandlers()
    await showSourceList()
    setInterval(() => {
      fetchAllSources().then(() => {
        if (currentScreen === 'sources') {
          showSourceList()
          return
        }
        showHeadlines()
      })
    }, 5 * 60 * 1000)
  } catch {
    if (statusEl) statusEl.textContent = 'Modo browser (sem G2)'
    renderBrowserUI()
  }
}

init()
