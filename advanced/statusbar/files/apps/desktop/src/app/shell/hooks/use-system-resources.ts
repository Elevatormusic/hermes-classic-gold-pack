import { useEffect, useState } from 'react'

export interface SystemResources {
  ram: { total: number; used: number }
  vram: { total: number; used: number } | null
}

// Polls the Electron main process for system RAM (Node `os`) + GPU VRAM
// (`nvidia-smi`, best-effort). Always on — the status-bar tape shows it whether
// or not a turn is running. Keeps the last reading through a transient failure.
export function useSystemResources(intervalMs = 2500): SystemResources | null {
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
        // Keep the last reading through a transient IPC/nvidia-smi hiccup.
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
