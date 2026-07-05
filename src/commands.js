// commands.js — share / join / accept / status / leave / history / restore
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { resolve, join, basename, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import * as st from './st.js'
import * as doorman from './doorman.js'
import { encodeInvite, decodeInvite } from './invite.js'

const { log, warn, die, sleep } = st

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pasta'
const rand4 = () => Math.random().toString(36).slice(2, 6)

// .git fora do sync é inegociável: git bidirecional via syncthing corrompe repo.
function ensureStignore (folderPath) {
  const file = join(folderPath, '.stignore')
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (!cur.split('\n').some(l => l.trim() === '.git')) {
    writeFileSync(file, (cur ? cur.replace(/\n?$/, '\n') : '// dropboss: .git nunca sincroniza (corrompe repo)\n') + '.git\n')
  }
}

function writeSkill (folderPath) {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'SKILL.md')
  const dest = join(folderPath, '.claude', 'skills', 'dropboss', 'SKILL.md')
  const managed = !existsSync(dest) || readFileSync(dest, 'utf8').includes('dropboss:managed')
  if (!managed) return // usuário customizou; não sobrescrevemos
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, readFileSync(src, 'utf8'))
}

async function upsertPeerInFolder (folderId, deviceID) {
  const folders = await st.getFolders()
  const folder = folders.find(f => f.id === folderId)
  if (!folder) die(`pasta ${folderId} sumiu da config`)
  if (!folder.devices.some(d => d.deviceID === deviceID)) {
    folder.devices.push({ deviceID })
    await st.saveFolder(folder)
  }
}

// ---------- share ----------
export async function share (args, flags) {
  const path = resolve(args[0] || '.')
  if (!existsSync(path) || !statSync(path).isDirectory()) die(`pasta não existe: ${path}`)
  await st.ensureDaemon()
  const me = await st.myId()

  let folder = await st.findFolderByPath(path)
  if (folder && st.expandPath(folder.path).replace(/\/+$/, '') !== path) {
    die(`${path} está DENTRO da pasta já sincronizada '${folder.label}' — compartilhe ela: dropboss share ${folder.path}`)
  }
  const label = folder?.label || basename(path)
  if (!folder) {
    const id = `${slug(label)}-${rand4()}`
    ensureStignore(path)
    writeSkill(path)
    await st.addFolder({ id, label, path, type: 'sendreceive', fsWatcherEnabled: true, devices: [{ deviceID: me }] })
    folder = { id, label }
    log(`pasta '${label}' agora é sincronizada (versões antigas ficam em .stversions por 30 dias)`)
  } else {
    ensureStignore(path)
    writeSkill(path)
    log(`pasta '${label}' já era sincronizada — reaproveitando`)
  }

  const code = encodeInvite({ deviceID: me, folderID: folder.id, label })
  console.log(`
┌─ convite dropboss ──────────────────────────────────────────────
│  copia e manda essa mensagem pro teu parceiro — ele só precisa
│  colar no agente dele (Claude, Cursor, o que for):
│
│    entra na minha pasta dropboss. roda:
│    npx -y github:brunoqgalvao/dropboss join ${code}
│    (precisa só de node — syncthing e o resto se instalam sozinhos.
│     o que é isso: https://github.com/brunoqgalvao/dropboss)
│
└─────────────────────────────────────────────────────────────────`)

  const manual = flags.manual || flags['no-wait'] || process.env.DROPBOSS_SYNCTHING_HOME
  if (manual) {
    // garante que um porteiro antigo não aceite por você (fora de ambiente de teste)
    if (!process.env.DROPBOSS_SYNCTHING_HOME) doorman.closeInvite(folder.id)
    log('modo manual: aceite quem entrar com `dropboss accept` (ou deixe `dropboss share --wait` rodando)')
  } else {
    const ttl = Number(flags.ttl || 7)
    const uses = flags.uses === undefined ? 1 : Number(flags.uses) === 0 ? undefined : Number(flags.uses)
    if (doorman.openInvite(folder.id, label, { ttlDays: ttl, uses })) {
      log(uses === undefined
        ? `convite aberto por ${ttl} dias, entradas ilimitadas — quem tiver o código entra sozinho`
        : `convite vale pra ${uses} pessoa(s) e expira em ${ttl} dias — a porta fecha sozinha depois disso`)
      log('fechar antes: dropboss close  |  quem já entrou continua mesmo depois de fechar')
    } else {
      warn('não consegui instalar o porteiro nesta plataforma — deixe `dropboss share --wait` rodando ou rode `dropboss accept` quando avisarem')
    }
  }
  if (flags.wait) {
    log('modo --wait: aceitando aqui no terminal… (Ctrl-C para sair)')
    await acceptLoop(folder.id, { forever: true })
  }
}

// ---------- close ----------
export async function close (args) {
  const path = resolve(args[0] || '.')
  await st.ensureDaemon()
  const folder = await st.findFolderByPath(path)
  if (!folder) die(`${path} não é uma pasta sincronizada`)
  doorman.closeInvite(folder.id)
  log(`convite de '${folder.label}' fechado — ninguém mais entra com o código antigo (quem já está, continua)`)
}

// ---------- accept ----------
export async function accept (args, flags) {
  const path = resolve(args[0] || '.')
  await st.ensureDaemon()
  const folder = await st.findFolderByPath(path)
  if (!folder) die(`${path} não é uma pasta sincronizada — rode dropboss share primeiro`)
  const n = await acceptLoop(folder.id, { timeoutS: Number(flags.timeout || 60) })
  if (n === 0) log('ninguém batendo na porta agora — o convite continua válido')
}

async function acceptLoop (folderId, { forever = false, timeoutS = 60 } = {}) {
  let added = 0
  const deadline = Date.now() + timeoutS * 1000
  while (forever || Date.now() < deadline) {
    const pending = await st.pendingDevices()
    for (const [deviceID, info] of Object.entries(pending || {})) {
      const name = info.name || `peer-${deviceID.slice(0, 7)}`
      await st.addDevice(deviceID, name)
      await upsertPeerInFolder(folderId, deviceID)
      try { await st.rest('DELETE', `/rest/cluster/pending/devices?device=${deviceID}`) } catch {}
      added++
      log(`✓ ${name} entrou (${deviceID.slice(0, 7)}…) — sync começando`)
      if (!forever) return added
    }
    await sleep(3000)
  }
  return added
}

// ---------- join ----------
export async function join_ (args, flags) {
  if (!args[0]) die('uso: dropboss join <código> [--path ~/destino]')
  const inv = decodeInvite(args[0])
  await st.ensureDaemon()
  const me = await st.myId()
  if (me === inv.deviceID) die('esse convite é seu 🙃')

  const path = resolve(st.expandPath(flags.path || join(os.homedir(), slug(inv.label))))
  const existing = (await st.getFolders()).find(f => f.id === inv.folderID)
  if (existing) {
    log(`você já está nessa pasta: ${st.expandPath(existing.path)}`)
  } else {
    mkdirSync(path, { recursive: true })
    if (readdirSync(path).some(f => f !== '.stignore')) {
      warn(`${path} não está vazia — o conteúdo vai se misturar com o da pasta compartilhada`)
    }
    ensureStignore(path)
    const devices = await st.getDevices()
    if (!devices.some(d => d.deviceID === inv.deviceID)) {
      // introducer: se entrar mais gente na pasta, o host apresenta todo mundo sozinho
      await st.addDevice(inv.deviceID, `${inv.label}-host`, { introducer: true })
    }
    await st.addFolder({ id: inv.folderID, label: inv.label, path, type: 'sendreceive', fsWatcherEnabled: true, devices: [{ deviceID: me }, { deviceID: inv.deviceID }] })
    log(`configurado — pasta local: ${path}`)
  }
  if (flags['no-wait']) return

  log('conectando no outro lado… (o porteiro do host aceita sozinho — leva até ~1 min)')
  const deadline = Date.now() + Number(flags.timeout || 300) * 1000
  let connected = false
  while (Date.now() < deadline) {
    const conns = await st.connections()
    if (!connected && conns[inv.deviceID]?.connected) {
      connected = true
      log('conectado ao host ✓ — esperando ele aceitar você…')
    }
    if (connected) {
      try {
        const comp = await st.rest('GET', `/rest/db/completion?folder=${encodeURIComponent(inv.folderID)}`)
        if (comp.globalBytes > 0 || comp.globalItems > 0) {
          log(`sync ativo ✓ (${comp.globalItems ?? '?'} itens na pasta)`)
          log(`pronto! seu agente ganha contexto automático: .claude/skills/dropboss/SKILL.md (sincroniza junto)`)
          return
        }
      } catch {}
    }
    await sleep(3000)
  }
  if (connected) {
    log('conectado, mas a pasta ainda parece vazia — se ela tem arquivos no host, confere se o convite dele ainda está aberto (`dropboss share` lá renova)')
  } else {
    die('não conectou — confere se o host está online (a descoberta global pode levar ~1 min); rodar de novo é seguro')
  }
}

// ---------- status ----------
export async function status () {
  await st.ensureDaemon()
  const me = await st.myId()
  const [folders, devices, conns] = await Promise.all([st.getFolders(), st.getDevices(), st.connections()])
  const names = Object.fromEntries(devices.map(d => [d.deviceID, d.name || d.deviceID.slice(0, 7)]))
  if (!folders.length) { log('nenhuma pasta sincronizada'); return }
  const open = doorman.openInvites()
  for (const f of folders) {
    const path = st.expandPath(f.path)
    const o = open[f.id]
    const inv = o && o.until > Date.now()
      ? `  \x1b[33m(convite aberto: ${o.uses === undefined ? 'entradas ilimitadas' : `${o.uses} uso(s) restante(s)`}, até ${new Date(o.until).toISOString().slice(0, 10)})\x1b[0m` : ''
    console.log(`\n\x1b[1m${f.label}\x1b[0m  ${path}${inv}`)
    for (const d of f.devices.filter(d => d.deviceID !== me)) {
      const on = conns[d.deviceID]?.connected
      let pct = ''
      try {
        const c = await st.rest('GET', `/rest/db/completion?folder=${encodeURIComponent(f.id)}&device=${d.deviceID}`)
        pct = ` — ${Math.floor(c.completion)}% em dia`
      } catch {}
      console.log(`  ${on ? '\x1b[32m●\x1b[0m online ' : '\x1b[31m○\x1b[0m offline'} ${names[d.deviceID] || d.deviceID.slice(0, 7)}${on ? pct : ''}`)
    }
    const conflicts = findConflicts(path)
    if (conflicts.length) {
      warn(`  ${conflicts.length} arquivo(s) de conflito para resolver:`)
      conflicts.slice(0, 10).forEach(c => console.log(`    ${relative(path, c)}`))
    }
  }
  console.log()
}

function findConflicts (dir, out = [], depth = 0) {
  if (depth > 8) return out
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (['.git', '.stversions', 'node_modules', '.stfolder'].includes(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) findConflicts(p, out, depth + 1)
    else if (e.name.includes('.sync-conflict-')) out.push(p)
  }
  return out
}

// ---------- leave ----------
export async function leave (args) {
  const path = resolve(args[0] || '.')
  await st.ensureDaemon()
  const me = await st.myId()
  const folder = await st.findFolderByPath(path)
  if (!folder) die(`${path} não é uma pasta sincronizada`)
  doorman.closeInvite(folder.id)
  await st.rest('DELETE', `/rest/config/folders/${encodeURIComponent(folder.id)}`)
  log(`'${folder.label}' fora do sync — os arquivos continuam intactos em ${st.expandPath(folder.path)}`)

  // remove peers que não participam de nenhuma outra pasta
  const [folders, devices] = await Promise.all([st.getFolders(), st.getDevices()])
  const stillUsed = new Set(folders.flatMap(f => f.devices.map(d => d.deviceID)))
  for (const d of devices) {
    if (d.deviceID !== me && !stillUsed.has(d.deviceID)) {
      await st.rest('DELETE', `/rest/config/devices/${d.deviceID}`)
      log(`peer ${d.name || d.deviceID.slice(0, 7)} removido`)
    }
  }
  if (folders.length === 0) log('nenhuma pasta restante — se quiser parar o syncthing de vez: brew services stop syncthing')
}

// ---------- history / restore ----------
const TAG = /~(\d{8}-\d{6})(?=\.[^.]+$|$)/ // nome~20260705-134501.ext

export async function history (args) {
  const cwd = resolve('.')
  await st.ensureDaemon()
  const folder = await st.findFolderByPath(cwd)
  if (!folder) die('rode dentro de uma pasta sincronizada')
  const root = join(st.expandPath(folder.path), '.stversions')
  if (!existsSync(root)) { log('nenhuma versão antiga guardada ainda'); return }
  const filter = args[0]?.toLowerCase()
  const versions = []
  ;(function walk (dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const m = e.name.match(TAG)
        if (m) versions.push({ path: p, rel: relative(root, p), when: m[1] })
      }
    }
  })(root)
  const hits = versions
    .filter(v => !filter || v.rel.toLowerCase().includes(filter))
    .sort((a, b) => b.when.localeCompare(a.when))
  if (!hits.length) { log('nenhuma versão encontrada' + (filter ? ` para '${filter}'` : '')); return }
  for (const v of hits.slice(0, 50)) {
    const t = v.when.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6')
    console.log(`  ${t}  ${v.rel}`)
  }
  console.log(`\nrestaurar: dropboss restore <caminho acima>`)
}

export async function restore (args, flags) {
  if (!args[0]) die('uso: dropboss restore <arquivo da lista do history> [--force]')
  const cwd = resolve('.')
  await st.ensureDaemon()
  const folder = await st.findFolderByPath(cwd)
  if (!folder) die('rode dentro de uma pasta sincronizada')
  const root = st.expandPath(folder.path)
  const src = resolve(join(root, '.stversions'), args[0])
  if (!existsSync(src)) die(`não achei ${args[0]} em .stversions (rode dropboss history)`)
  const rel = relative(join(root, '.stversions'), src).replace(TAG, '')
  const dest = join(root, rel)
  if (existsSync(dest) && !flags.force) die(`${rel} já existe — use --force para sobrescrever (a atual vira versão antiga no outro lado)`)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  log(`restaurado: ${rel}`)
}
