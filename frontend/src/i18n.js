// p3portal.org
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './locales/de'
import en from './locales/en'

const storedLang = localStorage.getItem('p3-lang')

i18n
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: en },
    },
    lng: storedLang ?? 'de',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })

// No user preference stored → load global default from backend
if (!storedLang) {
  fetch('/api/i18n/default')
    .then((r) => r.json())
    .then((d) => {
      if (d.lang_code && d.lang_code !== i18n.language) {
        i18n.changeLanguage(d.lang_code)
      }
    })
    .catch(() => {})
}

export default i18n
