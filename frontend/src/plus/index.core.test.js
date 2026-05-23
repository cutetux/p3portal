// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// p3portal.org

// PROJ-69: Unit-Tests für den Core-only Stub (index.core.js)
// Sicherstellt dass der Stub korrekt exportiert und alle PlusComponents-Lookups
// undefined zurückgeben, ohne den Build zu brechen.

import { describe, it, expect } from 'vitest'
import { PlusComponents } from './index.core'

describe('PlusComponents Core-Stub (PROJ-69)', () => {
  it('exportiert PlusComponents als leeres Objekt', () => {
    expect(PlusComponents).toBeDefined()
    expect(typeof PlusComponents).toBe('object')
    expect(PlusComponents).not.toBeNull()
  })

  it('hat keine registrierten Komponenten', () => {
    expect(Object.keys(PlusComponents)).toHaveLength(0)
  })

  it('ThemeEditor Lookup gibt undefined zurück (isPlus-Gate fängt das ab)', () => {
    expect(PlusComponents.ThemeEditor).toBeUndefined()
  })

  it('AlertPresetsTab Lookup gibt undefined zurück', () => {
    expect(PlusComponents.AlertPresetsTab).toBeUndefined()
  })

  it('ScheduledJobsTable Lookup gibt undefined zurück', () => {
    expect(PlusComponents.ScheduledJobsTable).toBeUndefined()
  })

  it('GitSyncSection Lookup gibt undefined zurück (PROJ-68)', () => {
    expect(PlusComponents.GitSyncSection).toBeUndefined()
  })

  it('ist safe für beliebige Property-Zugriffe ohne Exception', () => {
    // Alle Lookups müssen undefined liefern, nicht werfen
    expect(() => PlusComponents.NonExistentComponent).not.toThrow()
    expect(() => PlusComponents.AnotherMissingComponent).not.toThrow()
  })
})
