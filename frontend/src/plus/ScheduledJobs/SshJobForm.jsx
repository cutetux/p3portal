// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
const inputCls = 'w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder-gray-400 dark:placeholder-zinc-500'

export default function SshJobForm({ config, onChange }) {

  const set = (key, val) => onChange({ ...config, [key]: val })

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
          Ziel <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={config.user_host ?? ''}
          onChange={e => set('user_host', e.target.value)}
          placeholder="root@192.168.1.100"
          className={inputCls}
        />
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">Format: user@host oder user@IP</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
          Befehl <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={config.command ?? ''}
          onChange={e => set('command', e.target.value)}
          placeholder="apt list --upgradable"
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
          SSH-Key-Quelle <span className="text-red-500">*</span>
        </label>
        <select
          value={config.ssh_key_source ?? 'system'}
          onChange={e => set('ssh_key_source', e.target.value)}
          className={inputCls}
        >
          <option value="system">System-Key (Portal-Admin-Einstellung)</option>
          <option value="profile">Mein Profil-Key</option>
        </select>
        {config.ssh_key_source === 'profile' && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Dein Profil-SSH-Key wird für diesen Job verwendet. Stelle sicher, dass du einen hinterlegt hast.
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
          Timeout (Sekunden)
        </label>
        <input
          type="number"
          min={5}
          max={300}
          value={config.timeout ?? 30}
          onChange={e => set('timeout', Number(e.target.value))}
          className={inputCls}
        />
      </div>
    </div>
  )
}
