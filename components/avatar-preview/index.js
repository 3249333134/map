Component({
  properties: {
    open: { type: Boolean, value: false },
    frames: { type: Array, value: [] },
    theme: { type: String, value: '' }
  },
  data: { current: 0, sceneName: '', top: 12, backgroundPath: '', imageError: false },
  observers: {
    open(value) {
      if (value) {
        this.setData({ current: 0, top: 12, imageError: false, backgroundPath: '' })
        wx.nextTick(() => this.prepare())
      } else { this.canvas = null; this.backgroundVersion = (this.backgroundVersion || 0) + 1 }
    }
  },
  lifetimes: { detached() { this.canvas = null } },
  methods: {
    close() { this.triggerEvent('close') },
    imageFailed() { this.setData({ imageError: true }) },
    change(event) { this.setData({ current: event.detail.current }) },
    prepare() {
      this.createSelectorQuery().select('#scenery').fields({ node: true, size: true }).exec(result => {
        if (!this.data.open || !result[0]?.node) return
        this.canvas = result[0].node
        // Draw at a small logical resolution so the landscape keeps crisp pixel edges.
        this.canvas.width = 240
        this.canvas.height = Math.round(240 * result[0].height / result[0].width)
        this.palette = [70, 140, 150]
        this.randomize()
        const canvas = this.canvas
        const image = canvas.createImage()
        image.onload = () => {
          if (!this.data.open || this.canvas !== canvas) return
          const context = canvas.getContext('2d')
          context.clearRect(0, 0, 32, 32)
          context.drawImage(image, 0, 0, 32, 32)
          const pixels = context.getImageData(0, 0, 32, 32).data
          const colors = new Map()
          for (let i = 0; i < pixels.length; i += 4) {
            const [r, g, b, alpha] = pixels.slice(i, i + 4)
            if (alpha < 128 || Math.max(r, g, b) - Math.min(r, g, b) < 24) continue
            const key = [r, g, b].map(value => Math.round(value / 32) * 32).join(',')
            colors.set(key, (colors.get(key) || 0) + 1)
          }
          const dominant = [...colors].sort((a, b) => b[1] - a[1])[0]
          if (dominant) this.palette = dominant[0].split(',').map(Number)
          this.randomize()
        }
        image.onerror = () => { if (this.canvas === canvas) this.randomize() }
        image.src = this.data.frames[0]
      })
    },
    randomize() {
      if (!this.canvas || !this.data.open) return
      const ctx = this.canvas.getContext('2d')
      const w = this.canvas.width
      const h = this.canvas.height
      const palette = this.palette
      const color = (brightness, saturation = 1) => {
        const average = palette.reduce((sum, value) => sum + value, 0) / 3
        return 'rgb(' + palette.map(value => Math.max(0, Math.min(255, Math.round((average + (value - average) * saturation) * brightness)))).join(',') + ')'
      }
      const scenes = this.data.theme === 'mecha' ? ['city'] : this.data.theme === 'adventure' ? ['sea', 'mountain'] : ['forest', 'mountain', 'sea']
      const scene = scenes[Math.floor(Math.random() * scenes.length)]
      this.setData({ sceneName: ({ city: '夜色都市', sea: '海风与远岛', mountain: '群山与流云', forest: '林间微光' })[scene] })
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = color(.36)
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = color(1.7, .25)
      const moonX = 28 + Math.random() * (w - 56)
      ctx.fillRect(moonX, h * .16, 22, 22)
      ctx.fillStyle = color(1.9, .3)
      for (let i = 0; i < 42; i++) ctx.fillRect(Math.random() * w, Math.random() * h * .46, 1, 1)
      for (let layer = 0; layer < 3; layer++) {
        const y = h * (.45 + layer * .1)
        ctx.fillStyle = color(.7 - layer * .15)
        if (scene === 'city') {
          for (let x = 0; x < w; x += 18) {
            const height = 20 + Math.random() * 70
            ctx.fillRect(x, y - height, 15, h)
            ctx.fillStyle = color(1.3)
            for (let windowY = y - height + 5; windowY < y; windowY += 10) ctx.fillRect(x + 5, windowY, 3, 3)
            ctx.fillStyle = color(.7 - layer * .15)
          }
        } else {
          ctx.beginPath()
          ctx.moveTo(0, h)
          for (let x = 0; x <= w + 20; x += 20) ctx.lineTo(x, y - Math.random() * 40)
          ctx.lineTo(w, h)
          ctx.fill()
        }
      }
      ctx.fillStyle = color(.27)
      ctx.fillRect(0, h * .74, w, h * .26)
      if (scene === 'sea') {
        ctx.fillStyle = color(.95)
        for (let i = 0; i < 35; i++) ctx.fillRect(Math.random() * w, h * .76 + Math.random() * h * .23, 4 + Math.random() * 15, 1)
      }
      if (scene === 'forest') {
        for (const x of [8, 24, w - 26, w - 10]) {
          ctx.fillStyle = color(.25)
          ctx.fillRect(x, h * .4, 4, h * .4)
          ctx.fillStyle = color(.6)
          ctx.beginPath()
          ctx.moveTo(x - 13, h * .62)
          ctx.lineTo(x + 2, h * .3)
          ctx.lineTo(x + 17, h * .62)
          ctx.fill()
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,.25)'
      ctx.beginPath()
      ctx.ellipse(w / 2, h * .75, 29, 5, 0, 0, Math.PI * 2)
      ctx.fill()
      // Display an ordinary image so the native canvas cannot cover the sprite or controls.
      const version = this.backgroundVersion = (this.backgroundVersion || 0) + 1
      wx.canvasToTempFilePath({
        canvas: this.canvas,
        fileType: 'png',
        success: result => {
          if (this.data.open && version === this.backgroundVersion) this.setData({ backgroundPath: result.tempFilePath })
        }
      }, this)
    }
  }
})
