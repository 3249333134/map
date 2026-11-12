const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const { createRepository } = require('./lib/repository')
const { runJobs } = require('./lib/jobs')
exports.main = async event => {
  if (cloud.getWXContext().OPENID || event?.Type !== 'Timer') throw new Error('FORBIDDEN_JOB')
  return runJobs(createRepository(cloud.database()), cloud)
}
