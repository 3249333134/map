const { stops, clamp, snap, isCollapsed, LAYOUT } = require('../../utils/panel')
const { markersFor, cosplayerMarkersFor, AVATAR_POSE } = require('../../utils/markers')
const avatarCache = require('../../utils/avatar-cache')
const { blurLocation } = require('../../utils/location-blur')
const { travelDuration } = require('../../utils/movement-speed')

const api = require('../../utils/api')
const { navigate, syncTabBar, openProfileSettings } = require('../../utils/navigation')
const EXAMPLES = api.config.demoMode ? require('../../data/demo') : []
const ENCOUNTER_DURATION = 1500

function encounterAvatar(person) {
  const key = person.avatar?.avatarKey || 'mika'
  const avatarUrl = person.avatar?.avatarUrl
  const portrait = person.avatarFramePaths?.[AVATAR_POSE.standing] || person.avatarPath || avatarUrl
  return {
    id: person.id,
    name: person.isMine ? '你' : person.avatar?.nickname || '附近同好',
    portrait: !portrait || portrait === `/static/avatars/${key}.png` ? `/static/chibi/${key}-0.png` : portrait,
    action: person.avatarFramePaths?.[AVATAR_POSE.wave] || ''
  }
}

Page({
  data: {
    latitude: 30.6510, longitude: 104.0650, scale: 13,
    panelHeight: 400, dragging: false, collapsed: false, safeBottom: 0, bottomBarHeight: LAYOUT.footer, panelBottom: LAYOUT.footer, topInset: 100,
    layout: LAYOUT, keyboardHeight: 0, searchFocused: false, viewMode: 'browse',
    query: '', activeCategory: '全部', categories: ['全部', '日常', '散步', '户外'], feedMode: 'people',
    items: EXAMPLES, cosplayers: [], ownProfile: null, markers: markersFor(EXAMPLES, 0), selectedId: 0, selectedItem: null, selectedPerson: null, scrollTop: 0, scrollIntoView: '',
    locating: false, locationGranted: false, mapError: false, shoutOpen: false, shoutText: '', shoutBusy: false, friendBusy: false, presenceBusy: false, presenceExpiryText: '', ownPresence: null, encounter: null
    ,loading: false, dataError: '', cursor: null, mapVisible: true, areaDirty: false, demoMode: api.config.demoMode
  },
  onLoad(options = {}) {
    const savedCenter = typeof getApp === 'function' && getApp().globalData.center
    if (savedCenter && Number.isFinite(savedCenter.latitude) && Number.isFinite(savedCenter.longitude)) {
      this.queryCenter = { latitude: savedCenter.latitude, longitude: savedCenter.longitude }
      this.setData({ latitude: savedCenter.latitude, longitude: savedCenter.longitude, scale: 15 })
    }
    this.measure()
    this.initialPost = options.post
  },
  onShow() {
    syncTabBar(this, 'home', { inset: this.data.safeBottom, visible: !this.data.keyboardHeight })
    if (!this.ready) return
    if (!api.config.demoMode && !api.config.envId) return
    this.refreshPeopleMarkers()
    this.scheduleIdleAction()
    if (getApp().globalData.feedDirty) { getApp().globalData.feedDirty = false; this.fetchFeed() }
    if (getApp().globalData.presenceDirty) {
      getApp().globalData.presenceDirty = false
      const center = getApp().globalData.center
      if (center && Number.isFinite(center.latitude) && Number.isFinite(center.longitude)) {
        this.queryCenter = { latitude: center.latitude, longitude: center.longitude }
        this.setData({ latitude: center.latitude, longitude: center.longitude, scale: 15, feedMode: 'people', viewMode: 'browse', selectedPerson: null, selectedItem: null, selectedId: 0 })
      }
      this.loadOwnPresence()
    }
    else if (this.data.ownPresence?.movementMode === 'fuzzy') this.startFuzzyFollow()
  },
  onReady() {
    this.ready = true
    this.map = wx.createMapContext('main-map', this)
    if (this.initialPost) { this.openShared(this.initialPost); return }
    if (api.config.demoMode || api.config.envId) {
      getApp().globalData.presenceDirty = false
      this.loadOwnPresence()
    } else this.setData({ dataError: '云环境尚未配置，当前无法显示真实 Cos 同好或同步地图位置。' })
  },
  onResize() {
    const info = wx.getWindowInfo()
    // 键盘不改变基础窗口尺寸；横竖屏变化仍需重新布局。
    if ((this.data.searchFocused || this.data.keyboardHeight) && info.windowWidth === this.windowWidth) return
    this.measure()
  },
  onHide() {
    this.cancelEncounter()
    this.stopIdleAction()
    this.stopFuzzyFollow()
    if (this.drag) this.settleDrag(true)
    if (this.data.searchFocused) this.finishSearch({ adjustMap: false })
    clearTimeout(this.mapFitTimer)
  },
  onUnload() { this.disposed = true; this.cancelEncounter(); this.stopIdleAction(); this.stopFuzzyFollow(); clearTimeout(this.mapFitTimer); clearTimeout(this.searchTimer); this.feedVersion = (this.feedVersion || 0) + 1 },
  peopleMarkers(people, selectedId) {
    return cosplayerMarkersFor(people, selectedId, person => {
      if (person.isMine && this.walkPose) return this.walkPose
      return person.id === this.wavingPersonId ? AVATAR_POSE.wave : AVATAR_POSE.standing
    })
  },
  refreshPeopleMarkers() {
    if (this.data.feedMode === 'people' && this.data.mapVisible && this.data.cosplayers.length) {
      this.setData({ markers: this.peopleMarkers(this.data.cosplayers, this.data.selectedId) })
    }
  },
  scheduleIdleAction() {
    clearTimeout(this.idleActionTimer)
    this.idleActionTimer = setTimeout(() => {
      if (this.disposed) return
      if (this.data.feedMode === 'people' && this.data.mapVisible && !this.data.mapError && !this.isWalking) {
        const candidates = this.data.cosplayers.filter(person => person.avatarFramePaths?.[AVATAR_POSE.wave])
        if (candidates.length) {
          this.wavingPersonId = candidates[Math.floor(Math.random() * candidates.length)].id
          this.refreshPeopleMarkers()
          this.idleActionTimer = setTimeout(() => {
            this.wavingPersonId = null
            this.refreshPeopleMarkers()
            this.scheduleIdleAction()
          }, 650)
          return
        }
      }
      this.scheduleIdleAction()
    }, 2200 + Math.floor(Math.random() * 2300))
  },
  stopIdleAction() {
    clearTimeout(this.idleActionTimer)
    this.wavingPersonId = null
  },
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
    if (patch.safeBottom !== undefined || patch.keyboardHeight !== undefined) {
      syncTabBar(this, 'home', { inset: this.data.safeBottom, visible: !this.data.keyboardHeight })
    }
  },
  navigationTap(event) {
    if (typeof getApp === 'function') getApp().globalData.center = this.queryCenter || { latitude: this.data.latitude, longitude: this.data.longitude }
    navigate(event.detail.value)
  },
  switchToPeople() { this.setData({ feedMode: 'people', selectedPerson: null, selectedItem: null, selectedId: 0, viewMode: 'browse', query: '' }); this.loadPeople() },
  switchToPosts() { this.setData({ feedMode: 'posts', selectedPerson: null, selectedItem: null, selectedId: 0, viewMode: 'browse', query: '' }); this.fetchFeed() },
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
    if (this.data.feedMode === 'people') {
      const query = this.data.query.trim().toLowerCase()
      const cosplayers = (this.allCosplayers || []).filter(person => person.isMine || `${person.avatar?.nickname || ''} ${(person.avatar?.tags || []).join(' ')} ${person.shout || ''} ${person.place || ''}`.toLowerCase().includes(query))
      const selectedPerson = cosplayers.find(person => person.id === this.data.selectedId) || null
      this.setData({ cosplayers, selectedPerson, selectedId: selectedPerson ? selectedPerson.id : 0, markers: this.peopleMarkers(cosplayers, selectedPerson?.id || 0) })
      this.resetScroll()
      return
    }
    if (!api.config.demoMode) {
      this.feedVersion = (this.feedVersion || 0) + 1
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => this.fetchFeed(), 300)
      return
    }
    const query = this.data.query.trim().toLowerCase()
    const source = this.posts || EXAMPLES
    const items = source.filter(item => (this.data.activeCategory === '全部' || item.category === this.data.activeCategory) && `${item.title}${item.text}${item.place}`.toLowerCase().includes(query))
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
    this.selectPoint(api.config.demoMode ? Number(event.currentTarget.dataset.id) : event.currentTarget.dataset.id)
  },
  async mapTap(event) {
    if (this.data.encounter || this.data.feedMode !== 'people' || this.data.viewMode !== 'browse') return
    const { latitude, longitude } = event.detail || {}
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    wx.showToast({ title: '形象正在走过去', icon: 'none', duration: 900 })
    await this.prepareAndWalk({ latitude, longitude })
  },
  markerTap(event) {
    if (this.data.feedMode === 'people') {
      const person = this.data.cosplayers.find(row => (row.markerId || row.id) === event.detail.markerId)
      if (!person) return
      if (person.isMine) { this.selectPerson({ currentTarget: { dataset: { id: person.id } } }); return }
      this.prepareAndWalk({ latitude: person.latitude, longitude: person.longitude }, person)
      return
    }
    const item = this.data.items.find(row => (row.markerId || row.id) === Number(event.detail.markerId)); if (item) this.selectPoint(item.id)
  },
  assignPeople(items) {
    this.personMarkerIds = this.personMarkerIds || new Map()
    this.nextPersonMarker = this.nextPersonMarker || 10001
    return items.map(item => { if (!this.personMarkerIds.has(item.id)) this.personMarkerIds.set(item.id, this.nextPersonMarker++); return { ...item, expiresAt: item.expiresAt || Date.now() + 60 * 60 * 1000, markerId: this.personMarkerIds.get(item.id) } })
  },
  async loadPeople() {
    const version = this.peopleVersion = (this.peopleVersion || 0) + 1
    if (!api.config.demoMode && !api.config.envId) { this.setData({ dataError: '云环境还未配置，地图暂时无法加载真实 Cos 同好。' }); return }
    this.setData({ loading: true, dataError: '' })
    try {
      const result = await api.request('presence.nearby', { center: this.queryCenter || { latitude: this.data.latitude, longitude: this.data.longitude } })
      if (this.disposed || version !== this.peopleVersion || this.isWalking) return
      this.allCosplayers = this.assignPeople(result.items || []).sort((a, b) => Number(b.isMine) - Number(a.isMine))
      const query = this.data.query.trim().toLowerCase()
      const cosplayers = this.allCosplayers.filter(person => person.isMine || `${person.avatar?.nickname || ''} ${(person.avatar?.tags || []).join(' ')} ${person.shout || ''} ${person.place || ''}`.toLowerCase().includes(query))
      if (this.data.feedMode !== 'people') return
      this.setData({ cosplayers, markers: this.peopleMarkers(cosplayers, 0), selectedPerson: null, selectedId: 0, viewMode: 'browse', dataError: '', areaDirty: false }, () => avatarCache.loadAll(cosplayers, (id, paths) => {
        if (this.disposed || version !== this.peopleVersion || this.data.feedMode !== 'people') return
        const avatarFramePaths = Array.isArray(paths) ? paths : [paths]
        this.allCosplayers = (this.allCosplayers || []).map(person => person.id === id ? { ...person, avatarFramePaths, avatarPath: avatarFramePaths[0] } : person)
        const visible = this.data.cosplayers.map(person => person.id === id ? { ...person, avatarFramePaths, avatarPath: avatarFramePaths[0] } : person)
        this.setData({ cosplayers: visible, markers: this.peopleMarkers(visible, this.data.selectedId), selectedPerson: this.data.selectedPerson?.id === id ? { ...this.data.selectedPerson, avatarFramePaths, avatarPath: avatarFramePaths[0] } : this.data.selectedPerson })
      }))
      this.resetScroll()
      this.scheduleMapFit()
    } catch (error) { if (!this.disposed && version === this.peopleVersion) this.setData({ dataError: error.message }) }
    finally { if (!this.disposed && version === this.peopleVersion) this.setData({ loading: false }) }
  },
  async loadOwnPresence() {
    const version = this.ownPresenceVersion = (this.ownPresenceVersion || 0) + 1
    try {
      const [result, profile] = await Promise.all([api.request('presence.me'), api.request('user.me')])
      if (this.disposed || version !== this.ownPresenceVersion || this.isWalking) return
      const active = result?.active && result.expiresAt > Date.now() ? result : null
      this.setData({ ownPresence: active, ownProfile: profile })
      this.walkPosition = active ? { latitude: active.latitude, longitude: active.longitude } : null
      if (active) {
        this.queryCenter = { latitude: active.latitude, longitude: active.longitude }
        this.setData({ latitude: active.latitude, longitude: active.longitude, scale: 15 })
        if (active.movementMode === 'fuzzy') {
          this.lastBlurCell = blurLocation(active.latitude, active.longitude).cellKey
          this.startFuzzyFollow()
        } else this.stopFuzzyFollow()
      } else this.stopFuzzyFollow()
    } catch (_) {
      // Nearby public browsing remains available if the user's own presence request fails.
    }
    if (!this.disposed && version === this.ownPresenceVersion && !this.isWalking) await this.loadPeople()
  },
  async prepareAndWalk(destination, handshakePerson = null) {
    if (this.data.presenceBusy || this.data.encounter) return
    if (this.data.ownPresence?.active) {
      await this.walkOwnAvatarTo(destination, handshakePerson)
      return
    }
    this.setData({ presenceBusy: true })
    try {
      const profile = await api.request('user.me')
      if (!profile?.nickname) {
        wx.showToast({ title: '先到“我的”保存昵称和形象', icon: 'none' })
        navigate('profile', { setup: true })
        return
      }
      const center = await new Promise((resolve, reject) => {
        if (!this.map) { resolve({ latitude: this.data.latitude, longitude: this.data.longitude }); return }
        this.map.getCenterLocation({ success: resolve, fail: reject })
      })
      const point = { latitude: center.latitude, longitude: center.longitude, place: '地图漫游', mode: 'current', movementMode: 'virtual', shout: '' }
      const result = await api.request('presence.set', point)
      this.peopleVersion = (this.peopleVersion || 0) + 1
      this.ownPresenceVersion = (this.ownPresenceVersion || 0) + 1
      this.queryCenter = { latitude: point.latitude, longitude: point.longitude }
      const self = {
        id: profile.id || 'self', isMine: true, ...point, active: true, expiresAt: result.expiresAt,
        avatar: { id: profile.id || 'self', nickname: profile.nickname, avatarKey: profile.avatarKey || 'mika', avatarUrl: profile.avatarUrl || '', avatarFrameUrls: profile.avatarFrameUrls || [], tags: profile.tags || [] },
        avatarFramePaths: profile.avatarFrameUrls || [],
        friendStatus: ''
      }
      const people = this.assignPeople([self, ...(this.allCosplayers || this.data.cosplayers).filter(person => !person.isMine)])
      this.allCosplayers = people
      const query = this.data.query.trim().toLowerCase()
      const cosplayers = people.filter(person => person.isMine || `${person.avatar?.nickname || ''} ${(person.avatar?.tags || []).join(' ')} ${person.shout || ''} ${person.place || ''}`.toLowerCase().includes(query))
      this.setData({ ownPresence: { ...point, active: true, expiresAt: result.expiresAt }, cosplayers, markers: this.peopleMarkers(cosplayers, 0) })
      getApp().globalData.presenceDirty = true
      this.setData({ presenceBusy: false })
      await this.walkOwnAvatarTo(destination, handshakePerson)
    } catch (error) { if (!this.disposed) api.toast(error) }
    finally { if (!this.disposed) this.setData({ presenceBusy: false }) }
  },
  startFuzzyFollow() {
    this.stopFuzzyFollow()
    if (api.config.demoMode || this.data.ownPresence?.movementMode !== 'fuzzy') return
    this.runFuzzyLocation()
    this.fuzzyTimer = setInterval(() => this.runFuzzyLocation(), 30000)
  },
  stopFuzzyFollow() { clearInterval(this.fuzzyTimer); this.fuzzyTimer = null },
  runFuzzyLocation() {
    if (this.fuzzyUpdating) return this.fuzzyUpdatePromise || Promise.resolve()
    this.fuzzyUpdatePromise = this.updateFuzzyLocation()
    return this.fuzzyUpdatePromise
  },
  async updateFuzzyLocation() {
    if (this.fuzzyUpdating || this.disposed || this.data.ownPresence?.movementMode !== 'fuzzy') return
    this.fuzzyUpdating = true
    try {
      const location = await new Promise((resolve, reject) => wx.getLocation({ type: 'gcj02', success: resolve, fail: reject }))
      if (this.disposed || this.data.ownPresence?.movementMode !== 'fuzzy') return
      const blurred = blurLocation(location.latitude, location.longitude)
      if (blurred.cellKey === this.lastBlurCell) return
      const point = { latitude: blurred.latitude, longitude: blurred.longitude, place: '约500米范围', mode: 'current', movementMode: 'fuzzy', shout: this.data.ownPresence.shout || '' }
      const result = await api.request('presence.set', point)
      if (this.disposed) return
      this.lastBlurCell = blurred.cellKey
      this.queryCenter = { latitude: point.latitude, longitude: point.longitude }
      const cosplayers = this.data.cosplayers.map(person => person.isMine ? { ...person, ...point, active: true, expiresAt: result.expiresAt } : person)
      this.allCosplayers = (this.allCosplayers || []).map(person => person.isMine ? { ...person, ...point, active: true, expiresAt: result.expiresAt } : person)
      this.setData({ ownPresence: { ...this.data.ownPresence, ...point, active: true, expiresAt: result.expiresAt }, cosplayers, markers: this.peopleMarkers(cosplayers, this.data.selectedId), latitude: point.latitude, longitude: point.longitude })
    } catch (_) {
      // A temporary location failure leaves the last coarse position active.
    } finally { this.fuzzyUpdating = false }
  },
  async walkOwnAvatarTo(destination, handshakePerson = null) {
    if (this.data.presenceBusy) return
    const encounterVersion = this.encounterVersion
    this.stopFuzzyFollow()
    this.peopleVersion = (this.peopleVersion || 0) + 1
    this.ownPresenceVersion = (this.ownPresenceVersion || 0) + 1
    this.isWalking = true
    this.setData({ presenceBusy: true })
    if (this.fuzzyUpdating && this.fuzzyUpdatePromise) await this.fuzzyUpdatePromise
    const presence = this.data.ownPresence
    const own = this.data.cosplayers.find(person => person.isMine)
    if (!own || !presence?.active) {
      this.isWalking = false
      this.setData({ presenceBusy: false })
      wx.showToast({ title: '你的形象还未加载出来，请再点一次地图', icon: 'none' })
      return
    }
    const runId = this.walkRunId = (this.walkRunId || 0) + 1
    const start = this.walkPosition || { latitude: presence.latitude, longitude: presence.longitude }
    let target = { latitude: destination.latitude, longitude: destination.longitude }
    const latMeters = (target.latitude - start.latitude) * 111320
    const lonMeters = (target.longitude - start.longitude) * 111320 * Math.cos(start.latitude * Math.PI / 180)
    const distance = Math.sqrt(latMeters * latMeters + lonMeters * lonMeters)
    if (handshakePerson && distance > 14) {
      const ratio = 10 / distance
      target = { latitude: target.latitude - (target.latitude - start.latitude) * ratio, longitude: target.longitude - (target.longitude - start.longitude) * ratio }
    }
    this.walkPosition = start
    this.walkTarget = target
    this.setData({ loading: false })
    this.setData({ ownPresence: { ...presence, movementMode: 'virtual' } })
    try {
      const duration = travelDuration(distance)
      if (duration) await this.animateOwnMarker(own, start, target, duration)
      this.walkPose = null
      if (this.disposed || runId !== this.walkRunId) return
      this.walkPosition = target
      const point = { ...this.data.ownPresence, ...target, mode: 'current', movementMode: 'virtual' }
      this.queryCenter = { latitude: target.latitude, longitude: target.longitude }
      const cosplayers = this.data.cosplayers.map(person => person.isMine ? { ...person, ...target, movementMode: 'virtual', place: point.place } : person)
      this.allCosplayers = (this.allCosplayers || []).map(person => person.isMine ? { ...person, ...target, movementMode: 'virtual', place: point.place } : person)
      this.setData({ ownPresence: { ...point, active: true }, cosplayers })
      this.refreshPeopleMarkers()
      getApp().globalData.presenceDirty = true
      const result = await api.request('presence.set', point)
      if (this.disposed || runId !== this.walkRunId) return
      this.setData({ ownPresence: { ...this.data.ownPresence, expiresAt: result.expiresAt } })
      if (handshakePerson && encounterVersion === this.encounterVersion && this.data.feedMode === 'people' && this.data.viewMode === 'browse') {
        this.showEncounter(own, handshakePerson)
      }
    } catch (error) { if (!this.disposed) api.toast(error) }
    finally {
      if (runId === this.walkRunId) {
        this.isWalking = false
        this.walkTarget = null
        if (this.walkPose) { this.walkPose = null; if (!this.disposed) this.refreshPeopleMarkers() }
      }
      if (!this.disposed && runId === this.walkRunId) this.setData({ presenceBusy: false })
    }
  },
  showEncounter(own, target) {
    const person = this.data.cosplayers.find(row => row.id === target.id) || target
    this.setData({ encounter: { duration: ENCOUNTER_DURATION, avatars: [encounterAvatar(own), encounterAvatar(person)] } })
    if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light' })
    this.encounterTimer = setTimeout(() => {
      if (this.disposed || !this.data.encounter) return
      this.setData({ encounter: null })
      if (this.data.feedMode === 'people' && this.data.viewMode === 'browse') {
        this.showPerson(this.data.cosplayers.find(row => row.id === person.id) || person)
      }
    }, ENCOUNTER_DURATION)
  },
  cancelEncounter() {
    this.encounterVersion = (this.encounterVersion || 0) + 1
    clearTimeout(this.encounterTimer)
    if (this.data.encounter && !this.disposed) this.setData({ encounter: null })
  },
  encounterTap() {},
  async animateOwnMarker(own, start, target, duration) {
    return this.animateOwnMarkerFallback(start, target, duration)
  },
  async animateOwnMarkerFallback(start, target, duration) {
    const steps = Math.max(2, Math.min(100, Math.ceil(duration / 50)))
    const delay = Math.max(16, Math.round(duration / steps))
    for (let step = 1; step <= steps; step += 1) {
      if (this.disposed || !this.isWalking) return false
      this.walkPose = Math.floor((step - 1) * delay / 150) % 2 ? AVATAR_POSE.walkB : AVATAR_POSE.walkA
      const t = step / steps
      const ratio = t * t * (3 - 2 * t)
      const position = { latitude: start.latitude + (target.latitude - start.latitude) * ratio, longitude: start.longitude + (target.longitude - start.longitude) * ratio }
      const cosplayers = this.data.cosplayers.map(person => person.isMine ? { ...person, ...position } : person)
      this.allCosplayers = (this.allCosplayers || []).map(person => person.isMine ? { ...person, ...position } : person)
      const patch = { cosplayers }
      if (this.data.feedMode === 'people' && this.data.mapVisible) patch.markers = this.peopleMarkers(cosplayers, this.data.selectedId)
      this.setData(patch)
      this.walkPosition = position
      if (step < steps) await new Promise(resolve => setTimeout(resolve, delay))
    }
    return true
  },
  selectPerson(event) {
    const person = this.data.cosplayers.find(row => row.id === event.currentTarget.dataset.id)
    if (!person) return
    if (person.isMine) { this.openOwnSettings(); return }
    this.showPerson(person)
  },
  openOwnSettings() { openProfileSettings() },
  showPerson(person) {
    this.finishSearch({ adjustMap: false }); this.drag = null; wx.hideKeyboard({})
    this.relayout(1, { viewMode: 'person', selectedId: person.id, selectedPerson: person, selectedItem: null, markers: this.peopleMarkers(this.data.cosplayers, person.id), latitude: person.latitude, longitude: person.longitude, scale: 16, presenceExpiryText: this.expiryText(person.expiresAt) })
    this.scheduleMapFit(person)
  },
  expiryText(timestamp) { const minutes = Math.max(1, Math.ceil((timestamp - Date.now()) / 60000)); return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时` : `${minutes} 分钟` },
  async friendAction() {
    const person = this.data.selectedPerson
    if (!person || this.data.friendBusy || person.friendStatus === 'accepted' || person.friendStatus === 'pending') return
    this.setData({ friendBusy: true })
    try { await api.ensureProfile(); const result = await api.request('friend.request', { userId: person.id }); const selectedPerson = { ...person, friendStatus: result.status }; this.setData({ selectedPerson, cosplayers: this.data.cosplayers.map(row => row.id === person.id ? selectedPerson : row) }); wx.showToast({ title: result.status === 'accepted' ? '你们已经是好友' : '好友申请已发送', icon: 'none' }) }
    catch (error) { api.toast(error) }
    finally { if (!this.disposed) this.setData({ friendBusy: false }) }
  },
  async stopPresence() {
    if (this.data.presenceBusy) return
    this.setData({ presenceBusy: true })
    try { await api.request('presence.off'); this.stopFuzzyFollow(); this.walkPosition = null; this.setData({ ownPresence: null, selectedPerson: null, viewMode: 'browse' }); await this.loadPeople(); wx.showToast({ title: '已从地图隐去', icon: 'success' }) }
    catch (error) { api.toast(error) }
    finally { if (!this.disposed) this.setData({ presenceBusy: false }) }
  },
  openShout() { this.setData({ shoutOpen: true }); if (!this.data.ownPresence) wx.showToast({ title: '先开启地图出现，附近同好才能看到你', icon: 'none' }) },
  closeShout() { this.setData({ shoutOpen: false }) },
  shoutInput(event) { this.setData({ shoutText: event.detail.value }) },
  quickShout(event) { const text = event.currentTarget.dataset.text; this.setData({ shoutText: text }); this.publishShout(text) },
  async publishShout(value) {
    if (this.data.shoutBusy) return
    const text = (typeof value === 'string' ? value : this.data.shoutText).trim()
    if (!text) { wx.showToast({ title: '先写一句想说的话', icon: 'none' }); return }
    if (!this.data.ownPresence) { this.openPresenceSettings(); return }
    this.setData({ shoutBusy: true })
    try { await api.request('presence.set', { ...this.data.ownPresence, shout: text }); this.setData({ shoutOpen: false, shoutText: '' }); await this.loadOwnPresence(); wx.showToast({ title: '附近喊话已更新', icon: 'success' }) }
    catch (error) { api.toast(error) }
    finally { if (!this.disposed) this.setData({ shoutBusy: false }) }
  },
  openPresenceSettings() { navigate('profile', { presence: true }) },
  selectPoint(id) {
    const item = this.data.items.find(value => value.id === id)
    if (!item) return
    if (this.data.viewMode === 'detail' && this.data.selectedId === id) return
    this.finishSearch({ adjustMap: false })
    this.drag = null
    wx.hideKeyboard({})
    this.relayout(1, { viewMode: 'detail', latitude: item.latitude, longitude: item.longitude, scale: 16, selectedId: item.id, selectedItem: item, selectedPerson: null, markers: markersFor(this.data.items, item.id) })
    this.scheduleMapFit(item)
    if (!api.config.demoMode) {
      api.request('content.get', { id }).then(value => { if (!this.disposed && this.data.selectedId === id) this.detailChanged({ detail: api.decorate(value) }) }).catch(error => { if (!this.disposed && this.data.selectedId === id) { this.returnToBrowse(); api.toast(error) } })
    }
  },
  returnToBrowse() {
    if (this.data.viewMode === 'person') { const person = this.data.selectedPerson; this.relayout(this.panelStop === undefined ? 0 : this.panelStop, { viewMode: 'browse' }); this.setData({ selectedPerson: null, selectedId: 0, markers: this.peopleMarkers(this.data.cosplayers, 0) }); return }
    const item = this.data.selectedItem
    if (!item || this.data.viewMode !== 'detail') return
    clearTimeout(this.mapFitTimer)
    this.relayout(1, { viewMode: 'browse' })
    this.resetScroll(`point-${item.id}`)
  },
  scheduleMapFit(item) {
    clearTimeout(this.mapFitTimer)
    const visibleItems = this.data.feedMode === 'people' ? this.data.cosplayers : this.data.items
    if (!this.map || this.data.searchFocused || !visibleItems.length) return
    this.mapFitTimer = setTimeout(() => {
      if (this.disposed || !this.map || this.data.dragging) return
      const points = item ? [
        { latitude: item.latitude - 0.002, longitude: item.longitude - 0.002 },
        { latitude: item.latitude + 0.002, longitude: item.longitude + 0.002 }
      ] : visibleItems.map(point => ({ latitude: point.latitude, longitude: point.longitude }))
      this.map.includePoints({ points, padding: [this.data.topInset + 20, 32, this.data.panelBottom + this.data.panelHeight + 24, 32] })
    }, 260)
  },
  locate() {
    if (this.data.locating) return
    this.setData({ locating: true })
    if (api.config.demoMode) {
      const demoLocation = { latitude: 30.6532, longitude: 104.0641 }
      clearTimeout(this.mapFitTimer)
      this.queryCenter = demoLocation
      this.relayout(this.panelStop, {
        viewMode: 'browse', selectedItem: null, selectedPerson: null, selectedId: 0,
        latitude: demoLocation.latitude, longitude: demoLocation.longitude, scale: 15,
        markers: this.data.feedMode === 'people' ? this.peopleMarkers(this.data.cosplayers, 0) : markersFor(this.data.items, 0)
      })
      if (this.data.feedMode === 'people') this.loadPeople(); else this.fetchFeed()
      this.setData({ locating: false, locationGranted: true })
      wx.showToast({ title: '演示地图已定位到成都春熙路', icon: 'none' })
      return
    }
    wx.getLocation({
      type: 'gcj02',
      success: location => {
        if (this.disposed) return
        clearTimeout(this.mapFitTimer)
        this.relayout(this.panelStop, { viewMode: 'browse', selectedItem: null, selectedPerson: null, selectedId: 0, markers: this.data.feedMode === 'people' ? this.peopleMarkers(this.data.cosplayers, 0) : markersFor(this.data.items, 0) })
        this.setData({ latitude: location.latitude, longitude: location.longitude, scale: 16, locationGranted: true })
        this.queryCenter = { latitude: location.latitude, longitude: location.longitude }
        if (this.data.feedMode === 'people') this.loadPeople(); else this.fetchFeed()
      },
      fail: error => {
        if (this.disposed) return
        if (api.config.demoMode) {
          const demoLocation = { latitude: 30.6532, longitude: 104.0641 }
          this.relayout(this.panelStop, { viewMode: 'browse', selectedItem: null, selectedPerson: null, selectedId: 0, markers: this.data.feedMode === 'people' ? this.peopleMarkers(this.data.cosplayers, 0) : markersFor(this.data.items, 0) })
          this.setData({ latitude: demoLocation.latitude, longitude: demoLocation.longitude, scale: 16, locationGranted: true })
          this.queryCenter = demoLocation
          wx.showToast({ title: '演示模式：已定位到春熙路', icon: 'none' })
          return
        }
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
  retryMap() { this.setData({ mapError: false, mapVisible: false }, () => { if (!this.disposed) this.setData({ mapVisible: true }, () => { this.map = wx.createMapContext('main-map', this); this.scheduleMapFit(this.data.selectedItem) }) }) },
  assignMarkers(items) {
    this.markerIds = this.markerIds || new Map()
    this.nextMarker = this.nextMarker || 1
    return items.map(item => { if (!this.markerIds.has(item.id)) this.markerIds.set(item.id, this.nextMarker++); return { ...api.decorate(item), markerId: this.markerIds.get(item.id) } })
  },
  async fetchFeed(append = false) {
    if (append && (this.data.loading || !this.data.cursor)) return
    const version = this.feedVersion = (this.feedVersion || 0) + 1
    this.setData({ loading: true, dataError: '' })
    try {
      const result = await api.request('feed', { kind: 'post', query: this.data.query, category: this.data.activeCategory, center: this.queryCenter || { latitude: this.data.latitude, longitude: this.data.longitude }, cursor: append ? this.data.cursor : undefined })
      if (this.disposed || version !== this.feedVersion) return
      const combined = append ? this.data.items.concat(result.items) : result.items
      const items = this.assignMarkers([...new Map(combined.map(row => [row.id, row])).values()])
      this.posts = items
      const selectedItem = items.find(row => row.id === this.data.selectedId) || null
      if (this.data.feedMode !== 'posts') { this.setData({ items, cursor: result.cursor }); return }
      this.setData({ items, cursor: result.cursor, selectedItem, selectedId: selectedItem?.id || 0, viewMode: selectedItem ? this.data.viewMode : 'browse', markers: markersFor(items, selectedItem?.id || 0), areaDirty: false })
      if (!append) { this.resetScroll(); this.scheduleMapFit() }
    } catch (error) { if (!this.disposed && version === this.feedVersion) this.setData({ dataError: error.message }) }
    finally { if (!this.disposed && version === this.feedVersion) this.setData({ loading: false }) }
  },
  reload() { if (this.data.feedMode === 'people') this.loadPeople(); else this.fetchFeed() },
  loadMore() { if (this.data.feedMode === 'posts') this.fetchFeed(true) },
  regionChanged(event) {
    if (api.config.demoMode || (event.type !== 'end' && event.detail?.type !== 'end') || (event.causedBy !== 'gesture' && event.detail?.causedBy !== 'gesture')) return
    this.map?.getCenterLocation({ success: center => { this.queryCenter = { latitude: center.latitude, longitude: center.longitude }; if (!this.disposed) this.setData({ areaDirty: true }) } })
  },
  detailChanged(event) {
    const value = event.detail
    const items = this.data.items.map(row => row.id === value.id ? { ...row, ...value, markerId: row.markerId } : row)
    const selectedItem = items.find(row => row.id === this.data.selectedId)
    this.setData({ items, selectedItem, markers: markersFor(items, this.data.selectedId) })
  },
  detailRemoved() {
    const items = this.data.items.filter(row => row.id !== this.data.selectedId)
    this.relayout(1, { items, viewMode: 'browse', selectedItem: null, selectedId: 0, markers: markersFor(items, 0) })
  },
  async openShared(id) {
    const version = this.feedVersion = (this.feedVersion || 0) + 1
    this.setData({ loading: true, dataError: '' })
    try {
      const item = await api.request('content.get', { id })
      if (this.disposed || version !== this.feedVersion) return
      const items = this.assignMarkers([item])
      this.setData({ feedMode: 'posts', items, loading: false, dataError: '', markers: markersFor(items, 0) })
      this.selectPoint(item.id)
    } catch (error) { if (!this.disposed && version === this.feedVersion) this.setData({ dataError: error.message, loading: false }) }
  },
  onShareAppMessage() { return { title: this.data.selectedItem?.title || '看看附近的新鲜事', path: this.data.selectedItem ? `/pages/index/index?post=${encodeURIComponent(this.data.selectedId)}` : '/pages/index/index' } }
})
