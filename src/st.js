// st.js — conversa com o daemon do syncthing (REST) e garante que ele exista/rode.
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import os from 'node:os'

const env = process.env

export function log (msg) { console.log(`\x1b[1;36m[dropboss]\x1b[0m ${msg}`) }
export function warn (msg) { console.log(`\x1b[1;33m[dropboss]\x1b[0m ${msg}`) }
export function die (msg) { console.error(`\x1b[1;31m[dropboss]\x1b[0m ${msg}`); process.exit(1) }
export const sleep = ms => new Promise(r => setTimeout(r, ms))

export function hasSyncthing () {
  return spawnSync('syncthing', ['--version'], { stdio: 'ignore' }).status === 0
}

// v2: `syncthing paths`; v1: `syncthing --paths`. Saída pode ir pra stdout ou stderr.
export function configDir () {
  if (env.DROPBOSS_SYNCTHING_HOME) return env.DROPBOSS_SYNCTHING_HOME
  let r = spawnSync('syncthing', ['paths'], { encoding: 'utf8' })
  if (r.status !== 0) r = spawnSync('syncthing', ['--paths'], { encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const m = out.match(/Configuration file:\s*\n?\s*(\S.*config\.xml)/)
  if (!m) die('não consegui descobrir o config do syncthing (`syncthing --paths` falhou)')
  return dirname(m[1].trim())
}

let _gui = null
export function gui () {
  if (_gui) return _gui
  const file = join(configDir(), 'config.xml')
  if (!existsSync(file)) die(`config do syncthing não existe ainda (${file})`)
  const cfg = readFileSync(file, 'utf8')
  const addr = cfg.match(/<gui[^>]*>[\s\S]*?<address>([^<]+)<\/address>/)?.[1] ?? '127.0.0.1:8384'
  const key = cfg.match(/<apikey>([^<]+)<\/apikey>/)?.[1]
  if (!key) die('apikey não encontrada no config.xml do syncthing')
  _gui = { base: `http://${addr}`, key }
  return _gui
}

export async function rest (method, path, body) {
  const { base, key } = gui()
  const res = await fetch(base + path, {
    method,
    headers: { 'X-API-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function up () {
  try { await rest('GET', '/rest/system/ping'); return true } catch { return false }
}

export async function ensureDaemon () {
  if (env.DROPBOSS_SYNCTHING_HOME) {
    if (!(await up())) die('o syncthing do home de teste (DROPBOSS_SYNCTHING_HOME) não está rodando')
    return
  }
  if (!hasSyncthing()) {
    if (process.platform === 'darwin' && spawnSync('brew', ['--version'], { stdio: 'ignore' }).status === 0) {
      log('instalando syncthing via brew…')
      execFileSync('brew', ['install', '-q', 'syncthing'], { stdio: 'inherit' })
    } else if (process.platform === 'linux') {
      die('instale o syncthing primeiro: sudo apt-get install -y syncthing (ou o pacote da sua distro)')
    } else {
      die('não achei o syncthing e não sei instalar nesta plataforma — instala manual e roda de novo')
    }
  }
  // identidade: sem cert.pem o daemon do brew morre em silêncio
  const cfgDir = configDir()
  if (!existsSync(join(cfgDir, 'cert.pem'))) {
    log('gerando identidade do syncthing…')
    spawnSync('syncthing', ['generate'], { stdio: 'ignore' })
  }
  if (await up()) return
  log('subindo o daemon do syncthing…')
  if (process.platform === 'darwin') {
    const prefix = execFileSync('brew', ['--prefix'], { encoding: 'utf8' }).trim()
    mkdirSync(join(prefix, 'var/log'), { recursive: true }) // plist do brew loga aqui e o dir pode não existir
    spawnSync('brew', ['services', 'start', 'syncthing'], { stdio: 'ignore' })
    spawnSync('launchctl', ['kickstart', `gui/${os.userInfo().uid}/homebrew.mxcl.syncthing`], { stdio: 'ignore' })
  } else {
    const r = spawnSync('systemctl', ['enable', '--now', `syncthing@${os.userInfo().username}`], { stdio: 'ignore' })
    if (r.status !== 0) die(`não consegui subir o daemon — roda: sudo systemctl enable --now syncthing@${os.userInfo().username}`)
  }
  for (let i = 0; i < 30; i++) {
    if (await up()) return
    await sleep(1000)
  }
  die('daemon do syncthing não respondeu em 30s — vê os logs (brew: $(brew --prefix)/var/log/syncthing.log)')
}

export async function myId () { return (await rest('GET', '/rest/system/status')).myID }
export async function getFolders () { return rest('GET', '/rest/config/folders') }
export async function getDevices () { return rest('GET', '/rest/config/devices') }
export async function connections () { return (await rest('GET', '/rest/system/connections')).connections }
export async function pendingDevices () { return rest('GET', '/rest/cluster/pending/devices') }

export async function addDevice (deviceID, name, extra = {}) {
  const d = await rest('GET', '/rest/config/defaults/device')
  await rest('POST', '/rest/config/devices', { ...d, deviceID, name, ...extra })
}

export const VERSIONING = {
  type: 'staggered',
  params: { cleanInterval: '3600', maxAge: '2592000' }, // 30 dias
  cleanupIntervalS: 3600,
  fsPath: '',
  fsType: 'basic'
}

export async function addFolder (spec) {
  const d = await rest('GET', '/rest/config/defaults/folder')
  await rest('POST', '/rest/config/folders', { ...d, versioning: VERSIONING, ...spec })
}

export async function saveFolder (folder) {
  await rest('POST', '/rest/config/folders', folder)
}

export function expandPath (p) {
  return p.startsWith('~') ? join(os.homedir(), p.slice(1)) : p
}

export async function findFolderByPath (absPath) {
  const folders = await getFolders()
  return folders.find(f => {
    const fp = expandPath(f.path).replace(/\/+$/, '')
    return fp === absPath || absPath.startsWith(fp + '/')
  })
}
