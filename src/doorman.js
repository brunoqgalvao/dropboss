// doorman.js — instala/remove o porteiro (job de background que aceita convites).
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import * as st from './st.js'

const DIR = join(os.homedir(), '.dropboss')
const STATE = join(DIR, 'porteiro.json')
const SCRIPT = join(DIR, 'porteiro.mjs')
const PLIST = join(os.homedir(), 'Library/LaunchAgents/com.dropboss.porteiro.plist')
const SYSD = join(os.homedir(), '.config/systemd/user')

function loadState () {
  try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return { gui: null, open: {} } }
}
function saveState (s) {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(STATE, JSON.stringify(s, null, 2))
  chmodSync(STATE, 0o600) // contém a apikey do syncthing
}

export function openInvite (folderId, label, { ttlDays = 7, uses = 1 } = {}) {
  const s = loadState()
  s.gui = st.gui()
  // uses undefined = ilimitado dentro do prazo
  s.open[folderId] = { label, until: Date.now() + ttlDays * 864e5, ...(uses === undefined ? {} : { uses }) }
  saveState(s)
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'porteiro.mjs'), SCRIPT)
  return installAgent()
}

export function closeInvite (folderId) {
  const s = loadState()
  delete s.open[folderId]
  saveState(s)
  if (!Object.keys(s.open).length) uninstallAgent()
}

export function openInvites () { return loadState().open || {} }

function installAgent () {
  if (process.platform === 'darwin') {
    mkdirSync(dirname(PLIST), { recursive: true })
    writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.dropboss.porteiro</string>
  <key>ProgramArguments</key><array>
    <string>${process.execPath}</string>
    <string>${SCRIPT}</string>
  </array>
  <key>StartInterval</key><integer>30</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${join(DIR, 'porteiro.log')}</string>
  <key>StandardErrorPath</key><string>${join(DIR, 'porteiro.log')}</string>
</dict></plist>
`)
    const uid = os.userInfo().uid
    spawnSync('launchctl', ['bootout', `gui/${uid}`, PLIST], { stdio: 'ignore' })
    let r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST], { stdio: 'ignore' })
    if (r.status !== 0) r = spawnSync('launchctl', ['load', '-w', PLIST], { stdio: 'ignore' })
    return r.status === 0
  }
  if (process.platform === 'linux') {
    mkdirSync(SYSD, { recursive: true })
    writeFileSync(join(SYSD, 'dropboss-porteiro.service'),
      `[Unit]\nDescription=dropboss porteiro\n\n[Service]\nType=oneshot\nExecStart=${process.execPath} ${SCRIPT}\n`)
    writeFileSync(join(SYSD, 'dropboss-porteiro.timer'),
      `[Unit]\nDescription=dropboss porteiro (30s)\n\n[Timer]\nOnBootSec=30\nOnUnitActiveSec=30\n\n[Install]\nWantedBy=timers.target\n`)
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
    const r = spawnSync('systemctl', ['--user', 'enable', '--now', 'dropboss-porteiro.timer'], { stdio: 'ignore' })
    return r.status === 0
  }
  return false
}

export function uninstallAgent () {
  if (process.platform === 'darwin') {
    spawnSync('launchctl', ['bootout', `gui/${os.userInfo().uid}`, PLIST], { stdio: 'ignore' })
    if (existsSync(PLIST)) rmSync(PLIST)
  } else if (process.platform === 'linux') {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'dropboss-porteiro.timer'], { stdio: 'ignore' })
  }
}
