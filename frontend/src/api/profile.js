// p3portal.org
import api from './client'

export async function getProfile() {
  const { data } = await api.get('/api/me')
  return data
}

export async function changePassword(currentPassword, newPassword) {
  const { data } = await api.patch('/api/me/password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
  return data
}

export async function getUserSshKey() {
  const { data } = await api.get('/api/me/ssh-key')
  return data
}

export async function setUserSshKey(key) {
  const { data } = await api.put('/api/me/ssh-key', { key })
  return data
}

export async function deleteUserSshKey() {
  await api.delete('/api/me/ssh-key')
}

export async function getUserSshKeys() {
  const { data } = await api.get('/api/me/ssh-keys')
  return data
}

export async function addUserSshKey(label, key) {
  const { data } = await api.post('/api/me/ssh-keys', { label, key })
  return data
}

export async function deleteUserSshKeyById(id) {
  await api.delete(`/api/me/ssh-keys/${id}`)
}

export async function getSshJobKeyStatus() {
  const { data } = await api.get('/api/me/ssh-job-key')
  return data
}

export async function setSshJobKey(privateKey) {
  await api.put('/api/me/ssh-job-key', { private_key: privateKey, risk_confirmed: true })
}

export async function deleteSshJobKey() {
  await api.delete('/api/me/ssh-job-key')
}

export async function generateSshJobKey() {
  const { data } = await api.post('/api/me/ssh-job-key/generate')
  return data
}

export async function getSessions() {
  const { data } = await api.get('/api/me/sessions')
  return data
}

export async function revokeSession(sessionId) {
  await api.delete(`/api/me/sessions/${sessionId}`)
}

export async function revokeAllOtherSessions() {
  await api.delete('/api/me/sessions')
}

// PROJ-36: Personal notification settings
export async function getNotificationSettings() {
  const { data } = await api.get('/api/me/notifications')
  return data
}

export async function setNotificationSettings(settings) {
  await api.put('/api/me/notifications', settings)
}
