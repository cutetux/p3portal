// p3portal.org
import api from './client'

// ── Global Rules (Admin) ──────────────────────────────────────────────────────

export const listGlobalRules = () =>
  api.get('/api/alerts/rules').then(r => r.data)

export const createGlobalRule = (data) =>
  api.post('/api/alerts/rules', data).then(r => r.data)

export const updateGlobalRule = (ruleId, data) =>
  api.put(`/api/alerts/rules/${ruleId}`, data).then(r => r.data)

export const deleteGlobalRule = (ruleId) =>
  api.delete(`/api/alerts/rules/${ruleId}`)

// ── Alert Presets (Admin, Plus) ───────────────────────────────────────────────

export const listPresets = () =>
  api.get('/api/alerts/presets').then(r => r.data)

export const createPreset = (data) =>
  api.post('/api/alerts/presets', data).then(r => r.data)

export const updatePreset = (presetId, data) =>
  api.put(`/api/alerts/presets/${presetId}`, data).then(r => r.data)

export const deletePreset = (presetId) =>
  api.delete(`/api/alerts/presets/${presetId}`)

// ── Preset Assignments (Admin, Plus) ─────────────────────────────────────────

export const assignPreset = (presetId, vmid, nodeId) =>
  api.post(`/api/alerts/presets/${presetId}/assign`, { vmid, node_id: nodeId }).then(r => r.data)

export const removePresetAssignment = (presetId, vmid, nodeId) =>
  api.delete(`/api/alerts/presets/${presetId}/assign/${vmid}`, { params: { node_id: nodeId } })

// ── VM Alert Summary & Rules ──────────────────────────────────────────────────

export const getVmAlertSummary = (nodeId, vmid) =>
  api.get(`/api/alerts/vm/${nodeId}/${vmid}`).then(r => r.data)

export const createVmRule = (nodeId, vmid, data) =>
  api.post(`/api/alerts/vm/${nodeId}/${vmid}/rules`, data).then(r => r.data)

export const updateVmRule = (nodeId, vmid, ruleId, data) =>
  api.put(`/api/alerts/vm/${nodeId}/${vmid}/rules/${ruleId}`, data).then(r => r.data)

export const deleteVmRule = (nodeId, vmid, ruleId) =>
  api.delete(`/api/alerts/vm/${nodeId}/${vmid}/rules/${ruleId}`)

// ── Threshold Overrides (Plus) ────────────────────────────────────────────────

export const updateThresholdOverrides = (nodeId, vmid, overrides) =>
  api.put(`/api/alerts/vm/${nodeId}/${vmid}/overrides`, { overrides }).then(r => r.data)

// ── Alert States ──────────────────────────────────────────────────────────────

export const listAlertStates = () =>
  api.get('/api/alerts/states').then(r => r.data)

// ── Alert Events / History ────────────────────────────────────────────────────

export const listAlertEvents = (params = {}) =>
  api.get('/api/alerts/events', { params }).then(r => r.data)

export const acknowledgeAlert = (eventId) =>
  api.post(`/api/alerts/events/${eventId}/acknowledge`).then(r => r.data)

// ── Test Webhook (any authenticated user) ─────────────────────────────────────

export const testWebhook = (webhookUrl, webhookToken, receiverType = 'custom', ruleId = null) =>
  api.post('/api/alerts/test-webhook', {
    webhook_url: webhookUrl,
    webhook_token: webhookToken || null,
    webhook_receiver_type: receiverType,
    rule_id: ruleId || null,
  }).then(r => r.data)

// ── SMTP Config (Admin, Plus) ─────────────────────────────────────────────────

export const getSmtpConfig = () =>
  api.get('/api/admin/alerts/smtp').then(r => r.data)

export const updateSmtpConfig = (data) =>
  api.put('/api/admin/alerts/smtp', data).then(r => r.data)
