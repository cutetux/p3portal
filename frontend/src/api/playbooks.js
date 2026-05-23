// p3portal.org
import api from './client'

export async function getPlaybooks() {
  const { data } = await api.get('/api/playbooks')
  return data
}

export async function getPlaybook(name) {
  const { data } = await api.get(`/api/playbooks/${name}`)
  return data
}

export async function getPlaybookDescription(playbookId) {
  const { data } = await api.get(`/api/playbooks/${playbookId}/description`)
  return data
}

export async function uploadPlaybook(zipFile) {
  const form = new FormData()
  form.append('zip_file', zipFile)
  const { data } = await api.post('/api/playbooks/upload', form)
  return data
}

export async function deletePlaybook(id) {
  await api.delete(`/api/playbooks/${id}`)
}
