#!/usr/bin/env node
// dropboss — pasta compartilhada p2p pra vibecoding a dois. syncthing por baixo, agents por cima.
import * as cmd from '../src/commands.js'

const HELP = `
dropboss 🕶  — pasta compartilhada p2p pra vibecoding a dois

uso:
  dropboss share [pasta]            compartilha uma pasta e imprime o convite
  dropboss join <código> [--path p] entra numa pasta compartilhada
  dropboss accept [pasta]           aceita quem usou seu convite (se share não estiver rodando)
  dropboss status                   peers, sync e conflitos
  dropboss history [nome]           versões antigas guardadas (.stversions, 30 dias)
  dropboss restore <arquivo>        restaura uma versão antiga
  dropboss leave [pasta]            desengancha esta máquina (arquivos ficam)

flags: --path <dir>  --no-wait  --timeout <s>  --force

convites são serverless: o código db1-… carrega tudo. sem conta, sem nuvem.
.git nunca sincroniza — cada máquina pode ter seu próprio repo local.
`

const [, , command, ...rest] = process.argv
const args = []
const flags = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const name = rest[i].slice(2)
    if (['path', 'timeout', 'to'].includes(name)) flags[name] = rest[++i]
    else flags[name] = true
  } else args.push(rest[i])
}

const table = {
  share: cmd.share,
  join: cmd.join_,
  accept: cmd.accept,
  status: cmd.status,
  leave: cmd.leave,
  history: cmd.history,
  restore: cmd.restore
}

if (!command || command === 'help' || flags.help) {
  console.log(HELP)
} else if (command === 'version') {
  const { readFileSync } = await import('node:fs')
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
} else if (table[command]) {
  try {
    await table[command](args, flags)
  } catch (e) {
    console.error(`\x1b[1;31m[dropboss]\x1b[0m ${e.message}`)
    process.exit(1)
  }
} else {
  console.error(`comando desconhecido: ${command} (dropboss help)`)
  process.exit(1)
}
