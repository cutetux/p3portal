// p3portal.org
import { Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import V2Sidebar from './V2Sidebar'
import MobileHeader from './MobileHeader'
import ClusterStatusBar from './ClusterStatusBar'
import ProxmoxSessionBanner from './ProxmoxSessionBanner'
import { useCapability } from '../../hooks/useCapability'
import { PlusComponents } from '../../plus'
// PROJ-57: Help-SlideOver (globaler Singleton für alle Seiten)
import HelpSlideOver from '../../features/help/components/HelpSlideOver'
// PROJ-66: Tooling-SlideOver (globaler Singleton)
import { ToolingSlideOverProvider } from '../../features/tooling/context'
import ToolingSlideOver from '../../features/tooling/components/ToolingSlideOver'

// PROJ-64: EC-10 – kein direkter Import aus plus/Approvals/hooks (ESLint)
const UseApprovalCountHost = PlusComponents.UseApprovalCountHost

export default function AppLayout({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  // PROJ-64: Approval-Workflow-Status aus Capabilities (BUG-64-1 Fix)
  const approvalWorkflowEnabled = useCapability('approval_workflow_enabled')

  return (
    <ToolingSlideOverProvider>
    <div className="flex h-screen bg-portal-bg">
      {/* Desktop sidebar – hidden on mobile */}
      <div className="hidden md:flex">
        <V2Sidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <V2Sidebar onNavClick={() => setDrawerOpen(false)} />
          </div>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <MobileHeader onOpenDrawer={() => setDrawerOpen(true)} />
        <ClusterStatusBar />
        <ProxmoxSessionBanner />
        {/* PROJ-50/64: Approval-Banner – EC-10 Render-Prop via UseApprovalCountHost */}
        {approvalWorkflowEnabled && (
          <Suspense fallback={null}>
            <UseApprovalCountHost render={(count) => count > 0 ? (
              <Link
                to="/approvals"
                className="flex items-center gap-2 px-4 py-2 text-sm bg-portal-warn/10 border-b border-portal-warn/30 text-portal-warn hover:bg-portal-warn/20 transition-colors shrink-0"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span>
                  {count === 1
                    ? '1 Antrag wartet auf deine Freigabe'
                    : `${count} Anträge warten auf deine Freigabe`}
                </span>
              </Link>
            ) : null} />
          </Suspense>
        )}
        <div className="flex-1 flex flex-col min-h-0 bg-content-gradient">
          {children}
        </div>
      </div>
      {/* PROJ-57: Help-SlideOver – globaler Singleton, z-[60] über Modals */}
      <HelpSlideOver />
      {/* PROJ-66: Tooling-SlideOver – globaler Singleton, z-[60] über Modals */}
      <ToolingSlideOver />
    </div>
    </ToolingSlideOverProvider>
  )
}
