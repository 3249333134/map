const config = require('./config/cloud')
App({ globalData: { center: { latitude: 30.651, longitude: 104.065 }, feedDirty: false, presenceDirty: false }, onLaunch() { if (config.envId && wx.cloud) wx.cloud.init({ env: config.envId, traceUser: false }) } })
