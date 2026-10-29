const { stops, clamp, snap, isCollapsed, LAYOUT } = require('../../utils/panel')
const { markersFor } = require('../../utils/markers')

const EXAMPLES = [
  { id: 1, title: '街角的咖啡馆', category: '日常', place: '成都 · 玉林', text: '走到街角，找个位置坐一会儿。', latitude: 30.6368, longitude: 104.0430 },
  { id: 2, title: '沿着河边散散步', category: '散步', place: '成都 · 锦江', text: '把脚步放慢，看看沿途的风景。', latitude: 30.6425, longitude: 104.0710 },
  { id: 3, title: '公园里的午后', category: '户外', place: '成都 · 人民公园', text: '树荫下的长椅，很适合发呆。', latitude: 30.6587, longitude: 104.0550 },
  { id: 4, title: '发现一条小巷', category: '日常', place: '成都 · 宽窄巷子', text: '换一条回家的路，看看不一样的街道。', latitude: 30.6635, longitude: 104.0527 },
  { id: 5, title: '今天去骑行', category: '户外', place: '成都 · 东湖公园', text: '在城市里寻找一段舒服的骑行路线。', latitude: 30.6175, longitude: 104.0830 },
  { id: 6, title: '傍晚的街头', category: '散步', place: '成都 · 望平街', text: '等天色慢慢暗下来，再继续往前走。', latitude: 30.6540, longitude: 104.0910 }
]

Page({
  data: {
    latitude: 30.6510, longitude: 104.0650, scale: 13,
    panelHeight: 400, dragging: false, collapsed: false, safeBottom: 0, bottomBarHeight: LAYOUT.footer, panelBottom: LAYOUT.footer, topInset: 100,
    layout: LAYOUT, keyboardHeight: 0, searchFocused: false, viewMode: 'browse',
    navigation: [
      { id: 'home', label: '首页', icon: 'home' },
      { id: 'service', label: '服务', icon: 'shop' },
      { id: 'publish', label: '发布' },
      { id: 'message', label: '消息', icon: 'chat' },
      { id: 'profile', label: '我的', icon: 'user' }
    ],
    query: '', activeCategory: '全部', categories: ['全部', '日常', '散步', '户外'],
    items: EXAMPLES, markers: markersFor(EXAMPLES, 0), selectedId: 0, selectedItem: null, scrollTop: 0, scrollIntoView: '',
    locating: false, locationGranted: false, mapError: false
  },
  onLoad() { this.measure() },
  onReady() { this.map = wx.createMapContext('main-map', this); this.scheduleMapFit() },
  onResize() {
    const info = wx.getWindowInfo()
    // 键盘不改变基础窗口尺寸；横竖屏变化仍需重新布局。
    if ((this.data.searchFocused || this.data.keyboardHeight) && info.windowWidth === this.windowWidth) return
    this.measure()
  },
  onHide() {
    if (this.drag) this.settleDrag(true)
    if (this.data.searchFocused) this.finishSearch({ adjustMap: false })
    clearTimeout(this.mapFitTimer)
  },
  onUnload() { this.disposed = true; clearTimeout(this.mapFitTimer) },
  measure() {
    const info = wx.getWindowInfo()
    this.windowHeight = info.windowHeight
    this.windowWidth = info.windowWidth
    const safeBottom = Math.max(0, info.screenHeight - (info.safeArea ? info.safeArea.bottom : info.screenHeight))
    const bottomBarHeight = LAYOUT.footer + safeBottom
    const capsule = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null
    this.drag = null
    this.relayout(this.panelStop === undefined ? 1 : this.panelStop, { safeBottom, bottomBarHeight, topInset: (capsule && capsule.bottom ? capsule.bottom : (info.statusBarHeight || 0) + 44) + 12 })
  },
  relayout(stop, patch = {}) {
    const state = { ...this.data, ...patch }
    const panelBottom = state.keyboardHeight || state.bottomBarHeight
    this.targets = stops(this.windowHeight - panelBottom)
    this.updatePanel(this.targets[state.viewMode === 'detail' ? 1 : stop], { ...patch, panelBottom })
  },
  updatePanel(height, patch = {}) {
    const dragging = !!patch.dragging
    const collapsed = isCollapsed(height, this.targets[0], this.data.collapsed, dragging)
    if (!dragging) this.panelStop = this.targets.indexOf(snap(height, 0, this.targets))
    this.setData({ ...patch, panelHeight: height, collapsed, dragging })
  },
  navigationTap(event) {
    const item = this.data.navigation.find(value => value.id === event.detail.value)
    if (item && item.id !== 'home') wx.showToast({ title: `${item.label}暂未开放`, icon: 'none' })
  },
  dragStart(event) {
    if (this.data.viewMode !== 'browse') return
    if (this.data.searchFocused) { this.finishSearch(); wx.hideKeyboard({}); return }
    clearTimeout(this.mapFitTimer)
    const touch = event.touches[0]
    if (!touch) return
    this.drag = { y: touch.clientY, height: this.data.panelHeight, lastY: touch.clientY, lastTime: Date.now(), velocity: 0, distance: 0 }
    this.updatePanel(this.data.panelHeight, { dragging: true })
  },
  dragMove(event) {
    if (!this.drag || !event.touches.length) return
    const y = event.touches[0].clientY
    const now = Date.now()
    const elapsed = now - this.drag.lastTime
    if (elapsed > 0 && y !== this.drag.lastY) this.drag.velocity = (this.drag.lastY - y) / elapsed
    this.drag.distance = Math.max(this.drag.distance, Math.abs(this.drag.y - y))
    this.drag.lastY = y
    this.drag.lastTime = now
    const height = Math.round(clamp(this.drag.height + this.drag.y - y, this.targets[0], this.targets[1]))
    if (height !== this.data.panelHeight) this.updatePanel(height, { dragging: true })
  },
  dragEnd() {
    this.settleDrag(false)
  },
  dragCancel() {
    this.settleDrag(true)
  },
  settleDrag(cancelled) {
    if (!this.drag) return
    const velocity = cancelled || this.drag.distance < 8 || Date.now() - this.drag.lastTime > 100 ? 0 : this.drag.velocity
    const height = snap(this.data.panelHeight, velocity, this.targets, cancelled ? undefined : this.drag.height)
    if (this.drag.distance >= 8) this.ignoreTapUntil = Date.now() + 180
    this.drag = null
    this.updatePanel(height)
  },
  togglePanel() {
    if (this.data.viewMode !== 'browse') return
    if (Date.now() < (this.ignoreTapUntil || 0)) return
    if (this.data.searchFocused) { this.finishSearch({ adjustMap: false }); wx.hideKeyboard({}) }
    clearTimeout(this.mapFitTimer)
    this.updatePanel(this.data.collapsed ? this.targets[1] : this.targets[0])
  },
  searchFocus() {
    if (this.data.searchFocused || this.data.viewMode !== 'browse') return
    clearTimeout(this.mapFitTimer)
    this.drag = null
    this.relayout(1, { searchFocused: true })
  },
  keyboardChanged(event) {
    const height = Math.max(0, event.detail.height || 0)
    if (height && !this.data.searchFocused) return
    if (!height) { if (this.data.keyboardHeight) this.finishSearch(); return }
    this.relayout(1, { keyboardHeight: height })
  },
  finishSearch({ adjustMap = true } = {}) {
    if (!this.data.searchFocused && !this.data.keyboardHeight) return
    this.relayout(1, { searchFocused: false, keyboardHeight: 0 })
    if (adjustMap) this.scheduleMapFit()
  },
  confirmSearch() {
    this.finishSearch()
    wx.hideKeyboard({})
  },
  search(event) { this.setData({ query: event.detail.value }); this.filter() },
  clearSearch() { this.setData({ query: '' }); this.filter() },
  resetFilters() { this.setData({ query: '', activeCategory: '全部' }); this.filter() },
  category(event) { this.setData({ activeCategory: event.currentTarget.dataset.category }); this.filter() },
  filter() {
    const query = this.data.query.trim().toLowerCase()
    const items = EXAMPLES.filter(item => (this.data.activeCategory === '全部' || item.category === this.data.activeCategory) && `${item.title}${item.text}${item.place}`.toLowerCase().includes(query))
    const selectedItem = items.find(item => item.id === this.data.selectedId) || null
    this.setData({ items, selectedItem, selectedId: selectedItem ? selectedItem.id : 0, viewMode: selectedItem ? this.data.viewMode : 'browse', markers: markersFor(items, selectedItem ? selectedItem.id : 0) })
    this.relayout(this.data.searchFocused ? 1 : this.panelStop)
    this.resetScroll()
    this.scheduleMapFit()
  },
  scrolled(event) { this.scrollPosition = event.detail.scrollTop },
  resetScroll(anchor = '') {
    // 先同步实际滚动位置，确保重复筛选时 scroll-top=0 仍会触发滚动。
    this.setData({ scrollTop: this.scrollPosition || 0, scrollIntoView: '' }, () => {
      if (!this.disposed) this.setData({ scrollTop: 0, scrollIntoView: anchor })
    })
    this.scrollPosition = 0
  },
  selectItem(event) {
    this.selectPoint(Number(event.currentTarget.dataset.id))
  },
  markerTap(event) { this.selectPoint(Number(event.detail.markerId)) },
  selectPoint(id) {
    const item = this.data.items.find(value => value.id === id)
    if (!item) return
    if (this.data.viewMode === 'detail' && this.data.selectedId === id) return
    this.finishSearch({ adjustMap: false })
    this.drag = null
    wx.hideKeyboard({})
    this.relayout(1, { viewMode: 'detail', latitude: item.latitude, longitude: item.longitude, scale: 16, selectedId: item.id, selectedItem: item, markers: markersFor(this.data.items, item.id) })
    this.scheduleMapFit(item)
  },
  returnToBrowse() {
    const item = this.data.selectedItem
    if (!item || this.data.viewMode !== 'detail') return
    clearTimeout(this.mapFitTimer)
    this.relayout(1, { viewMode: 'browse' })
    this.resetScroll(`point-${item.id}`)
  },
  scheduleMapFit(item) {
    clearTimeout(this.mapFitTimer)
    if (!this.map || this.data.searchFocused || !this.data.items.length) return
    this.mapFitTimer = setTimeout(() => {
      if (this.disposed || !this.map || this.data.dragging) return
      const points = item ? [
        { latitude: item.latitude - 0.002, longitude: item.longitude - 0.002 },
        { latitude: item.latitude + 0.002, longitude: item.longitude + 0.002 }
      ] : this.data.items.map(point => ({ latitude: point.latitude, longitude: point.longitude }))
      this.map.includePoints({ points, padding: [this.data.topInset + 20, 32, this.data.panelBottom + this.data.panelHeight + 24, 32] })
    }, 260)
  },
  locate() {
    if (this.data.locating) return
    this.setData({ locating: true })
    wx.getLocation({
      type: 'gcj02',
      success: location => {
        if (this.disposed) return
        clearTimeout(this.mapFitTimer)
        this.relayout(this.panelStop, { viewMode: 'browse', selectedItem: null, selectedId: 0, markers: markersFor(this.data.items, 0) })
        this.setData({ latitude: location.latitude, longitude: location.longitude, scale: 16, locationGranted: true })
        if (this.map) this.map.moveToLocation({ latitude: location.latitude, longitude: location.longitude })
      },
      fail: error => {
        if (this.disposed) return
        const denied = /auth deny|auth denied|authorize/i.test(error.errMsg || '')
        if (denied) {
          wx.showModal({ title: '定位未开启', content: '你仍可浏览地图，也可以前往设置允许位置权限。', confirmText: '去设置', success: result => { if (result.confirm) wx.openSetting({}) } })
        } else wx.showToast({ title: '定位暂不可用，请检查系统定位或稍后重试', icon: 'none' })
      },
      complete: () => { if (!this.disposed) this.setData({ locating: false }) }
    })
  },
  mapFailed() { this.setData({ mapError: true }) },
  mapUpdated() { if (this.data.mapError) this.setData({ mapError: false }) },
  retryMap() { this.setData({ mapError: false }); if (this.map) this.map.moveToLocation({ latitude: this.data.latitude, longitude: this.data.longitude }) }
})
