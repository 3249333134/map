const STORAGE_KEY = 'map-movement-speed-v1'
const DEFAULT_SPEED = 3

function normalize(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : DEFAULT_SPEED
}

function readSpeed() {
  try { return normalize(wx.getStorageSync(STORAGE_KEY)) }
  catch (_) { return DEFAULT_SPEED }
}

function saveSpeed(value) {
  const speed = normalize(value)
  wx.setStorageSync(STORAGE_KEY, speed)
  return speed
}

function travelDuration(distance) {
  if (distance < 3) return 0
  const original = Math.max(900, Math.min(6500, distance / 1.4 * 1000))
  return Math.round(original / readSpeed())
}

module.exports = { DEFAULT_SPEED, readSpeed, saveSpeed, travelDuration }
