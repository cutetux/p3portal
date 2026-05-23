// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
/**
 * NodeDeleteButton – Plus-only Lösch-Aktion mit themed Confirm-Modal
 * pro Node-Zeile in der Admin-NodeTable.
 *
 * Wird über die Plus-Registry (frontend/src/plus/index.js) lazy geladen
 * und nur eingebunden, wenn der Konsument (NodeTable) den Plus-Status
 * bestätigt UND der Node nicht der Default-Node ist (Default-Nodes sind
 * grundsätzlich nicht löschbar). Core-Nutzer ziehen diesen Lazy-Chunk
 * nie nach.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteNode } from '../../api/nodes'
import ConfirmModal from '../../components/common/ConfirmModal'

export default function NodeDeleteButton({ node, onRefresh, onError }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteNode(node.id)
      await onRefresh?.()
    } catch (ex) {
      onError?.(ex.response?.data?.detail ?? t('admin.nodes.err_delete'))
      throw ex
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        className="btn-table-danger"
      >
        {busy ? '…' : t('admin.nodes.delete')}
      </button>

      {confirmOpen && (
        <ConfirmModal
          title={t('admin.nodes.delete')}
          body={t('admin.nodes.confirm_delete', { name: node.name }) || `Node „${node.name}" wirklich löschen?`}
          confirmLabel={t('admin.nodes.delete')}
          cancelLabel={t('admin.nodes.cancel')}
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  )
}
