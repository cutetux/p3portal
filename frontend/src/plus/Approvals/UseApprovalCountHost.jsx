// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-64: Render-Prop-Host für useApprovalCount – EC-10-konform.
// Core-Code (AppLayout, V2Sidebar) darf hooks.js nicht direkt importieren
// (ESLint no-restricted-imports). Stattdessen: Lazy-Komponente aus plus/,
// die den Hook aufruft und den Count via render()-Prop weitergibt.
import { useApprovalCount } from './hooks'

/**
 * @param {{ render: (count: number) => React.ReactNode }} props
 */
export default function UseApprovalCountHost({ render }) {
  const { data } = useApprovalCount()
  const count = data?.count ?? 0
  return render(count)
}
