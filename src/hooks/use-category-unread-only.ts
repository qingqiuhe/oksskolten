import { createLocalStorageHook } from './create-local-storage-hook'

export type CategoryUnreadOnly = 'on' | 'off'

const useHook = createLocalStorageHook<CategoryUnreadOnly>('category-unread-only', 'off', ['on', 'off'])

export function useCategoryUnreadOnly() {
  const [categoryUnreadOnly, setCategoryUnreadOnly] = useHook()
  return { categoryUnreadOnly, setCategoryUnreadOnly }
}
