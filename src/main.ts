import {
  waitForEvenAppBridge,
  EvenAppBridge,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
} from '@evenrealities/even_hub_sdk'

type Screen = 'sources' | 'headlines' | 'settings'

interface NewsItem {
  title: string
  source: string
  date: string
  summary: string
}

interface SourceConfig {
  name: string
  url: string
  enabled: boolean
}

interface SourceResponse {
  sources: SourceConfig[]
}

let bridge: EvenAppBridge | null = null
let glassesInitialized = false
let currentScreen: Screen = 'sources'
let selectedSourceIndex = 0
let selectedNewsIndex = 0
let expandedHeadlineIndex: number | null = null

let sourceConfigs: SourceConfig[] = [
  { name: 'O Povo', url: 'https://www.opovo.com.br/rss.xml', enabled: true },
  { name: 'Diário do Nordeste', url: 'https://diariodonordeste.verdesmares.com.br/rss.xml', enabled: true },
  { name: 'UOL', url: 'https://rss.uol.com.br/feed/noticias.xml', enabled: true },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/', enabled: true },
  { name: 'Valor Econômico', url: 'https://pox.globo.com/rss/valor/', enabled: true },
]
let sourceNames: string[] = []
let settingsDraft: SourceConfig[] = []
let settingsStatus = ''

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

function normalizeSource(source: Partial<SourceConfig>): SourceConfig | null {
  const name = String(source.name || '').trim()
  const url = String(source.url || '').trim()
  if (!name || !url) return null
  return {
    name,
    url,
    enabled: source.enabled !== false,
  }
}

function syncSourceNames() {
  sourceNames = sourceConfigs.filter((source) => source.enabled).map((source) => source.name)
  if (sourceNames.length === 0) {
    selectedSourceIndex = 0
    selectedNewsIndex = 0
    return
  }
  if (selectedSourceIndex >= sourceNames.length) {
    selectedSourceIndex = sourceNames.length - 1
  }
  selectedNewsIndex = 0
}

function syncNewsCacheKeys() {
  const validKeys = new Set(sourceNames)
  for (const key of Object.keys(newsCache)) {
    if (!validKeys.has(key)) {
      delete newsCache[key]
    }
  }
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

  const container = {
    containerTotalNum: 2,
    listObject: [list],
    textObject: [header],
  }

  if (!glassesInitialized) {
    await bridge.createStartUpPageContainer(container as CreateStartUpPageContainer)
    glassesInitialized = true
  } else {
    await bridge.rebuildPageContainer(container as RebuildPageContainer)
  }
  renderBrowserUI()
}

async function showHeadlines() {
  if (!bridge) return
  currentScreen = 'headlines'

  const sourceName = sourceNames[selectedSourceIndex]
  if (!sourceName) {
    await showOnGlasses('Sem fontes ativas', 'Ative uma fonte na tela de configurações.')
    renderBrowserUI()
    return
  }

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

  const container = {
    containerTotalNum: 2,
    textObject: [header, body],
  }

  if (!glassesInitialized) {
    await bridge.createStartUpPageContainer(container as CreateStartUpPageContainer)
    glassesInitialized = true
  } else {
    await bridge.rebuildPageContainer(container as RebuildPageContainer)
  }
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
    const sources = Array.isArray(data.sources)
      ? data.sources.map((source) => normalizeSource(source)).filter((source): source is SourceConfig => !!source)
      : []
    if (sources.length > 0) {
      sourceConfigs = sources
      syncSourceNames()
      syncNewsCacheKeys()
    }
  } catch (err) {
    console.error('Erro ao buscar fontes, usando fallback local.', err)
    syncSourceNames()
  }
}

async function fetchAllSources() {
  await Promise.all(sourceNames.map((name) => fetchSource(name)))
}

async function refreshSourcesAndNews() {
  await fetchSourcesList()
  syncNewsCacheKeys()
  await fetchAllSources()
}

function cloneSettingsFromCurrent() {
  settingsDraft = sourceConfigs.map((source) => ({ ...source }))
}

function openSettings() {
  cloneSettingsFromCurrent()
  settingsStatus = ''
  currentScreen = 'settings'
  renderBrowserUI()
}

function moveSettingItem(index: number, direction: -1 | 1) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= settingsDraft.length) return
  const next = [...settingsDraft]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  settingsDraft = next
  renderBrowserUI()
}

function deleteSettingItem(index: number) {
  const item = settingsDraft[index]
  if (!item) return
  const confirmed = window.confirm(`Remover a fonte \"${item.name}\"?`)
  if (!confirmed) return
  settingsDraft = settingsDraft.filter((_, i) => i !== index)
  settingsStatus = ''
  renderBrowserUI()
}

function updateSettingField(index: number, field: 'name' | 'url' | 'enabled', value: string | boolean) {
  const item = settingsDraft[index]
  if (!item) return
  const next = [...settingsDraft]
  if (field === 'enabled') {
    next[index] = { ...item, enabled: Boolean(value) }
  } else {
    next[index] = { ...item, [field]: String(value) }
  }
  settingsDraft = next
}

async function saveSettings() {
  const normalized = settingsDraft
    .map((source) => normalizeSource(source))
    .filter((source): source is SourceConfig => !!source)

  const names = new Set<string>()
  for (const source of normalized) {
    if (names.has(source.name)) {
      settingsStatus = `Nome duplicado: ${source.name}`
      renderBrowserUI()
      return
    }
    names.add(source.name)
  }

  try {
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: normalized }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      settingsStatus = err.error || 'Falha ao salvar configurações.'
      renderBrowserUI()
      return
    }

    settingsStatus = 'Configurações salvas. Atualizando notícias...'
    renderBrowserUI()

    await refreshSourcesAndNews()
    expandedHeadlineIndex = null
    currentScreen = 'sources'

    if (bridge) {
      await showSourceList()
    } else {
      renderBrowserUI()
    }
  } catch (err) {
    settingsStatus = 'Erro de rede ao salvar configurações.'
    renderBrowserUI()
  }
}

function addSettingItem(name: string, url: string) {
  const next = normalizeSource({ name, url, enabled: true })
  if (!next) {
    settingsStatus = 'Preencha nome e URL válidos.'
    renderBrowserUI()
    return
  }

  if (settingsDraft.some((source) => source.name === next.name)) {
    settingsStatus = `Já existe uma fonte chamada ${next.name}.`
    renderBrowserUI()
    return
  }

  settingsDraft = [...settingsDraft, next]
  settingsStatus = ''
  renderBrowserUI()
}

function handleDown() {
  if (currentScreen === 'sources') {
    if (sourceNames.length === 0) return
    selectedSourceIndex = (selectedSourceIndex + 1) % sourceNames.length
    showSourceList()
  } else if (currentScreen === 'headlines') {
    const sourceName = sourceNames[selectedSourceIndex]
    if (!sourceName) return
    const items = newsCache[sourceName] || []
    if (items.length === 0) return
    selectedNewsIndex = (selectedNewsIndex + 1) % items.length
    showHeadlines()
  }
}

function handleUp() {
  if (currentScreen === 'sources') {
    if (sourceNames.length === 0) return
    selectedSourceIndex = (selectedSourceIndex - 1 + sourceNames.length) % sourceNames.length
    showSourceList()
  } else if (currentScreen === 'headlines') {
    const sourceName = sourceNames[selectedSourceIndex]
    if (!sourceName) return
    const items = newsCache[sourceName] || []
    if (items.length === 0) return
    selectedNewsIndex = (selectedNewsIndex - 1 + items.length) % items.length
    showHeadlines()
  }
}

function handleSelect() {
  if (currentScreen === 'sources') {
    if (sourceNames.length === 0) return
    selectedNewsIndex = 0
    expandedHeadlineIndex = null
    showHeadlines()
  }
}

function handleBack() {
  if (currentScreen === 'headlines') {
    showSourceList()
    return
  }
  if (currentScreen === 'settings') {
    currentScreen = 'sources'
    if (bridge) {
      showSourceList()
    } else {
      renderBrowserUI()
    }
  }
}

function handleRefresh() {
  refreshSourcesAndNews().then(() => {
    if (currentScreen === 'settings') {
      renderBrowserUI()
      return
    }
    if (currentScreen === 'sources') {
      showSourceList()
      return
    }
    showHeadlines()
  })
}

function setupInputHandlers() {
  if (!bridge) return

  bridge.onEvenHubEvent((event) => {
    // Log ALL events for debugging
    const debugEl = document.getElementById('debug-log')
    const logDebug = (msg: string) => {
      console.log(`[BR News] ${msg}`)
      if (debugEl) {
        debugEl.textContent += `${new Date().toLocaleTimeString()}: ${msg}\n`
        debugEl.scrollTop = debugEl.scrollHeight
      }
    }

    logDebug(`Event: ${JSON.stringify(event)}`)

    // List events (scroll/select on list containers)
    if (event.listEvent) {
      const ev = event.listEvent as Record<string, unknown>
      logDebug(`listEvent: ${JSON.stringify(ev)}`)
      const idx = ev.currentSelectItemIndex as number | undefined
      if (idx !== undefined && idx >= 0) {
        // Scroll — update selection
        if (currentScreen === 'sources') {
          selectedSourceIndex = idx
          logDebug(`Navegando: ${sourceNames[idx]} (index ${idx})`)
          renderBrowserUI()
        } else if (currentScreen === 'headlines') {
          const items = newsCache[sourceNames[selectedSourceIndex]] || []
          if (idx < items.length) {
            selectedNewsIndex = idx
            logDebug(`Notícia: ${idx}`)
            showHeadlines()
          }
        }
      } else {
        // Tap/click on list (no index change) — confirm selection
        logDebug(`Tap confirmado! Tela: ${currentScreen}`)
        handleSelect()
      }
    }

    // Text events (scroll/click no container de texto — tela de notícias)
    if (event.textEvent) {
      const ev = event.textEvent as Record<string, unknown>
      const evType = Number(ev.eventType)
      logDebug(`textEvent type: ${evType}`)

      switch (evType) {
        case 0: // CLICK no texto
          handleSelect()
          break
        case 1: // SCROLL_TOP — notícia anterior
          handleUp()
          break
        case 2: // SCROLL_BOTTOM — próxima notícia
          handleDown()
          break
        case 3: // DOUBLE_CLICK — voltar
          handleBack()
          break
      }
    }

    // System events — OsEventTypeList enum:
    // 0=CLICK, 1=SCROLL_TOP, 2=SCROLL_BOTTOM, 3=DOUBLE_CLICK
    // 4=FOREGROUND_ENTER, 5=FOREGROUND_EXIT, 6=ABNORMAL_EXIT
    //
    // Na prática do G2+R1:
    // - Swipe no anel = listEvent com currentSelectItemIndex (navegação)
    // - Tap no anel = sysEvent 3 (DOUBLE_CLICK) = confirmar/selecionar
    // - CLICK (0) = tap na haste dos óculos = voltar
    if (event.sysEvent) {
      const ev = event.sysEvent as Record<string, unknown>
      const type = Number(ev.eventType)
      logDebug(`sysEvent type: ${type}`)

      if (isNaN(type)) return // ignore empty sysEvents

      // sysEvent 3 (double tap / tap no anel) = voltar
      switch (type) {
        case 0: // CLICK
          logDebug('sysEvent CLICK')
          handleSelect()
          break
        case 1: // SCROLL_TOP
          handleUp()
          break
        case 2: // SCROLL_BOTTOM
          handleDown()
          break
        case 3: // DOUBLE_CLICK (tap no anel) — voltar
          logDebug('Double tap → voltando')
          handleBack()
          break
      }
    }
  })
}

function renderBrowserUI() {
  const statusEl = document.getElementById('status')
  const viewEl = document.getElementById('browser-view')
  const settingsButton = document.getElementById('header-settings-button') as HTMLButtonElement | null
  if (!statusEl || !viewEl) return

  const screenLabel =
    currentScreen === 'sources'
      ? 'Fontes'
      : currentScreen === 'headlines'
        ? sourceNames[selectedSourceIndex] || 'Manchetes'
        : 'Configurações'

  statusEl.textContent = bridge ? `Conectado ao G2 | Tela: ${screenLabel}` : 'Modo browser (sem G2)'

  if (settingsButton) {
    settingsButton.disabled = currentScreen === 'settings'
    settingsButton.classList.toggle('active', currentScreen === 'settings')
  }

  if (currentScreen === 'settings') {
    const rows =
      settingsDraft.length === 0
        ? '<div class="empty-state">Nenhuma fonte configurada.</div>'
        : settingsDraft
            .map((source, index) => {
              return `
          <article class="card settings-source-item">
            <div class="settings-source-grid">
              <label class="settings-field">
                <span>Nome</span>
                <input
                  data-role="settings-input"
                  data-field="name"
                  data-index="${index}"
                  value="${escapeHtml(source.name)}"
                  type="text"
                  class="settings-input"
                />
              </label>
              <label class="settings-field">
                <span>URL RSS</span>
                <input
                  data-role="settings-input"
                  data-field="url"
                  data-index="${index}"
                  value="${escapeHtml(source.url)}"
                  type="url"
                  class="settings-input"
                />
              </label>
            </div>
            <div class="settings-item-actions">
              <label class="settings-toggle-wrap">
                <input
                  data-role="settings-input"
                  data-field="enabled"
                  data-index="${index}"
                  ${source.enabled ? 'checked' : ''}
                  type="checkbox"
                />
                <span>Ativa</span>
              </label>
              <div class="settings-reorder-actions">
                <button class="reorder-button" data-role="settings-move-up" data-index="${index}" type="button">↑</button>
                <button class="reorder-button" data-role="settings-move-down" data-index="${index}" type="button">↓</button>
              </div>
              <button class="delete-button" data-role="settings-delete" data-index="${index}" type="button">Remover</button>
            </div>
          </article>
        `
            })
            .join('')

    viewEl.className = 'view settings'
    viewEl.innerHTML = `
      <div class="view-header">
        <button class="back-button" data-role="settings-back" type="button">Voltar</button>
        <h2 class="view-title">Configurações</h2>
        <button class="save-button" data-role="settings-save" type="button">Salvar</button>
      </div>
      ${settingsStatus ? `<div class="settings-status">${escapeHtml(settingsStatus)}</div>` : ''}
      ${rows}
      <form class="card settings-add-form" data-role="settings-add-form">
        <h3>Adicionar fonte</h3>
        <label class="settings-field">
          <span>Nome</span>
          <input name="name" class="settings-input" placeholder="Ex: Agência Brasil" required />
        </label>
        <label class="settings-field">
          <span>URL RSS</span>
          <input name="url" type="url" class="settings-input" placeholder="https://..." required />
        </label>
        <button class="save-button" type="submit">Adicionar</button>
      </form>
    `
    return
  }

  if (currentScreen === 'sources') {
    const cards =
      sourceNames.length === 0
        ? '<div class="empty-state">Nenhuma fonte ativa. Use o botão de configurações.</div>'
        : sourceNames
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
  const items = sourceName ? newsCache[sourceName] || [] : []

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
      <h2 class="view-title">${escapeHtml(sourceName || 'Sem fonte')}</h2>
      <div></div>
    </div>
    ${content}
  `
}

function onBrowserInput(event: Event) {
  const target = event.target as HTMLElement
  const input = target.closest<HTMLInputElement>('[data-role="settings-input"]')
  if (!input) return

  const index = Number(input.dataset.index || -1)
  const field = input.dataset.field as 'name' | 'url' | 'enabled' | undefined
  if (index < 0 || !field) return

  if (field === 'enabled') {
    updateSettingField(index, field, input.checked)
  } else {
    updateSettingField(index, field, input.value)
  }
}

function onBrowserSubmit(event: SubmitEvent) {
  const form = event.target as HTMLFormElement
  if (!form.matches('[data-role="settings-add-form"]')) return
  event.preventDefault()

  const nameInput = form.elements.namedItem('name') as HTMLInputElement | null
  const urlInput = form.elements.namedItem('url') as HTMLInputElement | null
  if (!nameInput || !urlInput) return

  addSettingItem(nameInput.value, urlInput.value)
  nameInput.value = ''
  urlInput.value = ''
}

function onBrowserClick(event: MouseEvent) {
  const target = event.target as HTMLElement

  const openSettingsButton = target.closest<HTMLElement>('[data-role="open-settings"]')
  if (openSettingsButton) {
    openSettings()
    return
  }

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

  const settingsBack = target.closest<HTMLElement>('[data-role="settings-back"]')
  if (settingsBack) {
    currentScreen = 'sources'
    if (bridge) {
      showSourceList()
    } else {
      renderBrowserUI()
    }
    return
  }

  const settingsSave = target.closest<HTMLElement>('[data-role="settings-save"]')
  if (settingsSave) {
    saveSettings()
    return
  }

  const moveUp = target.closest<HTMLElement>('[data-role="settings-move-up"]')
  if (moveUp) {
    moveSettingItem(Number(moveUp.dataset.index || -1), -1)
    return
  }

  const moveDown = target.closest<HTMLElement>('[data-role="settings-move-down"]')
  if (moveDown) {
    moveSettingItem(Number(moveDown.dataset.index || -1), 1)
    return
  }

  const deleteButton = target.closest<HTMLElement>('[data-role="settings-delete"]')
  if (deleteButton) {
    deleteSettingItem(Number(deleteButton.dataset.index || -1))
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
  const headerSettingsButton = document.getElementById('header-settings-button')

  syncSourceNames()
  await fetchSourcesList()
  await fetchAllSources()

  if (browserView) {
    browserView.addEventListener('click', onBrowserClick)
    browserView.addEventListener('input', onBrowserInput)
    browserView.addEventListener('submit', onBrowserSubmit)
  }

  if (headerSettingsButton) {
    headerSettingsButton.setAttribute('data-role', 'open-settings')
    headerSettingsButton.addEventListener('click', () => openSettings())
  }

  const debugLog = (msg: string) => {
    console.log(`[BR News] ${msg}`)
    const el = document.getElementById('debug-log')
    if (el) {
      el.textContent += `${new Date().toLocaleTimeString()}: ${msg}\n`
      el.scrollTop = el.scrollHeight
    }
  }

  debugLog('Iniciando app...')
  debugLog(`Fontes: ${sourceNames.join(', ')}`)
  debugLog('Aguardando Even App Bridge...')

  try {
    bridge = await waitForEvenAppBridge()
    debugLog(`✅ Bridge conectada!`)
    if (statusEl) statusEl.textContent = '✅ Conectado ao G2'

    const deviceInfo = await bridge.getDeviceInfo()
    debugLog(`Device: ${deviceInfo ? JSON.stringify(deviceInfo) : 'null'}`)

    const userInfo = await bridge.getUserInfo()
    debugLog(`User: ${userInfo ? userInfo.name : 'null'}`)

    setupInputHandlers()
    debugLog('Input handlers registrados')

    debugLog('Criando containers nos óculos...')
    await showSourceList()
    debugLog('✅ Containers criados!')

    setInterval(() => {
      refreshSourcesAndNews().then(() => {
        if (currentScreen === 'settings') {
          renderBrowserUI()
          return
        }
        if (currentScreen === 'sources') {
          showSourceList()
          return
        }
        showHeadlines()
      })
    }, 5 * 60 * 1000)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    debugLog(`❌ Erro: ${errMsg}`)
    if (statusEl) statusEl.textContent = `❌ ${errMsg}`
    renderBrowserUI()
  }
}

init()
