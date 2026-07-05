// invite.js — convite serverless: o código É o rendezvous.
export function encodeInvite ({ deviceID, folderID, label }) {
  const payload = { v: 1, d: deviceID, f: folderID, l: label }
  return 'db1-' + Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeInvite (code) {
  code = String(code).trim()
  const i = code.indexOf('db1-')
  if (i === -1) throw new Error('isso não parece um convite dropboss (esperava algo começando com db1-)')
  let payload
  try {
    payload = JSON.parse(Buffer.from(code.slice(i + 4), 'base64url').toString('utf8'))
  } catch {
    throw new Error('convite corrompido — pede pro outro lado gerar de novo com `dropboss share`')
  }
  if (payload.v !== 1 || !payload.d || !payload.f) throw new Error('convite de versão desconhecida')
  return { deviceID: payload.d, folderID: payload.f, label: payload.l || 'dropboss' }
}
