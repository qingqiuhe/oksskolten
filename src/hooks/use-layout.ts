import { createLocalStorageHook } from './create-local-storage-hook'
import type { LayoutName } from '../data/layouts'
import { LAYOUT_VALUES } from '../data/layouts'

const useHook = createLocalStorageHook<LayoutName>('list-layout', 'list', LAYOUT_VALUES)

export function useLayout() {
  const [layout, setLayout] = useHook()
  return { layout, setLayout }
}
