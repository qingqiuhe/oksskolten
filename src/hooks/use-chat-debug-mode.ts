import { useEffect, useState } from 'react'

export type ChatDebugMode = 'on' | 'off'

const STORAGE_KEY = 'chat-debug-mode'
const SYNC_EVENT = 'chat-debug-mode-change'

function readMode(): ChatDebugMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'on' ? 'on' : 'off'
}

export function useChatDebugMode() {
  const [chatDebugMode, setChatDebugModeState] = useState<ChatDebugMode>(readMode)

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setChatDebugModeState(readMode())
      }
    }
    const handleSync = () => {
      setChatDebugModeState(readMode())
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(SYNC_EVENT, handleSync)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(SYNC_EVENT, handleSync)
    }
  }, [])

  const setChatDebugMode = (next: ChatDebugMode) => {
    localStorage.setItem(STORAGE_KEY, next)
    setChatDebugModeState(next)
    window.dispatchEvent(new Event(SYNC_EVENT))
  }

  return { chatDebugMode, setChatDebugMode }
}
