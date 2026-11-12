const routes = { home: '/pages/index/index', service: '/pages/activities/index', publish: '/pages/publish/index', message: '/pages/notifications/index', profile: '/pages/me/index' }
function navigate(id) {
  const url = routes[id]
  if (!url) return
  const pages = getCurrentPages()
  const current = '/' + pages[pages.length - 1].route
  if (current === url) return
  const existing = pages.findIndex(page => '/' + page.route === url)
  if (existing >= 0) return wx.navigateBack({ delta: pages.length - 1 - existing })
  if (id === 'publish' || current === routes.home) return wx.navigateTo({ url })
  return wx.redirectTo({ url })
}
function back() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.reLaunch({ url: routes.home }) }
module.exports = { navigate, back }
