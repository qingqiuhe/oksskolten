import { useState, useEffect, type Dispatch, type SetStateAction } from 'react'

/**
 * Factory that creates a hook backed by localStorage.
 *
 * @param key          localStorage key
 * @param defaultValue fallback when stored value is missing or invalid
 * @param validValues  set of accepted string values
 */
export function createLocalStorageHook<T extends string>(
  key: string,
  defaultValue: T,
  validValues: readonly T[],
): () => [T, Dispatch<SetStateAction<T>>] {
  const allowed = new Set<string>(validValues)

  function getStored(): T {
    const stored = localStorage.getItem(key)
    if (stored !== null && allowed.has(stored)) return stored as T
    return defaultValue
  }

  return function useLocalStorageSetting() {
    const [value, setValue] = useState<T>(getStored)

    useEffect(() => {
      localStorage.setItem(key, value)
    }, [value])

    return [value, setValue]
  }
}
