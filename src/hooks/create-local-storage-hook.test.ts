import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createLocalStorageHook } from './create-local-storage-hook'

describe('createLocalStorageHook', () => {
  const useTestSetting = createLocalStorageHook<'a' | 'b'>('test-key', 'a', ['a', 'b'])

  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default value when localStorage is empty', () => {
    const { result } = renderHook(() => useTestSetting())
    expect(result.current[0]).toBe('a')
  })

  it('reads stored value from localStorage', () => {
    localStorage.setItem('test-key', 'b')
    const { result } = renderHook(() => useTestSetting())
    expect(result.current[0]).toBe('b')
  })

  it('ignores invalid localStorage value and returns default', () => {
    localStorage.setItem('test-key', 'invalid')
    const { result } = renderHook(() => useTestSetting())
    expect(result.current[0]).toBe('a')
  })

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useTestSetting())
    act(() => result.current[1]('b'))
    expect(result.current[0]).toBe('b')
    expect(localStorage.getItem('test-key')).toBe('b')
  })
})
