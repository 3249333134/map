Component({
  properties: { src: String, fullBody: { type: Boolean, value: true } },
  data: { portrait: '' },
  observers: { 'src, fullBody'() { this.setData({ portrait: '' }); if (this.ready) this.crop() } },
  lifetimes: {
    ready() { this.ready = true; this.crop() },
    detached() { this.ready = false; this.version = (this.version || 0) + 1 }
  },
  methods: {
    crop() {
      const version = this.version = (this.version || 0) + 1
      const source = this.data.src
      if (!source || !this.data.fullBody || source.startsWith('/static/avatars/')) return
      this.createSelectorQuery().select('#crop').fields({ node: true }).exec(result => {
        const canvas = result[0]?.node
        if (!canvas || !this.ready || version !== this.version) return
        const image = canvas.createImage()
        image.onload = () => {
          if (!this.ready || version !== this.version) return
          try {
            canvas.width = image.width
            canvas.height = image.height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(image, 0, 0)
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
            let left = image.width, right = 0, top = image.height, bottom = 0
            for (let y = 0; y < image.height; y++) {
              for (let x = 0; x < image.width; x++) {
                if (data[(y * image.width + x) * 4 + 3] < 80) continue
                left = Math.min(left, x); right = Math.max(right, x)
                top = Math.min(top, y); bottom = Math.max(bottom, y)
              }
            }
            if (right <= left || bottom <= top) return
            // Locate the head from the opaque character, ignoring transparent frame padding.
            const headHeight = Math.ceil((bottom - top + 1) * .44)
            let headLeft = image.width, headRight = 0
            for (let y = top; y < top + headHeight; y++) {
              for (let x = left; x <= right; x++) {
                if (data[(y * image.width + x) * 4 + 3] < 80) continue
                headLeft = Math.min(headLeft, x); headRight = Math.max(headRight, x)
              }
            }
            const side = Math.max(headHeight, headRight - headLeft + 1) * 1.12
            const sx = (headLeft + headRight) / 2 - side / 2
            const sy = top - side * .05
            canvas.width = 128
            canvas.height = 128
            const output = canvas.getContext('2d')
            output.imageSmoothingEnabled = false
            output.drawImage(image, sx, sy, side, side, 0, 0, 128, 128)
            wx.canvasToTempFilePath({
              canvas, fileType: 'png',
              success: response => {
                if (this.ready && version === this.version) this.setData({ portrait: response.tempFilePath })
              }
            }, this)
          } catch (_) {
            // Keep the source visible if a legacy image cannot be sampled.
          }
        }
        image.src = source
      })
    }
  }
})
