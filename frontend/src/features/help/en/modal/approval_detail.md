# Approval Details

When the approval workflow is enabled, certain actions require a second administrator to approve them before they execute.

## Approval states
- **Pending** – waiting for an approver
- **Approved** – approved and scheduled for execution
- **Rejected** – declined; the action will not run
- **Cancelled** – cancelled by the requester
- **Expired** – not approved within 48 hours

## Who can approve?
Approvers are configured per action type in **System Settings → Approval Workflow**. Users with `approve_jobs` permission can approve.

## Self-approval
Plus only: an admin may approve their own request if no other approver is configured.

## Secret masking
Sensitive parameters (passwords, SSH keys) are encrypted and only revealed when the job actually runs.

<!-- p3portal.org -->