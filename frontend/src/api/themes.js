// p3portal.org
import api from './client'
import axios from 'axios'

export async function getThemes() {
  const { data } = await api.get('/api/themes')
  return data
}

export async function setGlobalDefaultTheme(themeId) {
  const { data } = await api.post('/api/themes/default', { theme_id: themeId })
  return data
}

export async function uploadTheme(file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/api/themes/upload', form)
  return data
}

export async function deleteTheme(themeId) {
  await api.delete(`/api/themes/${themeId}`)
}

export async function createTheme(name, variables) {
  const { data } = await api.post('/api/themes', { name, variables })
  return data
}

export async function updateTheme(themeId, name, variables) {
  const { data } = await api.put(`/api/themes/${themeId}`, { name, variables })
  return data
}

export async function getGlobalDefaultTheme() {
  const { data } = await axios.get('/api/themes/default')
  return data
}

export async function getPreferences() {
  const { data } = await api.get('/api/me/preferences')
  return data
}

export async function setPreferences({ theme_id, lang_code }) {
  const { data } = await api.patch('/api/me/preferences', { theme_id, lang_code })
  return data
}
