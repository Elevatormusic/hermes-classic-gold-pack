/* global localStorage, MutationObserver */

/**
 * Classic Gold runtime plug-in for Hermes Desktop.
 *
 * Hermes loads this file from HERMES_HOME at run time. The plug-in does not
 * change Hermes source files. The pack installer embeds the original pixel
 * wordmark in place of WORDMARK_TOKEN before it writes this file.
 */
import {
  atom,
  Button,
  ConfirmDialog,
  DEFAULT_REASONING_EFFORT,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  host,
  Input,
  PALETTE_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  REASONING_EFFORT_VALUES,
  reasoningEffortLabel,
  ROUTES_AREA,
  SegmentedControl,
  STATUSBAR_AREAS,
  Switch,
  THEMES_AREA,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'classic-gold'
const STYLE_ID = 'classic-gold-runtime-style'
const WORDMARK_TOKEN = '__CLASSIC_GOLD_WORDMARK_DATA_URI__'
const WORDMARK_DATA_URI = WORDMARK_TOKEN
const USER_THEMES_KEY = 'hermes-desktop-user-themes-v1'
const THEME_MIRROR_OWNER_KEY = 'hermes-classic-gold-pack.theme-mirror-v1'
const SETTINGS_KEY = 'settings-v1'
const COMPOSER_MODEL_PATH = '[data-chat-surface][data-composer-target="main"] [data-slot="composer-dock"]:not([data-popped-out]) [data-slot="composer-surface"] [class*="grid-area:controls"] > div:last-child > button:first-child'

const DEFAULT_SETTINGS = {
  density: 'full',
  preset: 'original',
  show: {
    activity: true,
    context: true,
    cost: true,
    gateway: false,
    hardware: true,
    model: true,
    profile: false,
    provider: true,
    reasoning: true,
    sessions: false,
    speed: true,
    timer: true,
    tokens: false,
    workspace: false
  },
  visuals: {
    caduceus: true,
    caduceusOpacity: 42,
    caduceusScale: 116,
    hideComposerModel: true,
    replaceBackdrop: true,
    tapeFontScale: 100,
    wordmark: true,
    wordmarkScale: 100
  }
}

const SETTINGS_FIELDS = [
  ['activity', 'Run state'],
  ['model', 'Model'],
  ['reasoning', 'Reasoning'],
  ['provider', 'Provider'],
  ['context', 'Context'],
  ['speed', 'Turn rate'],
  ['cost', 'Session cost'],
  ['timer', 'Session time'],
  ['hardware', 'RAM and VRAM'],
  ['tokens', 'Input and output'],
  ['gateway', 'Gateway state'],
  ['profile', 'Profile'],
  ['sessions', 'Live sessions'],
  ['workspace', 'Workspace']
]

const DENSITY_OPTIONS = [
  { id: 'full', label: 'Original' },
  { id: 'compact', label: 'Compact' }
]

const PRESET_OPTIONS = [
  { id: 'dim', label: 'Dim' },
  { id: 'original', label: 'Original' },
  { id: 'contrast', label: 'Contrast' }
]

const settingsAtom = atom(DEFAULT_SETTINGS)
const settingsReturnRouteAtom = atom('/')

function syncComposerModelTargets (scope = document) {
  const current = new Set(scope.querySelectorAll(COMPOSER_MODEL_PATH))
  scope.querySelectorAll('[data-classic-gold-composer-model]').forEach(button => {
    if (!current.has(button)) delete button.dataset.classicGoldComposerModel
  })
  current.forEach(button => {
    button.dataset.classicGoldComposerModel = ''
  })
  return current.size
}

function openClassicGoldSettings () {
  const current = window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : '/'
  if (current !== '/classic-gold') settingsReturnRouteAtom.set(current || '/')
  host.navigate('/classic-gold')
}

const COLORS = {
  amber: 'rgba(255, 191, 0, 0.26)',
  bronze: 'rgba(205, 127, 50, 0.28)',
  darkGold: 'rgba(184, 134, 11, 0.24)',
  gold: 'rgba(255, 215, 0, 0.3)'
}

const CADUCEUS = [
  { tone: 'bronze', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⡀⠀⣀⣀⠀⢀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'bronze', text: '⠀⠀⠀⠀⠀⠀⢀⣠⣴⣾⣿⣿⣇⠸⣿⣿⠇⣸⣿⣿⣷⣦⣄⡀⠀⠀⠀⠀⠀⠀' },
  { tone: 'amber', text: '⠀⢀⣠⣴⣶⠿⠋⣩⡿⣿⡿⠻⣿⡇⢠⡄⢸⣿⠟⢿⣿⢿⣍⠙⠿⣶⣦⣄⡀⠀' },
  { tone: 'amber', text: '⠀⠀⠉⠉⠁⠶⠟⠋⠀⠉⠀⢀⣈⣁⡈⢁⣈⣁⡀⠀⠉⠀⠙⠻⠶⠈⠉⠉⠀⠀' },
  { tone: 'gold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣿⡿⠛⢁⡈⠛⢿⣿⣦⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'gold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⣿⣦⣤⣈⠁⢠⣴⣿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'amber', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠻⢿⣿⣦⡉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'amber', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⢷⣦⣈⠛⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'bronze', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣴⠦⠈⠙⠿⣦⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'bronze', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣿⣤⡈⠁⢤⣿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠛⠷⠄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⠑⢶⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⠁⢰⡆⠈⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⠈⣡⠞⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' }
]

const classicGoldTheme = {
  name: 'hermes-classic-gold',
  label: 'Classic Hermes',
  description: 'Warm gold borders, cornsilk text, and a monospaced interface',
  classicGoldPack: true,
  colors: {
    background: '#FFFDF6',
    foreground: '#3A2E12',
    card: '#FFFFFF',
    cardForeground: '#3A2E12',
    muted: '#F5EED9',
    mutedForeground: '#7A6A3A',
    popover: '#FFFFFF',
    popoverForeground: '#3A2E12',
    primary: '#B8860B',
    primaryForeground: '#FFFDF6',
    secondary: '#F0E6C8',
    secondaryForeground: '#3A2E12',
    accent: '#CD7F32',
    accentForeground: '#FFFDF6',
    border: '#CD7F32',
    input: '#E8DCB8',
    ring: '#B8860B',
    midground: '#CD7F32',
    composerRing: '#B8860B',
    destructive: '#C72E4D',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#FBF6E8',
    sidebarBorder: '#DAA520',
    userBubble: '#F5EED9',
    userBubbleBorder: '#DAA520'
  },
  darkColors: {
    background: '#1A160F',
    foreground: '#FFF8DC',
    card: '#241E15',
    cardForeground: '#FFF8DC',
    muted: '#2E2717',
    mutedForeground: '#C9B78A',
    popover: '#241E15',
    popoverForeground: '#FFF8DC',
    primary: '#FFD700',
    primaryForeground: '#1A160F',
    secondary: '#3A311D',
    secondaryForeground: '#FFF8DC',
    accent: '#CD7F32',
    accentForeground: '#1A160F',
    border: '#CD7F32',
    input: '#2E2717',
    ring: '#FFD700',
    midground: '#B8860B',
    composerRing: '#FFD700',
    destructive: '#C0473A',
    destructiveForeground: '#FEF2F2',
    sidebarBackground: '#14110B',
    sidebarBorder: '#8B6914',
    userBubble: '#2A2315',
    userBubbleBorder: '#B8860B'
  },
  typography: {
    fontSans: '"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace, "Segoe UI Emoji", "Segoe UI Symbol", emoji',
    fontMono: '"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace, "Segoe UI Emoji", "Segoe UI Symbol", emoji'
  }
}

const boundedNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function mergeUsageMonotonic (current = {}, incoming = {}) {
  const merged = { ...current, ...incoming }
  for (const key of ['calls', 'input', 'output', 'total']) {
    merged[key] = Math.max(boundedNumber(current[key]), boundedNumber(incoming[key]))
  }
  return merged
}

function completedTurnSpeed ({ baselineReady, completedAt, outputAtStart, startedAt, usage }) {
  if (!baselineReady || !startedAt || completedAt <= startedAt) return null
  const outputDelta = Math.max(0, boundedNumber(usage?.output) - boundedNumber(outputAtStart))
  if (outputDelta <= 0) return null
  return outputDelta / Math.max(0.001, (completedAt - startedAt) / 1000)
}

function shouldHideComposerModel (settings) {
  return Boolean(settings.visuals.hideComposerModel && settings.show.model)
}

const clampedNumber = (value, minimum, maximum, fallback) => (
  Math.max(minimum, Math.min(maximum, boundedNumber(value, fallback)))
)

function sanitizeSettings (value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rawShow = raw.show && typeof raw.show === 'object' && !Array.isArray(raw.show) ? raw.show : {}
  const rawVisuals = raw.visuals && typeof raw.visuals === 'object' && !Array.isArray(raw.visuals) ? raw.visuals : {}
  const show = {}
  for (const key of Object.keys(DEFAULT_SETTINGS.show)) {
    show[key] = typeof rawShow[key] === 'boolean' ? rawShow[key] : DEFAULT_SETTINGS.show[key]
  }
  return {
    density: DENSITY_OPTIONS.some(option => option.id === raw.density) ? raw.density : DEFAULT_SETTINGS.density,
    preset: PRESET_OPTIONS.some(option => option.id === raw.preset) ? raw.preset : DEFAULT_SETTINGS.preset,
    show,
    visuals: {
      caduceus: typeof rawVisuals.caduceus === 'boolean' ? rawVisuals.caduceus : DEFAULT_SETTINGS.visuals.caduceus,
      caduceusOpacity: clampedNumber(rawVisuals.caduceusOpacity, 15, 55, DEFAULT_SETTINGS.visuals.caduceusOpacity),
      caduceusScale: clampedNumber(rawVisuals.caduceusScale, 85, 125, DEFAULT_SETTINGS.visuals.caduceusScale),
      hideComposerModel: typeof rawVisuals.hideComposerModel === 'boolean'
        ? rawVisuals.hideComposerModel
        : DEFAULT_SETTINGS.visuals.hideComposerModel,
      replaceBackdrop: typeof rawVisuals.replaceBackdrop === 'boolean'
        ? rawVisuals.replaceBackdrop
        : DEFAULT_SETTINGS.visuals.replaceBackdrop,
      tapeFontScale: clampedNumber(rawVisuals.tapeFontScale, 90, 110, DEFAULT_SETTINGS.visuals.tapeFontScale),
      wordmark: typeof rawVisuals.wordmark === 'boolean' ? rawVisuals.wordmark : DEFAULT_SETTINGS.visuals.wordmark,
      wordmarkScale: clampedNumber(rawVisuals.wordmarkScale, 85, 110, DEFAULT_SETTINGS.visuals.wordmarkScale)
    }
  }
}

function pathLeaf (value) {
  const parts = String(value || '').split(/[\\/]+/).filter(Boolean)
  return parts.at(-1) || 'workspace'
}

function compactNumber (value) {
  const number = Math.max(0, boundedNumber(value))
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1)}K`
  return String(Math.round(number))
}

function contextPercent (usage) {
  const maximum = boundedNumber(usage.context_max)
  if (maximum > 0) return Math.max(0, Math.min(100, (boundedNumber(usage.context_used) / maximum) * 100))
  return Math.max(0, Math.min(100, boundedNumber(usage.context_percent)))
}

function contextLabel (usage) {
  const maximum = boundedNumber(usage.context_max)
  if (maximum > 0) return `${compactNumber(usage.context_used)}/${compactNumber(maximum)}`
  return `${compactNumber(usage.total)}tok`
}

function contextMeter (percent, width = 8) {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

function effortCode (value, fast = false) {
  if (fast) return 'F'
  const effort = String(value || '').trim().toLowerCase()
  if (effort.startsWith('max') || effort.startsWith('xhigh')) return 'X'
  if (effort.startsWith('high')) return 'H'
  if (effort.startsWith('med')) return 'M'
  if (effort.startsWith('low')) return 'L'
  if (effort.startsWith('min') || effort === 'none') return 'N'
  if (effort.startsWith('fast')) return 'F'
  return '-'
}

function providerView (value) {
  const provider = String(value || '').trim()
  const local = /custom|local|ollama|lm[ -]?studio|llama\.cpp|vllm|dgx/i.test(provider)
  const label = /lm[ -]?studio/i.test(provider)
    ? 'LM Studio'
    : /ollama/i.test(provider)
      ? 'Ollama'
      : /vllm/i.test(provider)
        ? 'vLLM'
        : /llama\.cpp/i.test(provider)
          ? 'llama.cpp'
          : /dgx/i.test(provider)
            ? 'DGX Spark'
            : /openai|codex/i.test(provider)
              ? 'OpenAI'
              : provider || 'API'
  return { label, symbol: local ? '⌂' : '☁' }
}

function formatSpeed (speed) {
  if (!Number.isFinite(speed) || speed <= 0) return '--/s'
  return speed >= 10 ? `${speed.toFixed(0)}/s` : `${speed.toFixed(1)}/s`
}

function formatCost (cost) {
  if (cost?.status === 'included') return '0.00'
  if (cost?.status !== 'actual' || !Number.isFinite(cost.actual_cost_usd)) return '--'
  const amount = Math.max(0, cost.actual_cost_usd)
  return amount > 0 && amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2)
}

function formatBytes (value, decimals = 1) {
  const bytes = boundedNumber(value, -1)
  if (bytes < 0) return '--'
  return (bytes / 1024 ** 3).toFixed(decimals)
}

function formatMemory (resource) {
  if (resource?.status !== 'ok' || boundedNumber(resource.total_bytes) <= 0) return '--/--G'
  return `${formatBytes(resource.used_bytes)}/${formatBytes(resource.total_bytes, 0)}G`
}

function ContextDetails ({ sessionId }) {
  const [state, setState] = useState({ data: null, loading: Boolean(sessionId) })

  useEffect(() => {
    if (!sessionId) {
      setState({ data: null, loading: false })
      return
    }
    let live = true
    setState({ data: null, loading: true })
    host.request('session.context_breakdown', { session_id: sessionId })
      .then(data => {
        if (live) setState({ data, loading: false })
      })
      .catch(error => {
        if (live) {
          setState({ data: null, loading: false })
          host.notifyError(error, 'Could not load context details')
        }
      })
    return () => {
      live = false
    }
  }, [sessionId])

  const data = state.data
  return jsxs('div', {
    className: 'classic-gold-context-panel',
    'data-classic-gold-context-details': '',
    children: [
      jsx('strong', { children: 'Context usage' }),
      jsx('span', {
        className: 'classic-gold-dim',
        children: data
          ? `${compactNumber(data.context_used)}/${compactNumber(data.context_max)} · ${Math.round(data.context_percent)}%`
          : state.loading
            ? 'Loading…'
            : sessionId
              ? 'No details available'
              : 'Start a session to see details'
      }),
      ...(data?.categories || []).map(row => jsxs('div', {
        className: 'classic-gold-context-row',
        children: [jsx('span', { children: row.label }), jsx('b', { children: compactNumber(row.tokens) })]
      }, row.id))
    ]
  })
}

function writeSession (sessionId, key, value, fallback, extra = {}) {
  if (!sessionId) {
    host.notify({
      kind: 'warning',
      message: `Start a session before changing ${key}.`,
      title: 'No active session'
    })
    return Promise.resolve({ ok: false })
  }
  return host.request('config.set', { session_id: sessionId, key, value, ...extra })
    .then(result => result?.confirm_required ? { confirm: result } : { ok: true })
    .catch(error => {
      host.notifyError(error, fallback)
      return { ok: false }
    })
}

function TapeModelPicker ({ gateway, profile, runtime, sessionId, setRuntime }) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [search, setSearch] = useState('')
  const models = useQuery({
    queryKey: [ID, 'model-options', profile, sessionId || 'draft'],
    enabled: open && gateway === 'open',
    queryFn: () => host.request('model.options', {
      explicit_only: true,
      ...(sessionId ? { session_id: sessionId } : {})
    })
  })
  const query = search.trim().toLowerCase()
  const groups = (models.data?.providers || [])
    .map(provider => ({
      ...provider,
      models: (provider.models || []).filter(model => {
        const id = typeof model === 'string' ? model : model.id || model.name || ''
        return id && (!query || `${provider.name || ''} ${provider.slug || ''} ${id}`.toLowerCase().includes(query))
      })
    }))
    .filter(provider => provider.models.length)

  const select = async (model, provider) => {
    if (runtime.busy) {
      host.notify({ kind: 'warning', title: 'Turn in progress', message: 'Wait for the current turn before changing the model.' })
      return
    }
    const result = await writeSession(
      sessionId,
      'model',
      `${model} --provider ${provider} --session`,
      'Could not switch model'
    )
    if (result.confirm) {
      setConfirmation({ message: result.confirm.confirm_message, model, provider })
      setOpen(false)
      return
    }
    if (result.ok) {
      setRuntime(current => ({ ...current, model, provider }))
      setOpen(false)
    }
  }

  return jsxs('span', {
    children: [jsxs(DropdownMenu, {
      onOpenChange: next => {
        setOpen(next)
        if (!next) setSearch('')
      },
      open,
      children: [
        jsx(DropdownMenuTrigger, {
          asChild: true,
          children: jsxs('button', {
            'aria-label': 'Switch model',
            className: 'classic-gold-action classic-gold-model',
            'data-classic-gold-control': 'model',
            disabled: !sessionId,
            title: runtime.busy
              ? 'Browse models; choices unlock when the current turn ends'
              : sessionId
                ? 'Switch model'
                : 'Use the composer model selector for a new draft',
            type: 'button',
            children: [jsx('i', { children: '⚕' }), runtime.model || 'model', jsx('small', { children: '⌄' })]
          })
        }),
        jsxs(DropdownMenuContent, {
          align: 'start',
          side: 'top',
          sideOffset: 10,
          style: { padding: 0, width: '20rem' },
          children: [
            jsx('div', {
              style: { padding: '0.5rem' },
              children: jsx(Input, {
                autoFocus: true,
                onChange: event => setSearch(event.target.value),
                onKeyDown: event => {
                  if (event.key !== 'Escape') event.stopPropagation()
                },
                placeholder: 'Search models',
                value: search
              })
            }),
            jsx(DropdownMenuSeparator, {}),
            runtime.busy
              ? jsx(DropdownMenuItem, { disabled: true, children: 'Model choices unlock when the current turn ends' })
              : null,
            models.isPending
              ? jsx(DropdownMenuItem, { disabled: true, children: 'Loading models…' })
              : models.error
                ? jsx(DropdownMenuItem, { disabled: true, children: 'Could not load models' })
                : groups.length === 0
                  ? jsx(DropdownMenuItem, { disabled: true, children: 'No models found' })
                  : jsx('div', {
                    style: { maxHeight: '18rem', overflowY: 'auto' },
                    children: groups.flatMap(provider => [
                      jsx(DropdownMenuItem, {
                        disabled: true,
                        className: 'font-semibold',
                        children: provider.name || provider.slug
                      }, `heading:${provider.slug}`),
                      ...provider.models.map(row => {
                        const model = typeof row === 'string' ? row : row.id || row.name
                        const selected = provider.slug === runtime.provider && model === runtime.model
                        return jsx(DropdownMenuItem, {
                          disabled: runtime.busy,
                          onSelect: () => select(model, provider.slug),
                          children: `${selected ? '✓ ' : ''}${model}`
                        }, `${provider.slug}:${model}`)
                      })
                    ])
                  })
          ]
        })
      ]
    }), jsx(ConfirmDialog, {
      confirmLabel: 'Use model',
      description: confirmation?.message || 'This provider requires confirmation before it changes the session model.',
      onClose: () => setConfirmation(null),
      onConfirm: async () => {
        if (!confirmation) return
        if (runtime.busy) throw new Error('Wait for the current turn before changing the model.')
        const result = await writeSession(
          sessionId,
          'model',
          `${confirmation.model} --provider ${confirmation.provider} --session`,
          'Could not switch model',
          { confirm_expensive_model: true }
        )
        if (!result.ok) throw new Error('Hermes did not change the model.')
        setRuntime(current => ({ ...current, model: confirmation.model, provider: confirmation.provider }))
      },
      open: Boolean(confirmation),
      title: 'Confirm model change'
    })]
  })
}

function formatDuration (startedAt, now) {
  if (!startedAt) return '--'
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function SettingsSwitch ({ checked, label, onChange }) {
  return jsxs('div', {
    className: 'classic-gold-settings-switch',
    children: [
      jsx('span', { children: label }),
      jsx(Switch, { 'aria-label': label, checked, onCheckedChange: onChange, size: 'xs' })
    ]
  })
}

function SettingsRange ({ label, maximum, minimum, onChange, suffix = '%', value }) {
  return jsxs('label', {
    className: 'classic-gold-settings-range',
    children: [
      jsxs('span', { children: [label, jsx('b', { children: `${Math.round(value)}${suffix}` })] }),
      jsx('input', {
        'aria-label': label,
        max: maximum,
        min: minimum,
        onChange: event => onChange(Number(event.target.value)),
        type: 'range',
        value
      })
    ]
  })
}

function ClassicGoldSettings ({ fullPage = false, onChange, onOpenFullPage = openClassicGoldSettings, settings }) {
  const setShow = (key, checked) => onChange({ ...settings, show: { ...settings.show, [key]: checked } })
  const setVisual = (key, value) => onChange({ ...settings, visuals: { ...settings.visuals, [key]: value } })

  return jsxs('div', {
    'data-classic-gold-settings': '',
    className: 'classic-gold-settings-panel',
    children: [
      jsxs('header', {
        children: [
          jsx('strong', { children: 'Classic Gold' }),
          jsx('span', { children: 'Choose the tape data and visual treatment.' })
        ]
      }),
      jsxs('section', {
        children: [
          jsx('h3', { children: 'Tape density' }),
          jsx(SegmentedControl, {
            className: 'classic-gold-settings-segments',
            onChange: density => onChange({ ...settings, density }),
            options: DENSITY_OPTIONS,
            value: settings.density
          })
        ]
      }),
      jsxs('section', {
        children: [
          jsx('h3', { children: 'Shown information' }),
          jsx('div', {
            className: 'classic-gold-settings-grid',
            children: SETTINGS_FIELDS.map(([key, label]) => jsx(SettingsSwitch, {
              checked: settings.show[key],
              label,
              onChange: checked => setShow(key, checked)
            }, key))
          })
        ]
      }),
      jsxs('section', {
        children: [
          jsx('h3', { children: 'Visual preset' }),
          jsx(SegmentedControl, {
            className: 'classic-gold-settings-segments',
            onChange: preset => onChange({ ...settings, preset }),
            options: PRESET_OPTIONS,
            value: settings.preset
          })
        ]
      }),
      jsxs('section', {
        children: [
          jsx('h3', { children: 'Theme details' }),
          jsx('div', {
            className: 'classic-gold-settings-grid',
            children: [
              jsx(SettingsSwitch, {
                checked: settings.visuals.replaceBackdrop,
                label: 'Replace stock backdrop',
                onChange: checked => setVisual('replaceBackdrop', checked)
              }),
              jsx(SettingsSwitch, {
                checked: settings.visuals.caduceus,
                label: 'Caduceus',
                onChange: checked => setVisual('caduceus', checked)
              }),
              jsx(SettingsSwitch, {
                checked: settings.visuals.wordmark,
                label: 'Pixel wordmark',
                onChange: checked => setVisual('wordmark', checked)
              }),
              jsx(SettingsSwitch, {
                checked: settings.visuals.hideComposerModel,
                label: 'Hide duplicate model',
                onChange: checked => setVisual('hideComposerModel', checked)
              })
            ]
          }),
          jsx(SettingsRange, {
            label: 'Caduceus opacity',
            maximum: 55,
            minimum: 15,
            onChange: value => setVisual('caduceusOpacity', value),
            value: settings.visuals.caduceusOpacity
          }),
          jsx(SettingsRange, {
            label: 'Caduceus size',
            maximum: 125,
            minimum: 85,
            onChange: value => setVisual('caduceusScale', value),
            value: settings.visuals.caduceusScale
          }),
          jsx(SettingsRange, {
            label: 'Wordmark size',
            maximum: 110,
            minimum: 85,
            onChange: value => setVisual('wordmarkScale', value),
            value: settings.visuals.wordmarkScale
          }),
          jsx(SettingsRange, {
            label: 'Tape text size',
            maximum: 110,
            minimum: 90,
            onChange: value => setVisual('tapeFontScale', value),
            value: settings.visuals.tapeFontScale
          })
        ]
      }),
      jsxs('footer', {
        children: [
          jsx('span', { children: 'Responsive safety limits still apply.' }),
          jsxs('div', {
            className: 'classic-gold-settings-actions',
            children: [
              !fullPage && jsx(Button, {
                onClick: onOpenFullPage,
                size: 'xs',
                type: 'button',
                variant: 'ghost',
                children: 'Open full page'
              }),
              jsx(Button, {
                onClick: () => onChange(DEFAULT_SETTINGS),
                size: 'xs',
                type: 'button',
                variant: 'outline',
                children: 'Reset to original'
              })
            ]
          })
        ]
      })
    ]
  })
}

function saveSettings (storage, value) {
  const next = sanitizeSettings(value)
  settingsAtom.set(next)
  storage?.set(SETTINGS_KEY, next)
}

function ClassicGoldSettingsPage ({ storage }) {
  const returnRoute = useValue(settingsReturnRouteAtom)
  const settings = useValue(settingsAtom)

  return jsx('main', {
    'data-classic-gold-settings-page': '',
    className: 'classic-gold-settings-page',
    children: jsxs('div', {
      className: 'classic-gold-settings-page-frame',
      children: [
        jsxs('header', {
          className: 'classic-gold-settings-page-title',
          children: [
            jsxs('div', {
              children: [
                jsx('span', { children: 'HERMES-AGENT / DISPLAY' }),
                jsx('h1', { children: 'Classic Gold settings' }),
                jsx('p', { children: 'Choose the telemetry fields and tune the theme without changing Hermes source.' })
              ]
            }),
            jsx(Button, {
              onClick: () => host.navigate(returnRoute || '/'),
              size: 'sm',
              type: 'button',
              variant: 'outline',
              children: 'Back to chat'
            })
          ]
        }),
        jsx(ClassicGoldSettings, {
          fullPage: true,
          onChange: value => saveSettings(storage, value),
          settings
        })
      ]
    })
  })
}

function SettingsTrigger ({ onChange, settings }) {
  const [open, setOpen] = useState(false)
  const openFullPage = () => {
    setOpen(false)
    window.setTimeout(openClassicGoldSettings, 0)
  }

  return jsxs(Popover, {
    onOpenChange: setOpen,
    open,
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsxs('button', {
          'aria-label': 'Customize Classic Gold',
          className: 'classic-gold-action classic-gold-brand',
          'data-classic-gold-control': 'settings',
          title: 'Customize Classic Gold',
          type: 'button',
          children: [jsx('i', { children: '╭─' }), 'HERMES-AGENT']
        })
      }),
      jsx(PopoverContent, {
        align: 'start',
        className: 'classic-gold-settings-popover',
        side: 'top',
        sideOffset: 10,
        children: jsx(ClassicGoldSettings, { onChange, onOpenFullPage: openFullPage, settings })
      })
    ]
  })
}

function TelemetryTape ({ rest, storage }) {
  const activeSessionId = useValue(host.state.activeSessionId)
  const gateway = useValue(host.state.gateway)
  const hostCwd = useValue(host.state.cwd)
  const hostModel = useValue(host.state.model)
  const profile = useValue(host.state.profile)
  const viewport = useValue(host.state.viewport)
  const settings = useValue(settingsAtom)
  const [runtime, setRuntime] = useState(() => ({
    activeSessions: 0,
    branch: '',
    busy: false,
    cwd: hostCwd || '',
    effort: '',
    fast: false,
    metadataSeeded: false,
    model: hostModel || '',
    provider: '',
    outputAtTurnStart: 0,
    turnBaselineReady: false,
    sessionStartedAt: null,
    sessionKey: '',
    speed: null,
    startedAt: null,
    usage: { calls: 0, input: 0, output: 0, total: 0 },
    usageSeeded: false
  }))
  const runtimeRef = useRef(runtime)
  const [now, setNow] = useState(() => Date.now())
  const [resources, setResources] = useState(null)
  const [cost, setCost] = useState(null)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.classicGoldTapeMounted = 'true'
    return () => {
      delete root.dataset.classicGoldTapeMounted
    }
  }, [])

  useEffect(() => {
    setRuntime({
      activeSessions: 0,
      branch: '',
      busy: false,
      cwd: activeSessionId ? '' : (host.state.cwd.get() || ''),
      effort: '',
      fast: false,
      metadataSeeded: false,
      model: hostModel || '',
      provider: '',
      outputAtTurnStart: 0,
      turnBaselineReady: false,
      sessionStartedAt: null,
      sessionKey: '',
      speed: null,
      startedAt: null,
      usage: { calls: 0, input: 0, output: 0, total: 0 },
      usageSeeded: false
    })
    setResources(null)
    setCost(null)
  }, [activeSessionId])

  useEffect(() => {
    runtimeRef.current = runtime
  }, [runtime])

  useEffect(() => {
    if (!activeSessionId && hostCwd) {
      setRuntime(current => ({ ...current, cwd: hostCwd }))
    }
  }, [activeSessionId, hostCwd])

  useEffect(() => {
    setRuntime(current => ({ ...current, model: hostModel || current.model }))
  }, [hostModel])

  // Seed the tape through public gateway requests. This avoids a dependency on
  // the private composer DOM, which can change during a Hermes update.
  useEffect(() => {
    if (gateway !== 'open') return
    let live = true
    const session = activeSessionId ? { session_id: activeSessionId } : {}
    Promise.allSettled([
      activeSessionId
        ? Promise.resolve(null)
        : host.request('model.options', { explicit_only: true }),
      host.request('config.get', { key: 'reasoning', ...session }),
      host.request('config.get', { key: 'fast', ...session })
    ]).then(([modelResult, reasoningResult, fastResult]) => {
      if (!live) return
      const options = modelResult.status === 'fulfilled' && modelResult.value ? modelResult.value : {}
      const reasoning = reasoningResult.status === 'fulfilled' ? reasoningResult.value?.value : ''
      const fast = fastResult.status === 'fulfilled' ? fastResult.value?.value : ''
      setRuntime(current => ({
        ...current,
        effort: typeof reasoning === 'string' && reasoning ? reasoning : current.effort,
        fast: fast === true || fast === 'fast',
        model: activeSessionId ? (hostModel || current.model) : (hostModel || options.model || current.model),
        provider: activeSessionId
          ? current.provider
          : options.model === (hostModel || options.model) ? (options.provider || current.provider) : current.provider
      }))
    })
    return () => {
      live = false
    }
  }, [activeSessionId, gateway, hostModel])

  useEffect(() => {
    if (!activeSessionId) return
    let live = true
    let completionGeneration = 0
    const onEvent = event => {
      if (event.session_id !== activeSessionId) return
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
      if (event.type === 'message.start') completionGeneration += 1
      setRuntime(current => {
        if (event.type === 'message.start') {
          return {
            ...current,
            busy: true,
            outputAtTurnStart: boundedNumber(current.usage.output),
            speed: null,
            startedAt: Date.now(),
            turnBaselineReady: current.usageSeeded
          }
        }
        if (event.type === 'message.complete' || event.type === 'message.error' || event.type === 'session.interrupted') {
          const usage = payload.usage
            ? mergeUsageMonotonic(current.usage, payload.usage)
            : current.usage
          return {
            ...current,
            busy: false,
            speed: null,
            startedAt: null,
            usage
          }
        }
        if (event.type === 'session.info') {
          return {
            ...current,
            busy: typeof payload.running === 'boolean' ? payload.running : current.busy,
            branch: payload.branch || current.branch,
            cwd: payload.cwd || current.cwd,
            effort: payload.reasoning_effort || current.effort,
            fast: typeof payload.fast === 'boolean' ? payload.fast : current.fast,
            metadataSeeded: true,
            model: payload.model || current.model,
            provider: payload.provider || current.provider,
            sessionKey: payload.stored_session_id || payload.session_key || current.sessionKey,
            usage: payload.usage
              ? mergeUsageMonotonic(current.usage, payload.usage)
              : current.usage,
            usageSeeded: current.usageSeeded || Boolean(payload.usage)
          }
        }
        return current
      })
      if (event.type === 'message.complete') {
        const snapshot = runtimeRef.current
        const completedAt = Date.now()
        const generation = ++completionGeneration
        host.request('session.usage', { session_id: activeSessionId }).then(latest => {
          if (!live || generation !== completionGeneration) return
          setRuntime(current => {
            const usage = mergeUsageMonotonic(current.usage, latest)
            return {
              ...current,
              speed: completedTurnSpeed({
                baselineReady: snapshot.turnBaselineReady,
                completedAt,
                outputAtStart: snapshot.outputAtTurnStart,
                startedAt: snapshot.startedAt,
                usage
              }),
              usage,
              usageSeeded: true
            }
          })
        }).catch(() => {
          // Unknown is more accurate than a stale or estimated rate.
        })
      }
    }
    const dispose = host.onEvent('*', onEvent)
    return () => {
      live = false
      completionGeneration += 1
      dispose()
    }
  }, [activeSessionId])

  useEffect(() => {
    if (gateway !== 'open') return
    let cancelled = false
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const [usageResult, contextResult, activeResult] = await Promise.allSettled([
          activeSessionId ? host.request('session.usage', { session_id: activeSessionId }) : Promise.resolve({}),
          activeSessionId ? host.request('session.context_breakdown', { session_id: activeSessionId }) : Promise.resolve({}),
          host.request('session.active_list', {})
        ])
        if (cancelled) return

        const usage = usageResult.status === 'fulfilled' && usageResult.value && typeof usageResult.value === 'object'
          ? usageResult.value
          : {}
        const context = contextResult.status === 'fulfilled' && contextResult.value && typeof contextResult.value === 'object'
          ? contextResult.value
          : {}
        const sessions = activeResult.status === 'fulfilled' && Array.isArray(activeResult.value?.sessions)
          ? activeResult.value.sessions
          : []
        const active = activeSessionId
          ? sessions.find(session => session?.id === activeSessionId || session?.session_key === activeSessionId)
          : null
        const sessionStartedAt = boundedNumber(active?.started_at)

        setRuntime(current => ({
          ...current,
          activeSessions: sessions.length,
          busy: activeSessionId && active ? ['starting', 'waiting', 'working'].includes(active.status) : current.busy,
          sessionStartedAt: sessionStartedAt > 0
            ? (sessionStartedAt < 1_000_000_000_000 ? sessionStartedAt * 1000 : sessionStartedAt)
            : current.sessionStartedAt,
          sessionKey: active?.session_key || current.sessionKey,
          usage: {
            ...mergeUsageMonotonic(current.usage, usage),
            ...context
          },
          usageSeeded: current.usageSeeded || usageResult.status === 'fulfilled'
        }))
      } finally {
        refreshing = false
      }
    }
    refresh()
    const timer = window.setInterval(() => refresh(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeSessionId, gateway])

  useEffect(() => {
    if (!rest || gateway !== 'open') return
    let cancelled = false
    const refresh = async () => {
      try {
        const telemetry = await rest(
          `/telemetry${runtime.sessionKey ? `?session_id=${encodeURIComponent(runtime.sessionKey)}` : ''}`,
          { timeoutMs: 3000 }
        )
        if (!cancelled) {
          setResources(telemetry?.resources || null)
          setCost(telemetry?.cost || null)
          if (telemetry?.session?.status === 'ok') {
            setRuntime(current => current.metadataSeeded
              ? current
              : {
                  ...current,
                  effort: telemetry.session.reasoning_effort || current.effort,
                  fast: typeof telemetry.session.fast === 'boolean' ? telemetry.session.fast : current.fast,
                  branch: telemetry.session.git_branch || current.branch,
                  cwd: telemetry.session.cwd || current.cwd,
                  metadataSeeded: true,
                  model: telemetry.session.model || current.model,
                  provider: telemetry.session.provider || current.provider
                })
          }
        }
      } catch {
        if (!cancelled) {
          setResources(null)
          setCost(null)
        }
      }
    }
    refresh()
    const timer = window.setInterval(() => refresh(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [gateway, rest, runtime.sessionKey])

  useEffect(() => {
    if (!runtime.busy && !activeSessionId) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeSessionId, runtime.busy])

  const source = useMemo(() => providerView(runtime.provider), [runtime.provider])
  const percent = Math.round(contextPercent(runtime.usage))
  const detail = [
    `model: ${runtime.model || hostModel || 'model'}`,
    `effort: ${runtime.effort || '-'}`,
    `source: ${source.label}`,
    `context: ${contextLabel(runtime.usage)} ${percent}%`,
    `in/out: ${compactNumber(runtime.usage.input)}/${compactNumber(runtime.usage.output)}`
  ].join(' | ')

  if (viewport.width < 880) return null

  const patchReasoning = async value => {
    const result = await writeSession(activeSessionId, 'reasoning', value, 'Could not update reasoning')
    if (result.ok) setRuntime(current => ({ ...current, effort: value }))
  }

  const updateSettings = value => saveSettings(storage, value)

  const sections = [
    ['settings', jsx(SettingsTrigger, { onChange: updateSettings, settings })]
  ]

  if (settings.show.activity) {
    sections.push(['activity', jsx('span', {
      className: runtime.busy ? 'classic-gold-hot' : 'classic-gold-warm',
      children: `[${runtime.busy ? 'RUN' : 'IDLE'}]`
    })])
  }

  if (settings.show.model) {
    sections.push(['model', jsx(TapeModelPicker, {
      gateway,
      profile,
      runtime: { ...runtime, model: runtime.model || hostModel || 'model' },
      sessionId: activeSessionId,
      setRuntime
    })])
  }

  const route = []
  if (settings.show.reasoning) {
    route.push(jsxs(DropdownMenu, {
      children: [
        jsx(DropdownMenuTrigger, {
          asChild: true,
          children: jsxs('button', {
            'aria-label': 'Change reasoning effort',
            className: 'classic-gold-action',
            'data-classic-gold-control': 'reasoning',
            disabled: !activeSessionId,
            title: activeSessionId ? 'Change reasoning effort' : 'Start a session before changing reasoning',
            type: 'button',
            children: [jsx('i', { children: '◆' }), effortCode(runtime.effort, runtime.fast)]
          })
        }),
        jsx(DropdownMenuContent, {
          align: 'center',
          className: 'w-44 p-1',
          side: 'top',
          sideOffset: 10,
          children: REASONING_EFFORT_VALUES.map(value => jsx(DropdownMenuItem, {
            onSelect: event => {
              event.preventDefault()
              patchReasoning(value)
            },
            children: jsxs('span', {
              className: 'flex w-full items-center justify-between',
              children: [reasoningEffortLabel(value), value === (runtime.effort || DEFAULT_REASONING_EFFORT) ? '✓' : '']
            })
          }, value))
        })
      ]
    }, 'reasoning'))
  }
  if (settings.show.provider) {
    route.push(jsxs('button', {
      'aria-label': 'Open provider settings',
      className: 'classic-gold-action',
      'data-classic-gold-control': 'provider',
      onClick: () => host.navigate('/settings?tab=providers'),
      title: 'Open provider settings',
      type: 'button',
      children: [jsx('i', { children: source.symbol }), source.label]
    }, 'provider'))
  }
  if (route.length) sections.push(['route', jsx('span', { children: route })])

  if (settings.show.context) {
    sections.push(['context', jsxs(DropdownMenu, {
      children: [
        jsx(DropdownMenuTrigger, {
          asChild: true,
          children: jsxs('button', {
            'aria-label': 'Open context breakdown',
            className: 'classic-gold-action classic-gold-context',
            'data-classic-gold-control': 'context',
            title: 'Open context breakdown',
            type: 'button',
            children: [jsx('i', { children: '▣' }), contextLabel(runtime.usage), jsx('em', { children: `[${contextMeter(percent)}]` }), `${String(percent).padStart(2, '0')}%`]
          })
        }),
        jsx(DropdownMenuContent, {
          align: 'center',
          className: 'w-64 p-2',
          side: 'top',
          sideOffset: 10,
          children: jsx(ContextDetails, { sessionId: activeSessionId })
        })
      ]
    })])
  }

  if (settings.show.tokens) {
    sections.push(['tokens', jsxs('span', {
      title: 'Input and output tokens in this session',
      children: [jsx('i', { children: '↓' }), compactNumber(runtime.usage.input), jsx('i', { children: '↑' }), compactNumber(runtime.usage.output)]
    })])
  }

  const performance = []
  if (settings.show.speed) {
    performance.push(jsx('span', {
      title: runtime.busy ? 'A final-turn average appears after completion' : 'Completed-turn output tokens per second',
      children: [jsx('i', { children: '↯' }), runtime.busy ? '--/s' : formatSpeed(runtime.speed)]
    }, 'speed'))
  }
  if (settings.show.cost) {
    performance.push(jsxs('span', {
      title: cost?.status === 'actual'
        ? 'Provider-reported actual session cost'
        : cost?.status === 'included'
          ? 'This route is included in a subscription'
          : 'The provider did not report an actual billed session cost',
      children: [jsx('i', { children: '$' }), formatCost(cost)]
    }, 'cost'))
  }
  if (settings.show.timer) {
    performance.push(jsxs('span', {
      title: runtime.busy ? 'Current turn time' : 'Active session time',
      children: [jsx('i', { children: '◷' }), formatDuration(runtime.busy ? runtime.startedAt : runtime.sessionStartedAt, now)]
    }, 'timer'))
  }
  if (performance.length) {
    sections.push(['performance', jsx('span', { className: 'classic-gold-low-priority', children: performance })])
  }

  if (settings.show.hardware) {
    sections.push(['hardware', jsxs('span', {
      className: 'classic-gold-memory',
      title: resources ? 'GPU VRAM and system RAM used / total' : 'Resource telemetry backend is not available',
      children: [jsx('i', { children: '▦' }), formatMemory(resources?.vram), jsx('i', { children: '▤' }), formatMemory(resources?.ram)]
    })])
  }

  if (settings.show.profile) {
    sections.push(['profile', jsxs('span', { title: 'Active profile', children: [jsx('i', { children: '●' }), profile || 'default'] })])
  }
  if (settings.show.gateway) {
    sections.push(['gateway', jsxs('span', {
      title: 'Hermes gateway state',
      children: [jsx('i', { children: gateway === 'open' ? '●' : '○' }), gateway]
    })])
  }
  if (settings.show.sessions) {
    sections.push(['sessions', jsxs('span', {
      title: 'Live sessions on this gateway',
      children: [jsx('i', { children: '≋' }), Math.max(activeSessionId ? 1 : 0, runtime.activeSessions)]
    })])
  }
  if (settings.show.workspace) {
    const workspace = pathLeaf(runtime.cwd)
    sections.push(['workspace', jsxs('span', {
      title: [runtime.cwd, runtime.branch].filter(Boolean).join(' · ') || 'Current workspace',
      children: [jsx('i', { children: '⌘' }), workspace, runtime.branch ? `:${runtime.branch}` : '']
    })])
  }

  const rail = sections.map(([key, node], index) => jsxs('span', {
    className: 'classic-gold-section-group',
    'data-classic-gold-section': key,
    children: [index > 0 ? jsx('b', { children: '│' }) : null, node]
  }, key))
  rail.push(jsx('i', { className: 'classic-gold-end', children: '─╮' }, 'end'))

  return jsx('div', {
    'aria-label': 'Hermes telemetry tape',
    'data-classic-gold-density': settings.density,
    'data-classic-gold-preset': settings.preset,
    'data-classic-gold-session': activeSessionId ? 'active' : 'draft',
    'data-classic-gold-telemetry': '',
    title: detail,
    children: jsxs('div', {
      className: 'classic-gold-rail',
      children: rail
    })
  })
}

function createCaduceus () {
  const layer = document.createElement('div')
  layer.setAttribute('data-classic-gold-caduceus', '')
  layer.setAttribute('aria-hidden', 'true')
  const pre = document.createElement('pre')
  CADUCEUS.forEach((line, index) => {
    const span = document.createElement('span')
    span.style.color = COLORS[line.tone]
    span.textContent = line.text + (index < CADUCEUS.length - 1 ? '\n' : '')
    pre.append(span)
  })
  layer.append(pre)
  return layer
}

function canonicalJson (value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// Hermes reads user themes before it loads run-time plug-ins. Keep an owned
// mirror so Classic Gold is available during the first paint. Replace only the
// exact legacy Pack theme or the last mirror that this plug-in wrote. If the
// user changes the mirror, preserve the user's copy.
function syncBootThemeMirror () {
  try {
    const record = JSON.parse(localStorage.getItem(USER_THEMES_KEY) || '{}')
    if (!record || Array.isArray(record) || typeof record !== 'object') return false

    const name = classicGoldTheme.name
    const current = record[name]
    const currentSnapshot = current ? canonicalJson(current) : ''
    const managedSnapshot = canonicalJson(classicGoldTheme)
    const priorManagedSnapshot = localStorage.getItem(THEME_MIRROR_OWNER_KEY) || ''
    const legacyPackTheme = { ...classicGoldTheme }
    delete legacyPackTheme.classicGoldPack
    legacyPackTheme.description = 'Gold and kawaii - warm gold borders, cornsilk text'
    const legacySnapshot = canonicalJson(legacyPackTheme)
    const legacyFileTheme = {
      ...legacyPackTheme,
      typography: {
        fontSans: '"Cascadia Code", "JetBrains Mono", "Courier Prime", Consolas, ui-monospace, Menlo, Monaco, monospace, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji',
        fontMono: '"Cascadia Code", "JetBrains Mono", "Courier Prime", Consolas, ui-monospace, Menlo, Monaco, monospace, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'
      }
    }
    const legacyFileSnapshot = canonicalJson(legacyFileTheme)
    const canWrite = !current ||
      currentSnapshot === legacySnapshot ||
      currentSnapshot === legacyFileSnapshot ||
      currentSnapshot === managedSnapshot ||
      (priorManagedSnapshot && currentSnapshot === priorManagedSnapshot)

    if (!canWrite) return false
    const changed = currentSnapshot !== managedSnapshot
    if (changed) {
      record[name] = classicGoldTheme
      localStorage.setItem(USER_THEMES_KEY, JSON.stringify(record))
    }
    localStorage.setItem(THEME_MIRROR_OWNER_KEY, managedSnapshot)
    return changed
  } catch {
    // A corrupt or restricted store must not stop the plug-in.
    return false
  }
}

function installVisualLayer (ctx) {
  document.getElementById(STYLE_ID)?.remove()
  document.querySelectorAll('[data-classic-gold-caduceus]').forEach(node => node.remove())

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    :root[data-hermes-theme="hermes-classic-gold"][data-classic-gold-replace-backdrop="true"] [data-chat-surface] > [aria-hidden]:has(> img[src*="ds-assets/filler-bg0.jpg"]) {
      display: none !important;
    }
    :root[data-hermes-theme="hermes-classic-gold"] [data-classic-gold-caduceus] {
      position: absolute;
      inset: 0;
      z-index: 2;
      overflow: hidden;
      pointer-events: none;
      opacity: var(--cg-caduceus-opacity, 0.42);
      mix-blend-mode: normal;
    }
    :root[data-hermes-theme="hermes-classic-gold"] [data-classic-gold-caduceus][hidden] { display: none !important; }
    :root[data-hermes-theme="hermes-classic-gold"] [data-classic-gold-caduceus] pre {
      position: absolute;
      top: 23%;
      left: 50%;
      margin: 0;
      user-select: none;
      white-space: pre;
      text-align: center;
      line-height: 0.92;
      letter-spacing: 0;
      font-family: "Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
      font-size: clamp(22px, 2.7vw, 76px);
      text-shadow: 0 0 24px rgba(242, 183, 5, 0.12);
      transform: translateX(-50%) scale(var(--cg-caduceus-scale, 1.16));
      transform-origin: 50% 0%;
    }
    :root[data-hermes-theme="hermes-classic-gold"][data-classic-gold-wordmark="true"] [data-slot="aui_intro"] p[aria-label="HERMES AGENT"] {
      display: block !important;
      width: 100% !important;
      max-width: var(--cg-wordmark-width, 46rem) !important;
      aspect-ratio: 1109 / 146;
      margin: 0 auto 0.5rem !important;
      padding: 0 !important;
      background: url("${WORDMARK_DATA_URI}") center / contain no-repeat;
      color: transparent !important;
      font-size: 0 !important;
      line-height: 0 !important;
      mix-blend-mode: normal !important;
    }
    :root[data-hermes-theme="hermes-classic-gold"][data-classic-gold-wordmark="true"] [data-slot="aui_intro"] p[aria-label="HERMES AGENT"] > * { display: none !important; }
    :root[data-classic-gold-tape-mounted="true"] [data-slot="statusbar"] {
      position: relative;
      border-top: 1px solid color-mix(in srgb, var(--dt-border) 42%, transparent);
      background: color-mix(in srgb, var(--dt-sidebar) 96%, #0d0d0d) !important;
    }
    :root[data-classic-gold-tape-mounted="true"] [data-slot="statusbar"] > div { overflow: visible !important; }
    [data-classic-gold-telemetry] {
      position: absolute;
      left: calc((100vw + var(--workspace-left, 0px) - var(--workspace-right, 0px)) / 2);
      bottom: calc(100% + 0.1875rem);
      z-index: 35;
      width: min(82rem, calc(100vw - var(--workspace-left, 0px) - var(--workspace-right, 0px) - 2rem));
      max-width: calc(100vw - var(--workspace-left, 0px) - var(--workspace-right, 0px) - 2rem);
      height: 1.75rem;
      transform: translateX(-50%);
      overflow: hidden;
      border: 1px solid rgba(242, 183, 5, 0.58);
      border-radius: 3px;
      background: rgba(13, 13, 13, 0.98);
      color: #cfc39d;
      box-shadow: inset 0 0 0 1px rgba(115, 90, 16, 0.3), 0 6px 14px rgba(0, 0, 0, 0.22);
      pointer-events: none;
      font-family: "Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
      font-size: var(--cg-tape-font-size, 0.78125rem);
      font-weight: 600;
      line-height: 1;
    }
    [data-classic-gold-telemetry] .classic-gold-rail {
      display: flex;
      height: 100%;
      min-width: 0;
      align-items: center;
      justify-content: center;
      gap: 0.55rem;
      padding: 0 0.75rem;
      overflow: hidden;
      white-space: nowrap;
    }
    [data-classic-gold-telemetry] .classic-gold-section-group { gap: 0.55rem; }
    [data-classic-gold-telemetry] span { display: inline-flex; min-width: 0; align-items: center; gap: 0.38rem; }
    [data-classic-gold-telemetry] i { color: #f2b705; font-style: normal; text-shadow: 0 0 4px rgba(242, 183, 5, 0.18); }
    [data-classic-gold-telemetry] b { color: #6b540f; font-weight: 400; }
    [data-classic-gold-telemetry] em { color: #f2b705; font-style: normal; text-shadow: 0 0 8px rgba(242, 183, 5, 0.2); }
    [data-classic-gold-telemetry] .classic-gold-brand,
    [data-classic-gold-telemetry] .classic-gold-end { color: #f2b705; }
    [data-classic-gold-telemetry] .classic-gold-brand.classic-gold-action { padding-right: 0; padding-left: 0; }
    [data-classic-gold-telemetry] .classic-gold-warm,
    [data-classic-gold-telemetry] .classic-gold-model { color: #f5d879; }
    [data-classic-gold-telemetry] .classic-gold-model { max-width: 15rem; overflow: hidden; text-overflow: ellipsis; }
    [data-classic-gold-telemetry] .classic-gold-hot { color: #f29f05; }
    [data-classic-gold-telemetry] .classic-gold-action {
      display: inline-flex;
      min-width: 0;
      align-items: center;
      gap: 0.38rem;
      padding: 0.125rem 0.25rem;
      border: 0;
      border-radius: 2px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      line-height: 1;
      pointer-events: auto;
    }
    [data-classic-gold-telemetry] .classic-gold-action:hover,
    [data-classic-gold-telemetry] .classic-gold-action:focus-visible {
      background: rgba(242, 183, 5, 0.14);
      outline: 1px solid rgba(242, 183, 5, 0.24);
      color: #ffd700;
      box-shadow: 0 0 8px rgba(242, 183, 5, 0.2);
      text-shadow: 0 0 6px rgba(255, 215, 0, 0.42);
    }
    [data-classic-gold-telemetry] .classic-gold-action:disabled {
      opacity: 0.48;
      cursor: default;
    }
    [data-classic-gold-telemetry] .classic-gold-action:disabled:hover {
      background: transparent;
      outline: 0;
      color: inherit;
      box-shadow: none;
      text-shadow: none;
    }
    [data-classic-gold-telemetry] .classic-gold-action small { color: #735a10; font-size: 0.625rem; }
    [data-classic-gold-telemetry][data-classic-gold-density="compact"] .classic-gold-rail {
      gap: 0.35rem;
      padding-right: 0.5rem;
      padding-left: 0.5rem;
    }
    [data-classic-gold-telemetry][data-classic-gold-density="compact"] .classic-gold-section-group { gap: 0.35rem; }
    [data-classic-gold-telemetry][data-classic-gold-preset="dim"] {
      border-color: rgba(184, 134, 11, 0.42);
      color: #aaa181;
      box-shadow: inset 0 0 0 1px rgba(115, 90, 16, 0.2), 0 6px 14px rgba(0, 0, 0, 0.18);
    }
    [data-classic-gold-telemetry][data-classic-gold-preset="contrast"] {
      border-color: rgba(255, 215, 0, 0.88);
      background: rgba(8, 7, 4, 0.99);
      color: #fff8dc;
      box-shadow: inset 0 0 0 1px rgba(255, 215, 0, 0.32), 0 0 12px rgba(242, 183, 5, 0.14);
    }
    .classic-gold-settings-popover {
      width: min(27rem, calc(100vw - 2rem));
      max-height: min(47rem, calc(100vh - 3rem));
      overflow-y: auto;
      padding: 0;
    }
    .classic-gold-settings-panel {
      display: flex;
      flex-direction: column;
      color: var(--ui-text-secondary);
      font-family: var(--dt-font-mono);
      font-size: 0.75rem;
    }
    .classic-gold-settings-panel > header,
    .classic-gold-settings-panel > section,
    .classic-gold-settings-panel > footer { padding: 0.75rem 0.875rem; }
    .classic-gold-settings-panel > header,
    .classic-gold-settings-panel > section { border-bottom: 1px solid var(--ui-stroke-secondary); }
    .classic-gold-settings-panel > header { display: flex; flex-direction: column; gap: 0.2rem; }
    .classic-gold-settings-panel > header strong { color: var(--ui-text-primary); font-size: 0.875rem; }
    .classic-gold-settings-panel > header span,
    .classic-gold-settings-panel > footer span { color: var(--ui-text-tertiary); }
    .classic-gold-settings-panel > section { display: flex; flex-direction: column; gap: 0.65rem; }
    .classic-gold-settings-panel h3 { margin: 0; color: var(--ui-text-primary); font-size: 0.6875rem; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; }
    .classic-gold-settings-segments { width: 100%; }
    .classic-gold-settings-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 1rem; row-gap: 0.55rem; }
    .classic-gold-settings-switch { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .classic-gold-settings-switch > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .classic-gold-settings-range { display: flex; flex-direction: column; gap: 0.35rem; }
    .classic-gold-settings-range > span { display: flex; justify-content: space-between; gap: 1rem; }
    .classic-gold-settings-range b { color: var(--dt-primary); font-weight: 600; }
    .classic-gold-settings-range input { width: 100%; accent-color: var(--dt-primary); }
    .classic-gold-settings-panel > footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .classic-gold-settings-actions { display: flex; align-items: center; gap: 0.5rem; }
    .classic-gold-settings-page {
      min-height: 100%;
      overflow-y: auto;
      padding: clamp(1.25rem, 4vw, 3.5rem);
      background:
        linear-gradient(rgba(242, 183, 5, 0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(242, 183, 5, 0.025) 1px, transparent 1px),
        var(--dt-background);
      background-size: 32px 32px;
      color: var(--ui-text-secondary);
    }
    .classic-gold-settings-page-frame {
      width: min(48rem, 100%);
      margin: 0 auto;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--dt-border) 70%, transparent);
      border-radius: 4px;
      background: color-mix(in srgb, var(--dt-sidebar) 96%, #0d0d0d);
      box-shadow: inset 0 0 0 1px rgba(115, 90, 16, 0.2), 0 18px 50px rgba(0, 0, 0, 0.2);
    }
    .classic-gold-settings-page-title {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1.5rem;
      padding: 1.25rem 1.4rem;
      border-bottom: 1px solid var(--ui-stroke-secondary);
      font-family: var(--dt-font-mono);
    }
    .classic-gold-settings-page-title > div { display: flex; min-width: 0; flex-direction: column; gap: 0.25rem; }
    .classic-gold-settings-page-title span { color: var(--dt-primary); font-size: 0.6875rem; letter-spacing: 0.08em; }
    .classic-gold-settings-page-title h1 { margin: 0; color: var(--ui-text-primary); font-size: 1.35rem; line-height: 1.25; }
    .classic-gold-settings-page-title p { margin: 0.2rem 0 0; color: var(--ui-text-tertiary); font-size: 0.78rem; }
    .classic-gold-settings-page .classic-gold-settings-panel > header { display: none; }
    .classic-gold-context-panel { display: flex; min-width: 14rem; flex-direction: column; gap: 0.45rem; font-family: var(--dt-font-mono); font-size: 0.75rem; }
    .classic-gold-context-panel > span { display: block; }
    .classic-gold-context-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .classic-gold-context-row b { color: var(--dt-primary); font-weight: 600; }
    .classic-gold-dim { color: var(--ui-text-tertiary); }
    @media (min-width: 880px) {
      :root[data-classic-gold-tape-mounted="true"] [data-chat-surface] {
        --thread-last-message-clearance: calc(var(--composer-measured-height) + 3.9375rem);
        --thread-viewport-height: max(
          0rem,
          calc(100% - var(--composer-measured-height) - 1.9375rem + var(--composer-surface-measured-height))
        );
      }
      :root[data-classic-gold-tape-mounted="true"] [data-chat-surface] [data-slot="composer-dock"]:not([data-popped-out]) {
        bottom: 1.9375rem !important;
      }
      :root[data-classic-gold-tape-mounted="true"] [data-chat-surface] [data-slot="aui_intro"] {
        padding-bottom: calc(var(--composer-measured-height) + 1.9375rem) !important;
      }
      :root[data-classic-gold-tape-mounted="true"][data-classic-gold-session-active="true"][data-classic-gold-hide-composer-model="true"]
        [data-classic-gold-composer-model] {
        display: none !important;
      }
    }
    @media (max-width: 1179px) {
      [data-classic-gold-telemetry] [data-classic-gold-section="hardware"] { display: none; }
    }
    @media (max-width: 999px) {
      [data-classic-gold-telemetry] [data-classic-gold-section="performance"] { display: none; }
    }
    @media (max-width: 879px) {
      [data-classic-gold-telemetry] { display: none; }
    }
  `

  const syncSurfaces = () => {
    const settings = settingsAtom.get()
    syncComposerModelTargets()
    const enabled = document.documentElement.dataset.hermesTheme === 'hermes-classic-gold' && settings.visuals.caduceus
    const surfaces = [...document.querySelectorAll('[data-chat-surface]')]
    surfaces.forEach(surface => {
      let layer = surface.querySelector(':scope > [data-classic-gold-caduceus]')
      if (!layer) {
        layer = createCaduceus()
        surface.prepend(layer)
      }
      layer.hidden = !enabled
    })
  }

  const root = document.documentElement
  const stopSession = host.state.activeSessionId.subscribe(value => {
    root.dataset.classicGoldSessionActive = String(Boolean(value))
  })
  const applySettings = value => {
    const settings = sanitizeSettings(value)
    root.dataset.classicGoldHideComposerModel = String(shouldHideComposerModel(settings))
    root.dataset.classicGoldReplaceBackdrop = String(settings.visuals.replaceBackdrop)
    root.dataset.classicGoldWordmark = String(settings.visuals.wordmark)
    root.style.setProperty('--cg-caduceus-opacity', String(settings.visuals.caduceusOpacity / 100))
    root.style.setProperty('--cg-caduceus-scale', String(settings.visuals.caduceusScale / 100))
    root.style.setProperty('--cg-tape-font-size', `${0.78125 * settings.visuals.tapeFontScale / 100}rem`)
    root.style.setProperty('--cg-wordmark-width', `${46 * settings.visuals.wordmarkScale / 100}rem`)
    syncSurfaces()
  }

  document.head.append(style)
  applySettings(settingsAtom.get())
  const stopSettings = settingsAtom.listen(applySettings)
  syncSurfaces()
  let syncQueued = false
  const scheduleSync = () => {
    if (syncQueued) return
    syncQueued = true
    window.queueMicrotask(() => {
      syncQueued = false
      syncSurfaces()
    })
  }
  const observer = new MutationObserver(scheduleSync)
  observer.observe(document.body, { childList: true, subtree: true })
  observer.observe(root, { attributeFilter: ['data-hermes-theme'], attributes: true })

  ctx.onDispose(() => {
    stopSettings()
    stopSession()
    observer.disconnect()
    document.querySelectorAll('[data-classic-gold-caduceus]').forEach(node => node.remove())
    document.querySelectorAll('[data-classic-gold-composer-model]').forEach(node => {
      delete node.dataset.classicGoldComposerModel
    })
    delete root.dataset.classicGoldHideComposerModel
    delete root.dataset.classicGoldReplaceBackdrop
    delete root.dataset.classicGoldSessionActive
    delete root.dataset.classicGoldTapeMounted
    delete root.dataset.classicGoldWordmark
    root.style.removeProperty('--cg-caduceus-opacity')
    root.style.removeProperty('--cg-caduceus-scale')
    root.style.removeProperty('--cg-tape-font-size')
    root.style.removeProperty('--cg-wordmark-width')
    style.remove()
  })
}

export default {
  id: ID,
  name: 'Classic Gold',
  description: 'The original gold theme, pixel caduceus, and telemetry tape',
  defaultEnabled: true,
  register (ctx) {
    const bootMirrorChanged = syncBootThemeMirror()
    settingsAtom.set(sanitizeSettings(ctx.storage.get(SETTINGS_KEY, DEFAULT_SETTINGS)))
    ctx.registerMany([
      {
        id: 'theme',
        area: THEMES_AREA,
        data: classicGoldTheme
      },
      {
        id: 'telemetry',
        area: STATUSBAR_AREAS.left,
        order: 5,
        data: {
          id: 'classic-gold.telemetry',
          render: () => jsx(TelemetryTape, { rest: ctx.rest, storage: ctx.storage }),
          toggleLabel: 'Classic Gold telemetry tape'
        }
      },
      {
        id: 'settings-route',
        area: ROUTES_AREA,
        title: 'Classic Gold',
        data: { path: '/classic-gold' },
        render: () => jsx(ClassicGoldSettingsPage, { storage: ctx.storage })
      },
      {
        id: 'settings-command',
        area: PALETTE_AREA,
        data: {
          id: 'classic-gold.settings',
          label: 'Customize Classic Gold',
          keywords: ['classic', 'gold', 'status bar', 'telemetry', 'theme'],
          run: openClassicGoldSettings
        }
      }
    ])
    installVisualLayer(ctx)
    if (bootMirrorChanged) {
      window.setTimeout(() => window.location.reload(), 100)
    }
  }
}
