import { initApp } from '@freeappstore/sdk'

// The SDK instance the platform Shell needs (topbar, theme, profile menu).
// PulseStack never calls fas.kv / proxy / collections.
export const fas = initApp({ appId: 'pulsestack' })
