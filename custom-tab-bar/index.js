const api = require('../utils/api')
const { navigate } = require('../utils/navigation')
const { LAYOUT } = require('../utils/panel')

Component({
  data: {
    selected: '',
    inset: -1,
    visible: true,
    footer: LAYOUT.footer,
    safeInset: 0,
    unreadBadge: { count: 0 },
    emptyBadge: {},
    items: [
      { id: 'home', label: '首页', icon: 'home' },
      { id: 'service', label: '服务', icon: 'shop' },
      { id: 'publish', label: '发布' },
      { id: 'message', label: '消息', icon: 'chat' },
      { id: 'profile', label: '我的', icon: 'user' }
    ]
  },
  lifetimes: {
    attached() {
      const info = wx.getWindowInfo()
      this.setData({ safeInset: Math.max(0, info.screenHeight - (info.safeArea?.bottom ?? info.screenHeight)) })
      this.loadUnread()
    },
    detached() { this.disposed = true }
  },
  pageLifetimes: {
    show() { this.loadUnread() }
  },
  methods: {
    async loadUnread() {
      if (this.loadingUnread || (!api.config.demoMode && !api.config.envId)) return
      this.loadingUnread = true
      try {
        const { count } = await api.request('notifications.unread')
        if (!this.disposed) this.setData({ unreadBadge: { count } })
      } catch (_) {
        // Keep the previous badge if the request fails.
      } finally { this.loadingUnread = false }
    },
    tap(event) {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      if (page?.route === 'pages/index/index') page.navigationTap(event)
      else navigate(event.detail.value)
    }
  }
})
