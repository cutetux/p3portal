// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { getVmIp } from '../api/vms'

/**
 * Loads IPs for all running VMs in parallel, non-blocking.
 * Results are cached per mount (session-level) via the loaded ref.
 * Key format: "portal_node_name/node/vmid" (multi-node) or "node/vmid" (single-node).
 * Returns { "node/vmid": "1.2.3.4" | null }
 */
export function vmIpKey(vm) {
  return [vm.portal_node_name, vm.node, vm.vmid].filter(Boolean).join('/')
}

export default function useVmIps(vms) {
  const [ips, setIps] = useState({})
  const loaded = useRef(new Set())

  useEffect(() => {
    const running = vms.filter(vm => vm.status === 'running' && !vm.template)
    running.forEach(async (vm) => {
      const key = vmIpKey(vm)
      if (loaded.current.has(key)) return
      loaded.current.add(key)
      try {
        const type = vm.type === 'lxc' ? 'lxc' : 'qemu'
        const ip = await getVmIp(vm.node, vm.vmid, type)
        setIps(prev => ({ ...prev, [key]: ip.ip ?? null }))
      } catch {
        setIps(prev => ({ ...prev, [key]: null }))
      }
    })
  }, [vms])

  return ips
}
