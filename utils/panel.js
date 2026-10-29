// 收起时仅容纳把手、搜索框和间距；展开档位保留地图视野。
const LAYOUT = { footer: 48, handle: 28, search: 44, gap: 12, reveal: 16, hide: 8 }
LAYOUT.compact = LAYOUT.handle + LAYOUT.search + LAYOUT.gap
function stops(height) {
  const expanded = Math.round(height * 0.55)
  return [Math.min(LAYOUT.compact, expanded), expanded]
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
function snap(height, velocity, targets, startHeight) {
  if (Math.abs(velocity) >= 0.45) {
    const ordered = velocity > 0 ? targets : targets.slice().reverse()
    const next = ordered.find(value => velocity > 0 ? value > height + 1 : value < height - 1)
    if (next !== undefined) return next
  }
  const nearest = targets.reduce((closest, value) => Math.abs(value - height) < Math.abs(closest - height) ? value : closest)
  // 慢速、短距离拖动也可切档，无需越过两个档位的中点。
  if (nearest === startHeight && Math.abs(height - startHeight) >= 24) {
    const ordered = height > startHeight ? targets : targets.slice().reverse()
    return ordered.find(value => height > startHeight ? value > startHeight : value < startHeight) || nearest
  }
  return nearest
}
function isCollapsed(height, minimum, previous, dragging) {
  if (!dragging) return height === minimum
  return previous ? height < minimum + LAYOUT.reveal : height <= minimum + LAYOUT.hide
}
module.exports = { stops, clamp, snap, isCollapsed, LAYOUT }
