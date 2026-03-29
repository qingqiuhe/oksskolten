import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app'
import './index.css'
import { flushOfflineQueue } from './lib/offlineQueue'

window.addEventListener('online', () => flushOfflineQueue().catch(() => {}))
if (navigator.onLine) flushOfflineQueue().catch(() => {})

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister()
    })
  })
}

if ('caches' in window) {
  void caches.keys().then((cacheNames) => {
    cacheNames.forEach((cacheName) => {
      void caches.delete(cacheName)
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
