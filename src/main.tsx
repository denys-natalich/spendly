import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SharedTrip } from './components/SharedTrip'
import { StoreProvider } from './store'
import { joinToken } from './lib/share'
import { initTheme } from './lib/theme'
import './index.css'

// Applied before first paint so a dark-mode user never sees a light flash.
initTheme()

/*
 * A share link opens a trip, not the app.
 *
 * Decided here rather than inside <App>, because the account store has nothing
 * to offer someone who has no account — no session to check, no ledger to
 * load, and no sign-in screen to be sent to.
 */
const token = joinToken()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {token ? (
      <SharedTrip token={token} />
    ) : (
      <StoreProvider>
        <App />
      </StoreProvider>
    )}
  </StrictMode>,
)
