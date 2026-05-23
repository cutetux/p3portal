// p3portal.org
import api from './client'
import axios from 'axios'

export async function getLanguages() {
  const { data } = await api.get('/api/i18n/languages')
  return data
}

export async function getTranslation(langCode) {
  const { data } = await axios.get(`/api/i18n/${langCode}`)
  return data
}

export async function setGlobalDefaultLanguage(langCode) {
  const { data } = await api.post('/api/i18n/default', { lang_code: langCode })
  return data
}

export async function uploadLanguage(file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/api/i18n/upload', form)
  return data
}

export async function deleteLanguage(langCode) {
  await api.delete(`/api/i18n/${langCode}`)
}
