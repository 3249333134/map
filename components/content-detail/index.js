const api = require('../../utils/api')
Component({
  properties: { item: Object },
  data: { comments: [], cursor: null, busy: false, comment: '', commentError: '', commentsLoading: false },
  observers: { 'item.id,item.status': function(id) { if (id) { this.commentRequest = null; this.setData({ comments: [], cursor: null, comment: '', commentError: '' }); if (!api.config.demoMode && this.data.item.status === 'published') this.loadComments() } } },
  lifetimes: { detached() { this.disposed = true } },
  methods: {
    input(event) { this.commentRequest = null; this.setData({ comment: event.detail.value }) },
    preview(event) { wx.previewImage({ current: event.currentTarget.dataset.url, urls: this.data.item.images }) },
    republish() { const item = this.data.item; wx.setStorageSync('map-social-text-draft-v1', { kind: item.kind, title: item.title, text: item.text, category: item.category, location: { latitude: item.latitude, longitude: item.longitude, place: item.place }, requestId: api.requestId() }); wx.navigateTo({ url: '/pages/publish/index' }) },
    async loadComments(event) {
      const more = event?.currentTarget?.dataset?.more
      const id = this.data.item.id
      this.setData({ commentsLoading: true, commentError: '' })
      try {
        const response = await api.request('comments.list', { id, cursor: more ? this.data.cursor : undefined })
        if (!this.disposed && this.data.item.id === id) this.setData({ comments: more ? this.data.comments.concat(response.items) : response.items, cursor: response.cursor })
      } catch (error) { if (!this.disposed && this.data.item.id === id) this.setData({ commentError: error.message }) }
      finally { if (!this.disposed && this.data.item.id === id) this.setData({ commentsLoading: false }) }
    },
    async action(event) {
      if (this.data.busy) return
      const action = event.currentTarget.dataset.action
      const item = this.data.item
      this.setData({ busy: true })
      try {
        await api.ensureProfile()
        if (this.disposed || this.data.item.id !== item.id) return
        if (action === 'comment.create' && !this.data.comment.trim()) throw new Error('请输入评论')
        if (['content.remove', 'activity.cancel', 'report.create'].includes(action)) {
          const response = await wx.showModal({ title: action === 'report.create' ? '举报内容' : '确认操作', content: action === 'content.remove' ? '删除后其他用户将无法查看此动态。' : action === 'activity.cancel' ? '取消后将通知报名者，活动不能再报名。' : '确认举报此内容？管理员会核查处理。' })
          if (!response.confirm) return
        }
        this.commentRequest = this.commentRequest || api.requestId()
        await api.request(action, { id: item.id, active: action === 'like.set' ? !item.liked : action === 'favorite.set' ? !item.saved : !item.joined, text: this.data.comment, requestId: this.commentRequest, reason: '用户举报：疑似不当或虚假内容' })
        if (this.disposed || this.data.item.id !== item.id) return
        if (action === 'comment.create') { this.setData({ comment: '' }); this.commentRequest = null; this.loadComments() }
        if (action === 'content.remove') this.triggerEvent('removed')
        else { const updated = api.decorate(await api.request('content.get', { id: item.id })); this.triggerEvent('changed', updated) }
        if (action === 'report.create') wx.showToast({ title: '已提交举报', icon: 'success' })
      } catch (error) { api.toast(error) }
      finally { if (!this.disposed) this.setData({ busy: false }) }
    }
  }
})
