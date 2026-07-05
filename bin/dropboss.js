#!/usr/bin/env node
// dropboss — pasta compartilhada p2p pra vibecoding a dois. syncthing por baixo, agents por cima.
import * as cmd from '../src/commands.js'

const HELP = `
dropboss 🕶  — pasta compartilhada p2p pra vibecoding a dois

uso:
  dropboss share [pasta]            compartilha; convite auto-aceita 1 pessoa em até 7 dias
                                    (--uses N pra mais gente, --uses 0 ilimitado,
                                     --ttl <dias>, --manual desliga o auto-aceite)
  dropboss join <código> [--path p] entra numa pasta compartilhada
  dropboss close [pasta]            fecha o convite (quem já entrou, fica)
  dropboss status                   peers, sync, conflitos e convites abertos
  dropboss history [nome]           versões antigas guardadas (.stversions, 30 dias)
  dropboss restore <arquivo>        restaura uma versão antiga
  dropboss leave [pasta]            desengancha esta máquina (arquivos ficam)
  dropboss accept [pasta]           aceita manualmente (fallback sem porteiro)

flags: --path <dir>  --uses <n>  --ttl <dias>  --manual  --wait  --timeout <s>  --force

convites são serverless: o código db1-… carrega tudo. sem conta, sem nuvem.
.git nunca sincroniza — cada máquina pode ter seu próprio repo local.
`

const [, , command, ...rest] = process.argv
const args = []
const flags = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const name = rest[i].slice(2)
    if (['path', 'timeout', 'to', 'ttl', 'uses'].includes(name)) flags[name] = rest[++i]
    else flags[name] = true
  } else args.push(rest[i])
}

const table = {
  share: cmd.share,
  join: cmd.join_,
  accept: cmd.accept,
  close: cmd.close,
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
