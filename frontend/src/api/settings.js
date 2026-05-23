// p3portal.org
import api from './client'

export async function getSshKey() {
  const { data } = await api.get('/api/settings/ssh-key')
  return data
}

export async function setSshKey(key) {
  const { data } = await api.put('/api/admin/settings/ssh-key', { key })
  return data
}

export async function deleteSshKey() {
  await api.delete('/api/admin/settings/ssh-key')
}

