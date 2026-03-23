import { useState, useEffect } from 'react'
import type { KeyBindings } from './use-keyboard-navigation'

const STORAGE_KEY = 'keybindings'

const DEFAULT_KEYBINDINGS: KeyBindings = {
  next: 'j',
  prev: 'k',
  bookmark: 'b',
  openExternal: ';',
}

function isValidKeybindings(value: unknown): value is KeyBindings {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.next === 'string' && obj.next.length === 1 &&
    typeof obj.prev === 'string' && obj.prev.length === 1 &&
    typeof obj.bookmark === 'string' && obj.bookmark.length === 1 &&
    typeof obj.openExternal === 'string' && obj.openExternal.length === 1
  )
}

function getStored(): KeyBindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_KEYBINDINGS
    const parsed = JSON.parse(raw)
    return isValidKeybindings(parsed) ? parsed : DEFAULT_KEYBINDINGS
  } catch {
    return DEFAULT_KEYBINDINGS
  }
}

export function useKeybindingsSetting() {
  const [keybindings, setKeybindingsState] = useState<KeyBindings>(getStored)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keybindings))
  }, [keybindings])

  return { keybindings, setKeybindings: setKeybindingsState }
}

export { DEFAULT_KEYBINDINGS }
