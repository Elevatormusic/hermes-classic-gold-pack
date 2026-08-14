(function registerClassicGoldDashboard () {
  'use strict'

  const registry = window.__HERMES_PLUGINS__
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('Hermes dashboard plug-in registry is not available.')
  }

  function ClassicGoldDashboard () {
    return null
  }

  registry.register('classic-gold', ClassicGoldDashboard)
})()
