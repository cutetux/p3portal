// p3portal.org
// PROJ-108: Installierbare PWA – Browser-Ebene (head-Verlinkung + Manifest/Icons erreichbar).
// Hinweis: Der Prod-kritische Pfad (Backend-Serving vs. SPA-Catch-All + Content-Type) wird
// in backend/test_pwa_serving.py abgedeckt. Dieser E2E-Test prüft die Frontend-Einbindung
// gegen den Vite-Dev-Server (public/ am Root).
import { test, expect } from '@playwright/test'

test.describe('PROJ-108 – Installierbare PWA', () => {
  // AC-4: <head>-Verlinkung vorhanden
  test('AC-4: index.html verlinkt Manifest + theme-color + apple-touch-icon', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    )
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#ea580c',
    )
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/pwa-192.png',
    )
  })

  // AC-1 / AC-2: Manifest erreichbar + valides JSON mit Pflichtfeldern
  test('AC-1/2: Manifest ist erreichbar und enthält die Pflichtfelder', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest')
    expect(res.ok()).toBeTruthy()
    const m = await res.json()
    expect(m.name).toBe('P3 Portal')
    expect(m.short_name).toBe('P3')
    expect(m.start_url).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.theme_color).toBe('#ea580c')
    const sizes = m.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBeTruthy()
  })

  // AC-3: alle deklarierten Icons sind erreichbar und PNG
  test('AC-3: alle Manifest-Icons sind als PNG erreichbar', async ({ request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json()
    for (const icon of m.icons) {
      const res = await request.get(icon.src)
      expect(res.ok(), `${icon.src} erreichbar`).toBeTruthy()
      const buf = await res.body()
      // PNG-Signatur
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    }
  })
})
