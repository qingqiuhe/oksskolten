import { createLocalStorageHook } from './create-local-storage-hook'

export type MascotChoice = 'off' | 'dream-puff' | 'sleepy-giant'

const VALID_VALUES: readonly MascotChoice[] = ['off', 'dream-puff', 'sleepy-giant']

const useHook = createLocalStorageHook<MascotChoice>('mascot', 'dream-puff', VALID_VALUES)

export function useMascot() {
  const [mascot, setMascot] = useHook()
  return { mascot, setMascot }
}
