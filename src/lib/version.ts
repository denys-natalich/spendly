/**
 * The deploy workflow injects the version at build time — the patch number is
 * the deploy counter, so every push to main ships a version the phone can be
 * checked against. A build made outside CI has no number to claim.
 */
const version = import.meta.env.VITE_APP_VERSION

export const VERSION_LABEL = version ? `v${version}` : 'dev build'
