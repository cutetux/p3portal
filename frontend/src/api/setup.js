// p3portal.org
import api from './client'

export async function getSetupStatus() {
  const { data } = await api.get('/api/setup/status')
  return data
}

export async function testSetupConnection(payload) {
  const { data } = await api.post('/api/setup/test-connection', payload)
  return data
}

export async function setupAdmin(payload) {
  const { data } = await api.post('/api/setup/admin', payload)
  return data
}

export async function setupNode(payload) {
  const { data } = await api.post('/api/setup/node', payload)
  return data
}

export async function setupTokens(payload) {
  const { data } = await api.post('/api/setup/tokens', payload)
  return data
}

export async function setupPortalSettings(payload) {
  const { data } = await api.post('/api/setup/portal-settings', payload)
  return data
}

export async function completeSetup() {
  const { data } = await api.post('/api/setup/complete')
  return data
}

export async function getHostIp() {
  const { data } = await api.get('/api/setup/host-ip')
  return data
}

export async function setupDatabase(payload) {
  const { data } = await api.post('/api/setup/database', payload)
  return data
}

export async function testDatabaseConnection(payload) {
  const { data } = await api.post('/api/setup/database/test', payload)
  return data
}

export async function testNodeConnection(payload) {
  const { data } = await api.post('/api/setup/test-node', payload)
  return data
}
