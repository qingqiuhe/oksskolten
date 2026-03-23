import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeybindingsSetting } from './use-keybindings-setting'
import type { KeyBindings } from './use-keyboard-navigation'

const STORAGE_KEY = 'keybindings'

const DEFAULT_KEYBINDINGS: KeyBindings = {
  next: 'j',
  prev: 'k',
  bookmark: 'b',
  openExternal: ';',
}

describe('useKeybindingsSetting', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default keybindings when localStorage is empty', () => {
    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(DEFAULT_KEYBINDINGS)
  })

  it('returns stored keybindings from localStorage', () => {
    const custom: KeyBindings = { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))

    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(custom)
  })

  it('persists keybindings to localStorage when set', () => {
    const { result } = renderHook(() => useKeybindingsSetting())
    const custom: KeyBindings = { next: 'n', prev: 'p', bookmark: 'm', openExternal: 'o' }

    act(() => {
      result.current.setKeybindings(custom)
    })

    expect(result.current.keybindings).toEqual(custom)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(custom)
  })

  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')

    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(DEFAULT_KEYBINDINGS)
  })

  it('falls back to defaults when localStorage contains incomplete data', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ next: 'n' }))

    const { result } = renderHook(() => useKeybindingsSetting())
    expect(result.current.keybindings).toEqual(DEFAULT_KEYBINDINGS)
  })
})
