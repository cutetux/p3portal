// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// p3portal.org

// PROJ-69: E2E-Tests für Core-only Docker Build
// Da PROJ-69 ein Build-Feature ist (kein Browser-UI), testen diese Specs
// die statischen Artefakte: Dockerfile-Struktur, Stub-Datei, Verify-Script, README.
// Docker-Laufzeit-Tests (AC-1/2/4/5/9-12) erfordern eine Docker-Umgebung
// und werden manuell oder in CI ausgeführt.

import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../..')

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8')
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath))
}

// ── AC-3: Default-ARG im Dockerfile ─────────────────────────────────────────
test('AC-3: Dockerfile enthält ARG EDITION=plus als Default in Stage 1', () => {
  const dockerfile = readFile('Dockerfile')
  // Stage 1 (vor dem ersten FROM python:)
  const stage1 = dockerfile.split('FROM python:3.12-slim')[0]
  expect(stage1).toContain('ARG EDITION=plus')
})

test('AC-3: Dockerfile enthält ARG EDITION=plus als Default in Stage 2', () => {
  const dockerfile = readFile('Dockerfile')
  // Stage 2 (nach FROM python:)
  const stage2 = dockerfile.split('FROM python:3.12-slim')[1]
  expect(stage2).toContain('ARG EDITION=plus')
})

// ── AC-8: Core-Stub Datei ────────────────────────────────────────────────────
test('AC-8: frontend/src/plus/index.core.js existiert', () => {
  expect(fileExists('frontend/src/plus/index.core.js')).toBe(true)
})

test('AC-8: index.core.js exportiert PlusComponents als leeres Objekt', () => {
  const content = readFile('frontend/src/plus/index.core.js')
  expect(content).toContain('export const PlusComponents = {}')
})

test('AC-8: index.core.js hat AGPL-3.0-Lizenz-Header', () => {
  const content = readFile('frontend/src/plus/index.core.js')
  expect(content).toContain('SPDX-License-Identifier: AGPL-3.0-only')
})

// ── AC-7: plus_protocol.py als Core-Infrastruktur ───────────────────────────
test('AC-7: backend/core/plus_protocol.py existiert', () => {
  expect(fileExists('backend/core/plus_protocol.py')).toBe(true)
})

// ── AC-13: Verifikations-Script ──────────────────────────────────────────────
test('AC-13: tools/verify-core-build.sh existiert', () => {
  expect(fileExists('tools/verify-core-build.sh')).toBe(true)
})

test('AC-13: verify-core-build.sh ist ausführbar (executable bit)', () => {
  const stat = fs.statSync(path.join(ROOT, 'tools/verify-core-build.sh'))
  // Unix execute bit prüfen (0o111)
  expect(stat.mode & 0o111).not.toBe(0)
})

// ── AC-14/15: Script-Logik (Exit-Codes) ─────────────────────────────────────
test('AC-14: verify-core-build.sh inkrementiert errors-Counter bei Fehler', () => {
  const script = readFile('tools/verify-core-build.sh')
  expect(script).toContain('errors=$((errors + 1))')
})

test('AC-14: verify-core-build.sh beendet mit exit $FAIL (=1) bei Fehlern', () => {
  const script = readFile('tools/verify-core-build.sh')
  expect(script).toContain('FAIL=1')
  expect(script).toContain('exit $FAIL')
})

test('AC-15: verify-core-build.sh beendet mit exit $PASS (=0) bei Erfolg', () => {
  const script = readFile('tools/verify-core-build.sh')
  expect(script).toContain('PASS=0')
  expect(script).toContain('exit $PASS')
})

test('AC-15: verify-core-build.sh gibt Bestätigungsmeldung bei sauberem Build aus', () => {
  const script = readFile('tools/verify-core-build.sh')
  expect(script).toContain('SAUBER')
})

// ── AC-16: README ────────────────────────────────────────────────────────────
test('AC-16: README.md enthält Abschnitt "Core-only build"', () => {
  const readme = readFile('README.md')
  expect(readme).toContain('Core-only build')
})

test('AC-16: README.md enthält docker build --build-arg EDITION=core Befehl', () => {
  const readme = readFile('README.md')
  expect(readme).toContain('--build-arg EDITION=core')
  expect(readme).toContain('p3-portal:core')
})

test('AC-16: README.md enthält verify-core-build.sh Referenz', () => {
  const readme = readFile('README.md')
  expect(readme).toContain('verify-core-build.sh')
})

// ── AC-17: Dockerfile-Kommentar ─────────────────────────────────────────────
test('AC-17: Dockerfile enthält Kommentar zum EDITION-Build-Arg', () => {
  const dockerfile = readFile('Dockerfile')
  // Kommentar erklärt EDITION=core und EDITION=plus
  expect(dockerfile).toContain('EDITION=core')
  expect(dockerfile).toContain('EDITION=plus')
  // Erklärung des Verhaltens
  expect(dockerfile).toContain('AGPLv3')
})

// ── Dockerfile-Logik ─────────────────────────────────────────────────────────
test('Dockerfile Stage 1: Stub-Swap-RUN ist vor npm run build', () => {
  const dockerfile = readFile('Dockerfile')
  const stubSwapIdx = dockerfile.indexOf('cp src/plus/index.core.js')
  const buildIdx = dockerfile.indexOf('npm run build')
  expect(stubSwapIdx).not.toBe(-1)
  expect(buildIdx).not.toBe(-1)
  expect(stubSwapIdx).toBeLessThan(buildIdx)
})

test('Dockerfile Stage 2: rm -rf backend/plus/ ist nach COPY backend/', () => {
  const dockerfile = readFile('Dockerfile')
  const copyBackendIdx = dockerfile.indexOf('COPY backend/')
  const rmPlusIdx = dockerfile.indexOf('rm -rf /app/backend/plus/')
  expect(copyBackendIdx).not.toBe(-1)
  expect(rmPlusIdx).not.toBe(-1)
  expect(copyBackendIdx).toBeLessThan(rmPlusIdx)
})

test('Dockerfile Stage 2: plus.enc wird in beiden Builds kopiert', () => {
  const dockerfile = readFile('Dockerfile')
  expect(dockerfile).toContain('COPY plus.enc /app/plus.enc')
})
