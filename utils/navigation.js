const routes = { home: '/pages/index/index', service: '/pages/activities/index', publish: '/pages/publish/index', message: '/pages/notifications/index', profile: '/pages/me/index' }
function navigate(id, intent) {
  if (id === 'profile' && intent) return openProfileSettings(intent)
  const url = routes[id]
  if (!url) return
  const pages = getCurrentPages()
  const current = '/' + pages[pages.length - 1]?.route
  if (current === url) return
  if (id === 'publish') return wx.navigateTo({ url })
  return wx.switchTab({
    url,
    fail(error) {
      console.warn('切换标签页失败', error.errMsg)
      wx.showToast({ title: '暂时无法切换页面，请重试', icon: 'none' })
    }
  })
}

function openProfileSettings(intent = {}) {
  const suffix = intent.presence ? '?presence=1' : intent.setup ? '?setup=1' : ''
  return wx.navigateTo({ url: '/pages/profile-settings/index' + suffix })
}

function syncTabBar(page, selected, patch = {}) {
  page.getTabBar?.()?.setData({ selected, ...patch })
}

function back() { if (getCurrentPages().length > 1) wx.navigateBack(); else navigate('home') }
module.exports = { navigate, back, syncTabBar, openProfileSettings }
