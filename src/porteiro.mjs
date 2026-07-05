// porteiro.mjs — roda via launchd/systemd a cada 30s: aceita quem bateu na porta
// com um convite aberto. Autossuficiente: só fala REST com o syncthing local.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const STATE = process.env.DROPBOSS_PORTEIRO_STATE || join(os.homedir(), '.dropboss', 'porteiro.json')
const stamp = () => new Date().toISOString()

let state
try { state = JSON.parse(readFileSync(STATE, 'utf8')) } catch { process.exit(0) }

const now = Date.now()
let dirty = false
for (const [id, o] of Object.entries(state.open || {})) {
  if (o.until && o.until < now) { delete state.open[id]; dirty = true; console.log(stamp(), `convite de '${o.label || id}' expirou`) }
}
const hasUses = o => o.uses === undefined || o.uses > 0
function persist () { if (dirty) { writeFileSync(STATE, JSON.stringify(state, null, 2)); dirty = false } }
persist()
if (!state.gui || !Object.values(state.open || {}).some(hasUses)) process.exit(0)

async function api (method, path, body) {
  const res = await fetch(state.gui.base + path, {
    method,
    headers: { 'X-API-Key': state.gui.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function acceptPendingDevices () {
  const pending = await api('GET', '/rest/cluster/pending/devices') || {}
  let n = 0
  for (const [deviceID, info] of Object.entries(pending)) {
    const d = await api('GET', '/rest/config/defaults/device')
    await api('POST', '/rest/config/devices', { ...d, deviceID, name: info.name || `peer-${deviceID.slice(0, 7)}` })
    await api('DELETE', `/rest/cluster/pending/devices?device=${deviceID}`).catch(() => {})
    console.log(stamp(), `device aceito: ${info.name || ''} (${deviceID.slice(0, 7)}…)`)
    n++
  }
  return n
}

async function addToOpenFolders () {
  const pending = await api('GET', '/rest/cluster/pending/folders') || {}
  for (const [folderID, info] of Object.entries(pending)) {
    const inv = state.open[folderID]
    if (!inv) continue
    const folders = await api('GET', '/rest/config/folders')
    const folder = folders.find(f => f.id === folderID)
    if (!folder) continue
    let changed = false
    for (const deviceID of Object.keys(info.offeredBy || {})) {
      if (folder.devices.some(d => d.deviceID === deviceID)) continue // re-entrada não gasta uso
      if (!hasUses(inv)) break
      folder.devices.push({ deviceID })
      changed = true
      console.log(stamp(), `peer ${deviceID.slice(0, 7)}… entrou na pasta '${folder.label}'`)
      if (inv.uses !== undefined) {
        inv.uses--
        dirty = true
        if (inv.uses <= 0) {
          delete state.open[folderID]
          console.log(stamp(), `convite de '${folder.label}' esgotado — porta fechada`)
        }
      }
    }
    if (changed) await api('POST', '/rest/config/folders', folder)
  }
  persist()
}

try {
  const accepted = await acceptPendingDevices()
  await addToOpenFolders()
  if (accepted > 0) {
    // o pedido de pasta chega segundos depois do device conectar — segunda passada
    await new Promise(r => setTimeout(r, 15000))
    await addToOpenFolders()
  }
} catch (e) {
  console.log(stamp(), `erro: ${e.message}`)
}
