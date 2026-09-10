import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { StoreProvider } from './store'
import { initTheme } from './lib/theme'
import './index.css'

// Applied before first paint so a dark-mode user never sees a light flash.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
)
