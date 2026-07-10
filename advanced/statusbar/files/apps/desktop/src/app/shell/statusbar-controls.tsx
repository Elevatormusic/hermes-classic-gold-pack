import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { type ComponentProps, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { useModelControls } from '@/app/session/hooks/use-model-controls'
import { ContextUsagePanel } from '@/app/shell/context-usage-panel'
import { ModelMenuCloseContext, ModelMenuPanel } from '@/app/shell/model-menu-panel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  dropdownMenuRow,
  dropdownMenuSectionLabel
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Tip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { compactNumber } from '@/lib/format'
import { ChevronDown } from '@/lib/icons'
import { LiveDuration } from '@/lib/statusbar'
import { normalize } from '@/lib/text'
import { cn } from '@/lib/utils'
import { $panesFlipped, $sidebarOpen, $sidebarWidth } from '@/store/layout'
import { setModelPreset } from '@/store/model-presets'
import { notifyError } from '@/store/notifications'
import {
  $activeSessionId,
  $busy,
  $connection,
  $currentFastMode,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort,
  $currentUsage,
  $sessionStartedAt,
  $turnStartedAt,
  setCurrentReasoningEffort
} from '@/store/session'

// Folded in from the former use-system-resources.ts hook. Keeping it in this
// tracked file (rather than a separate new file) means a Hermes-Agent update
// reverts it cleanly instead of orphaning a file that breaks the rebuild. See #1.
interface SystemResources {
  ram: { total: number; used: number }
  vram: { total: number; used: number } | null
}

function useSystemResources(intervalMs = 2500): SystemResources | null {
  const [resources, setResources] = useState<SystemResources | null>(null)

  useEffect(() => {
    const read = window.hermesDesktop?.getSystemResources

    if (!read) {
      return
    }

    let cancelled = false

    const tick = async () => {
      try {
        const next = await read()

        if (!cancelled) {
          setResources(next)
        }
      } catch {
        // keep the last reading through a transient nvidia-smi / IPC hiccup
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), intervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [intervalMs])

  return resources
}

const SYMBOLS = {
  caduceus: '\u2695',
  effort: '\u25C6',
  cloud: '\u2601',
  context: '\u25A3',
  exchange: '\u21C4',
  filled: '\u2588',
  home: '\u2302',
  railEnd: '\u2500\u256E',
  railStart: '\u256D\u2500',
  sep: '\u2502',
  speed: '\u21AF',
  shade: '\u2591',
  sigma: '\u03A3',
  timer: '\u25F7',
  gpu: '\u25A6',
  ram: '\u25A4'
} as const

const STATUSBAR_ACTION_CLASS =
  'inline-flex h-6 items-center gap-1 rounded-none px-2 text-[0.72rem]/none text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground disabled:cursor-default disabled:opacity-45'

export interface StatusbarMenuItem {
  id: string
  icon?: ReactNode
  label: string
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  onSelect?: () => void
  title?: string
  to?: string
}

export interface StatusbarItem {
  id: string
  label?: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  menuAlign?: 'center' | 'end' | 'start'
  menuClassName?: string
  menuContent?: ((close: () => void) => ReactNode) | ReactNode
  menuItems?: readonly StatusbarMenuItem[]
  onSelect?: (modifiers: StatusbarSelectModifiers) => void
  title?: string
  to?: string
  variant?: 'action' | 'link' | 'menu' | 'text'
}

export interface StatusbarSelectModifiers {
  shiftKey: boolean
}

export type StatusbarItemSide = 'left' | 'right'
export type SetStatusbarItemGroup = (id: string, items: readonly StatusbarItem[], side?: StatusbarItemSide) => void

interface StatusbarControlsProps extends ComponentProps<'footer'> {
  leftItems?: readonly StatusbarItem[]
  items?: readonly StatusbarItem[]
}

const LOCAL_PROVIDER_RE = /\b(custom|local|ollama|lmstudio|lm-studio|llama\.cpp|vllm)\b/i

function compactTokens(value: null | number | undefined): string {
  return compactNumber(value).replace(/k$/, 'K')
}

function compactMiddle(value: string, fallback: string, max = 30): string {
  const trimmed = value.trim()

  if (!trimmed) {
    return fallback
  }

  if (trimmed.length <= max) {
    return trimmed
  }

  const head = Math.max(8, Math.floor((max - 3) * 0.58))
  const tail = Math.max(6, max - head - 3)

  return `${trimmed.slice(0, head)}...${trimmed.slice(-tail)}`
}

function effortCode(effort: string, fast: boolean): string {
  if (fast) {
    return 'F'
  }

  const normalized = effort.trim().toLowerCase()

  if (!normalized) {
    return '-'
  }

  if (normalized.startsWith('low')) {
    return 'L'
  }

  if (normalized.startsWith('med')) {
    return 'M'
  }

  if (normalized.startsWith('high')) {
    return 'H'
  }

  if (normalized.startsWith('min') || normalized === 'none') {
    return 'N'
  }

  if (normalized.startsWith('auto')) {
    return 'A'
  }

  return normalized.slice(0, 1).toUpperCase()
}

function sourceBadge(provider: string, connectionMode: string | undefined): { label: string; symbol: string } {
  const trimmed = provider.trim()
  const isLocal = LOCAL_PROVIDER_RE.test(trimmed)
  const symbol = isLocal ? SYMBOLS.home : SYMBOLS.cloud

  if (!isLocal) {
    return { label: trimmed || (connectionMode === 'remote' ? 'remote' : 'api'), symbol }
  }

  // Local providers carry noisy slugs (e.g. "custom:local-(localhost:1234)") and
  // the ⌂ glyph already says "local". Prefer a runtime name if the slug names one;
  // otherwise map the endpoint PORT to the usual engine. This is a heuristic —
  // non-standard ports fall back to a plain "local".
  const byName = /ollama/i.test(trimmed)
    ? 'Ollama'
    : /lm[-\s]?studio/i.test(trimmed)
      ? 'LM Studio'
      : /vllm/i.test(trimmed)
        ? 'vLLM'
        : /llama\.?cpp/i.test(trimmed)
          ? 'llama.cpp'
          : null
  const port = trimmed.match(/:(\d{2,5})\b/)?.[1]
  const byPort =
    port === '1234'
      ? 'LM Studio'
      : port === '11434'
        ? 'Ollama'
        : port === '8000'
          ? 'vLLM'
          : port === '8080' || port === '8081'
            ? 'llama.cpp'
            : null

  return { label: byName ?? byPort ?? 'local', symbol }
}

function liveContextUsed(usage: { context_used?: number; total: number }): number {
  // Current context-WINDOW occupancy only. Deliberately NOT max(..., total):
  // `total` is cumulative lifetime session tokens, which climbs past the window
  // on multi-turn sessions and would make the meter read >100%. Between turns
  // this equals the provider's real prompt-token count; during a live reply it
  // may briefly lag until message.complete refreshes it.
  return usage.context_used ?? 0
}

function contextPercent(usage: { context_max?: number; context_percent?: number; context_used?: number; total: number }): number {
  if (usage.context_max && usage.context_max > 0) {
    return Math.max(0, Math.min(100, (liveContextUsed(usage) / usage.context_max) * 100))
  }

  if (typeof usage.context_percent === 'number') {
    return Math.max(0, Math.min(100, usage.context_percent))
  }

  return 0
}

function contextLabel(usage: { context_max?: number; context_used?: number; total: number }): string {
  if (usage.context_max && usage.context_max > 0) {
    return `${compactTokens(liveContextUsed(usage))}/${compactTokens(usage.context_max)}`
  }

  return `${compactTokens(usage.total)}tok`
}

function contextMeter(percent: number, width = 12): string {
  const bounded = Math.max(0, Math.min(100, percent))
  const filled = Math.round((bounded / 100) * width)

  return `${SYMBOLS.filled.repeat(filled)}${SYMBOLS.shade.repeat(width - filled)}`
}

function tokenSpeedLabel(output: number | undefined, since: null | number | undefined, now: number, measured?: number): string {
  if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
    return measured >= 10 ? measured.toFixed(0) + '/s' : measured.toFixed(1) + '/s'
  }

  if (!since || !output || output <= 0) {
    return '--/s'
  }

  const seconds = Math.max(1, (now - since) / 1000)
  const speed = output / seconds

  if (!Number.isFinite(speed) || speed <= 0) {
    return '--/s'
  }

  return speed >= 10 ? speed.toFixed(0) + '/s' : speed.toFixed(1) + '/s'
}

function costLabel(cost: number | undefined, local: boolean): string {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) {
    return local ? '--' : '0.00'
  }

  if (cost <= 0 && local) {
    return '--'
  }

  return cost.toFixed(cost > 99 ? 0 : 2)
}

// GiB with a decimal for "used" (17.2), whole number for the total (24).
function fmtGb(bytes: number, decimals = 1): string {
  return (bytes / 1024 ** 3).toFixed(decimals)
}

// Tint a used/total memory readout by pressure: calm → amber → red.
function memColor(pct: number): string {
  if (pct >= 92) {
    return '#E0554F'
  }
  if (pct >= 78) {
    return '#F2B705'
  }
  return '#CFC39D'
}

// Flex segment (not a grid cell) — packs tight, no forced min-width, so the row
// hugs its content and only the min-w-0 segments (model/source) truncate.
function RailCell({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('flex items-center gap-1.5 whitespace-nowrap', className)}>{children}</span>
}

// Softer glow than before (0 0 4px vs 0 0 10px) so adjacent glyphs don't smear.
function RailGlyph({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[#F2B705] [text-shadow:0_0_4px_rgba(242,183,5,0.18)]">{children}</span>
}

function Sep() {
  return <span className="shrink-0 text-[#6b540f]">{SYMBOLS.sep}</span>
}

/* Decode-only anchor for the tok/s fallback: stamp the first moment output
   tokens appear in the current turn. Anchoring at turn start folds prompt
   upload + prefill + time-to-first-token + tool-call gaps into the window,
   dragging the shown rate far below the model's true decode speed — on local
   models a large prompt prefills for seconds before the first token (#60583). */
function useDecodeStartedAt(turnStartedAt: null | number | undefined, output: number | undefined): null | number {
  const ref = useRef<{ at: null | number; turn: null | number | undefined }>({ at: null, turn: null })

  if (ref.current.turn !== turnStartedAt) {
    ref.current = { at: null, turn: turnStartedAt }
  }
  if (ref.current.at === null && typeof output === 'number' && output > 0) {
    ref.current.at = Date.now()
  }

  return ref.current.at
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) {
      return
    }

    const tick = () => setNow(Date.now())
    tick()
    const timer = window.setInterval(tick, 1000)

    return () => window.clearInterval(timer)
  }, [enabled])

  return now
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1600 : window.innerWidth))

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)

    window.addEventListener('resize', onResize)

    return () => window.removeEventListener('resize', onResize)
  }, [])

  return width
}

function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current

    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }

    const update = () => setWidth(Math.round(element.getBoundingClientRect().width))
    update()

    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

// Hermes' reasoning levels (mirrors model-edit-submenu's EFFORT_OPTIONS).
// `none` is owned by the Thinking toggle, not the radio.
const REASONING_EFFORTS = [
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Max', value: 'xhigh' }
] as const

// Click-to-edit reasoning from the tape's ◆ segment: a Thinking on/off switch
// plus an effort radio, both writing the same `reasoning` gateway config the
// composer's model submenu uses. Optimistic with rollback on failure.
function TapeReasoningMenu({
  children,
  effort,
  model,
  provider,
  requestGateway,
  sessionId
}: {
  children: ReactNode
  effort: string
  model: string
  provider: string
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  sessionId: string | null
}) {
  const normalized = normalize(effort || 'medium')
  const thinkingOn = normalized !== 'none'
  const effortValue = REASONING_EFFORTS.some(option => option.value === normalized) ? normalized : 'medium'

  const patchReasoning = async (next: string) => {
    setModelPreset(provider, model, { effort: next })
    setCurrentReasoningEffort(next)

    // Preset + optimistic store are the whole effect until there's a live
    // session for the gateway to push onto.
    if (!sessionId) {
      return
    }

    try {
      await requestGateway('config.set', { key: 'reasoning', session_id: sessionId, value: next })
    } catch (err) {
      setCurrentReasoningEffort(effort)
      setModelPreset(provider, model, { effort })
      notifyError(err, 'Could not update reasoning')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-48 p-0" side="top" sideOffset={10}>
        <DropdownMenuItem className={dropdownMenuRow} onSelect={event => event.preventDefault()}>
          Thinking
          <Switch
            checked={thinkingOn}
            className="ml-auto"
            onCheckedChange={checked => void patchReasoning(checked ? effortValue : 'none')}
            size="xs"
          />
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-0" />
        <DropdownMenuLabel className={dropdownMenuSectionLabel}>Effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={value => void patchReasoning(value)} value={thinkingOn ? effortValue : ''}>
          {REASONING_EFFORTS.map(option => (
            <DropdownMenuRadioItem
              className={dropdownMenuRow}
              key={option.value}
              onSelect={event => event.preventDefault()}
              value={option.value}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TelemetryTape() {
  const busy = useStore($busy)
  const connection = useStore($connection)
  const fast = useStore($currentFastMode)
  const model = useStore($currentModel)
  const provider = useStore($currentProvider)
  const reasoningEffort = useStore($currentReasoningEffort)
  const usage = useStore($currentUsage)
  const sessionStartedAt = useStore($sessionStartedAt)
  const turnStartedAt = useStore($turnStartedAt)
  const activeSessionId = useStore($activeSessionId)
  const { gatewayRef, requestGateway } = useGatewayRequest()
  const queryClient = useQueryClient()
  const { selectModel } = useModelControls({ activeSessionId, queryClient, requestGateway })
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const viewportWidth = useViewportWidth()
  const now = useNow(busy)
  const resources = useSystemResources()

  const source = sourceBadge(provider, connection?.mode)
  const pct = Math.round(contextPercent(usage))
  const elapsedSince = busy && turnStartedAt ? turnStartedAt : sessionStartedAt
  const local = source.symbol === SYMBOLS.home
  const decodeStartedAt = useDecodeStartedAt(turnStartedAt, usage.output)
  const speed = tokenSpeedLabel(usage.output, decodeStartedAt ?? turnStartedAt, now, usage.tokens_per_second)
  // Progressive disclosure driven by the STABLE viewport width — never the
  // tape's own measured width, which would feed back on itself. The flex layout
  // below hugs its content and truncates model/source, so these thresholds only
  // decide when to DROP a whole low-priority segment on a narrow window.
  const hidden = viewportWidth < 880
  const mini = viewportWidth < 1000
  const compact = viewportWidth < 1180
  const statusLabel = busy ? 'RUN' : 'IDLE'
  const showEffort = !mini
  const showSource = !compact
  const showSpeed = viewportWidth >= 1000
  const showCost = !compact
  const showTimer = viewportWidth >= 1100
  const meterWidth = mini ? 0 : compact ? 5 : 8
  const detailTitle = [
    'model: ' + (model || 'model'),
    'effort: ' + (fast ? 'fast' : reasoningEffort || '-'),
    'source: ' + source.label,
    'tokens: ' + compactTokens(usage.total),
    'context: ' + contextLabel(usage) + ' ' + pct + '%',
    'in/out: ' + compactTokens(usage.input) + '/' + compactTokens(usage.output),
    'cost: ' + costLabel(usage.cost_usd, local),
    'speed: ' + speed
  ].join(' | ')

  if (hidden) {
    return null
  }

  return (
    <div
      aria-label="Hermes telemetry tape"
      className="pointer-events-none absolute left-1/2 z-10 flex h-7 -translate-x-1/2 items-center overflow-hidden rounded-[3px] border border-[#F2B705]/55 bg-[#0D0D0D]/98 px-3 text-[12.5px]/none font-semibold text-[#CFC39D] shadow-[inset_0_0_0_1px_rgba(115,90,16,0.30),0_6px_14px_rgba(0,0,0,0.22)]"
      style={{
        bottom: 'calc(100% + 0.15rem)',
        left: '50%',
        maxWidth: 'calc(100% - 2rem)',
        width: 'fit-content'
      }}
      title={detailTitle}
    >
      <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
        <RailCell className="shrink-0 text-[#F2B705]">
          <span className="text-[#735A10]">{SYMBOLS.railStart}</span>
          HERMES-AGENT
        </RailCell>
        <Sep />
        <RailCell className={cn('shrink-0', busy ? 'text-[#F29F05]' : 'text-[#F5D879]')}>[{statusLabel}]</RailCell>
        <Sep />
        <RailCell className="min-w-0 shrink text-[#F5D879]">
          <DropdownMenu onOpenChange={setModelMenuOpen} open={modelMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                className="pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-[2px] px-1 outline-none transition-colors hover:bg-[#F2B705]/12 focus-visible:bg-[#F2B705]/15"
                title="Switch model"
                type="button"
              >
                <RailGlyph>{SYMBOLS.caduceus}</RailGlyph>
                <span className="min-w-0 max-w-[13rem] truncate">{model || 'model'}</span>
                <ChevronDown className="size-2.5 shrink-0 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 p-0" side="top" sideOffset={10}>
              <ModelMenuCloseContext.Provider value={() => setModelMenuOpen(false)}>
                <ModelMenuPanel
                  gateway={gatewayRef.current ?? undefined}
                  onSelectModel={selectModel}
                  requestGateway={requestGateway}
                />
              </ModelMenuCloseContext.Provider>
            </DropdownMenuContent>
          </DropdownMenu>
        </RailCell>
        {showEffort && (
          <>
            <Sep />
            <RailCell className="shrink-0 gap-2">
              <TapeReasoningMenu
                effort={reasoningEffort}
                model={model}
                provider={provider}
                requestGateway={requestGateway}
                sessionId={activeSessionId}
              >
                <button
                  className="pointer-events-auto flex items-center gap-1.5 rounded-[2px] px-1 outline-none transition-colors hover:bg-[#F2B705]/12 focus-visible:bg-[#F2B705]/15"
                  title="Reasoning effort · thinking on/off"
                  type="button"
                >
                  <RailGlyph>{SYMBOLS.effort}</RailGlyph>
                  <span>{effortCode(reasoningEffort, fast)}</span>
                </button>
              </TapeReasoningMenu>
              {showSource && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <RailGlyph>{source.symbol}</RailGlyph>
                  <span className="min-w-0 max-w-[10rem] truncate">{source.label}</span>
                </span>
              )}
            </RailCell>
          </>
        )}
        <Sep />
        {/* The tape is pointer-events-none so it never blocks the composer; this
            trigger opts back in so the breakdown opens from HERE (the single
            telemetry surface) rather than a duplicate footer item. */}
        <RailCell className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="pointer-events-auto flex items-center gap-1.5 rounded-[2px] px-1 outline-none transition-colors hover:bg-[#F2B705]/12 focus-visible:bg-[#F2B705]/15"
                title="Context usage — open breakdown"
                type="button"
              >
                <RailGlyph>{SYMBOLS.context}</RailGlyph>
                <span className="tabular-nums">{contextLabel(usage)}</span>
                {meterWidth > 0 && (
                  <span className="text-[#F2B705] [text-shadow:0_0_8px_rgba(242,183,5,0.20)]">[{contextMeter(pct, meterWidth)}]</span>
                )}
                <span className="tabular-nums">{String(pct).padStart(2, '0')}%</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-auto border-(--ui-stroke-secondary) p-0" side="top" sideOffset={10}>
              <ContextUsagePanel currentUsage={usage} requestGateway={requestGateway} sessionId={activeSessionId} />
            </DropdownMenuContent>
          </DropdownMenu>
        </RailCell>
        {(showSpeed || showCost || showTimer) && (
          <>
            <Sep />
            <RailCell className="shrink-0 gap-2.5">
              {showSpeed && (
                <span className="flex items-center gap-1.5">
                  <RailGlyph>{SYMBOLS.speed}</RailGlyph>
                  <span className="tabular-nums">{speed}</span>
                </span>
              )}
              {showCost && (
                <span className="flex items-center gap-1.5">
                  <RailGlyph>$</RailGlyph>
                  <span className="tabular-nums text-[#D98236]">{costLabel(usage.cost_usd, local)}</span>
                </span>
              )}
              {showTimer && (
                <span className="flex items-center gap-1.5">
                  <RailGlyph>{SYMBOLS.timer}</RailGlyph>
                  <span className="tabular-nums">{elapsedSince ? <LiveDuration since={elapsedSince} /> : '--'}</span>
                </span>
              )}
            </RailCell>
          </>
        )}
        {resources && !mini && (
          <>
            <Sep />
            <RailCell className="shrink-0 gap-2.5">
              {resources.vram && (
                <span className="flex items-center gap-1.5" title="GPU VRAM used / total">
                  <RailGlyph>{SYMBOLS.gpu}</RailGlyph>
                  <span
                    className="tabular-nums"
                    style={{ color: memColor((resources.vram.used / resources.vram.total) * 100) }}
                  >
                    {fmtGb(resources.vram.used)}/{fmtGb(resources.vram.total, 0)}G
                  </span>
                </span>
              )}
              <span className="flex items-center gap-1.5" title="System RAM used / total">
                <RailGlyph>{SYMBOLS.ram}</RailGlyph>
                <span
                  className="tabular-nums"
                  style={{ color: memColor((resources.ram.used / resources.ram.total) * 100) }}
                >
                  {fmtGb(resources.ram.used)}/{fmtGb(resources.ram.total, 0)}G
                </span>
              </span>
            </RailCell>
          </>
        )}
        <span className="shrink-0 text-[#735A10]">{SYMBOLS.railEnd}</span>
      </div>
    </div>
  )
}

export function StatusbarControls({ className, leftItems = [], items = [], style, ...props }: StatusbarControlsProps) {
  const navigate = useNavigate()
  const sidebarWidth = useStore($sidebarWidth)
  const sidebarOpen = useStore($sidebarOpen)
  const panesFlipped = useStore($panesFlipped)
  // Start the stock status bar at the chat pane's left edge so it follows the
  // prompt window instead of spilling under the left menu. 0 when the sidebar is
  // collapsed or the panes are flipped (the left pane isn't the chat sidebar).
  // (--pane-chat-sidebar-width only exists inside PaneShell; this footer is a
  // sibling of it, so we read the width from the layout store instead.)
  const leftInset = !panesFlipped && sidebarOpen ? sidebarWidth : 0

  return (
    <footer
      className={cn(
        // Classic Gold: start at the chat-sidebar's right edge (left set inline
        // below) so the stock status bar follows the prompt window instead of
        // spilling under the left menu. Collapses to full width when no sidebar.
        'absolute right-0 bottom-0 z-[31] flex h-8 shrink-0 items-center justify-between gap-2 border-t border-[#735A10]/45 bg-[#0D0D0D]/96 px-1 py-0 text-(--ui-text-tertiary) shadow-[0_-8px_18px_rgba(0,0,0,0.22)] [-webkit-app-region:no-drag]',
        className
      )}
      data-slot="statusbar"
      style={{
        fontFamily: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, monospace',
        left: `${leftInset}px`,
        ...style
      }}
      {...props}
    >
      <TelemetryTape />
      <div className="relative z-20 flex h-6 min-w-0 items-center gap-0.5 overflow-x-clip">
        {leftItems
          .filter(item => !item.hidden)
          .map(item => (
            <StatusbarItemView item={item} key={`left:${item.id}`} navigate={navigate} />
          ))}
      </div>
      <div className="relative z-20 flex h-6 min-w-0 items-center justify-end gap-0.5 overflow-x-clip">
        {items
          .filter(item => !item.hidden)
          .map(item => (
            <StatusbarItemView item={item} key={`right:${item.id}`} navigate={navigate} />
          ))}
      </div>
    </footer>
  )
}

function StatusbarItemView({ item, navigate }: { item: StatusbarItem; navigate: ReturnType<typeof useNavigate> }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const content = (
    <>
      {item.icon}
      {item.label && <span className="truncate">{item.label}</span>}
      {item.detail && <span className="truncate text-muted-foreground/80">{item.detail}</span>}
    </>
  )

  if (item.variant === 'menu' && (item.menuContent || (item.menuItems && item.menuItems.length > 0))) {
    const trigger = (
      <DropdownMenuTrigger asChild>
        <button className={cn(STATUSBAR_ACTION_CLASS, item.className)} disabled={item.disabled} type="button">
          {content}
        </button>
      </DropdownMenuTrigger>
    )

    return (
      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        {item.title ? (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent>{item.title}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          trigger
        )}
        <DropdownMenuContent
          align={item.menuAlign ?? 'start'}
          className={cn('w-56', item.menuContent && 'p-0', item.menuClassName)}
          side="top"
          sideOffset={8}
        >
          {item.menuContent
            ? typeof item.menuContent === 'function'
              ? item.menuContent(() => setMenuOpen(false))
              : item.menuContent
            : (item.menuItems ?? [])
                .filter(menuItem => !menuItem.hidden)
                .map(menuItem => (
                  <DropdownMenuItem
                    className={cn('gap-2 text-foreground focus:bg-accent [&_svg]:size-4', menuItem.className)}
                    disabled={menuItem.disabled}
                    key={menuItem.id}
                    onSelect={() => {
                      if (menuItem.to) {
                        navigate(menuItem.to)
                      }

                      menuItem.onSelect?.()
                    }}
                  >
                    {menuItem.href ? (
                      <a
                        className="inline-flex w-full items-center gap-2"
                        href={menuItem.href}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {menuItem.icon}
                        <span className="truncate">{menuItem.label}</span>
                      </a>
                    ) : (
                      <>
                        {menuItem.icon}
                        <span className="truncate">{menuItem.label}</span>
                      </>
                    )}
                  </DropdownMenuItem>
                ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (item.variant === 'text' && !item.onSelect && !item.to && !item.href) {
    return (
      <Tip label={item.title}>
        <div
          className={cn(
            'inline-flex h-6 items-center gap-1 px-2 text-[0.72rem]/none text-(--ui-text-tertiary)',
            item.className
          )}
        >
          {content}
        </div>
      </Tip>
    )
  }

  if (item.href || item.variant === 'link') {
    return (
      <Tip label={item.title}>
        <a className={cn(STATUSBAR_ACTION_CLASS, item.className)} href={item.href} rel="noreferrer" target="_blank">
          {content}
        </a>
      </Tip>
    )
  }

  return (
    <Tip label={item.title}>
      <button
        className={cn(STATUSBAR_ACTION_CLASS, item.className)}
        disabled={item.disabled}
        onClick={event => {
          if (item.to) {
            navigate(item.to)
          }

          item.onSelect?.({ shiftKey: event.shiftKey })
        }}
        type="button"
      >
        {content}
      </button>
    </Tip>
  )
}



