# dropboss 🕶

> Pasta compartilhada p2p pra vibecoding a dois. Syncthing por baixo, agents por cima.

Você e um parceiro (cada um com seu Claude) trabalham na mesma pasta, em máquinas
diferentes, como se fossem dois agents na mesma máquina. Sem nuvem, sem conta,
sem servidor nosso: as máquinas conversam direto (E2E via Syncthing, com a
descoberta global e relays públicos que já existem).

```
você + seu agent  ◄══ p2p, ~1-2s, E2E ══►  parceiro + o agent dele
```

## Instalação

```sh
npm install -g github:brunoqgalvao/dropboss
```

(ou sem instalar: `npx github:brunoqgalvao/dropboss <comando>`)

## Uso (ou: fala pro seu agente fazer)

```sh
# quem compartilha
dropboss share ~/projeto   # imprime uma mensagem pronta pra encaminhar.
                           # por padrão o convite vale pra 1 pessoa (7 dias):
                           # um porteiro em background aceita e fecha a porta.
                           # --uses 3 (três pessoas) · --uses 0 (ilimitado)
                           # --manual (nada de auto-aceite; use dropboss accept)

# quem entra (colou a mensagem no agente dele)
npx -y github:brunoqgalvao/dropboss join db1-…   # pronto. a pasta aparece e sincroniza
```

A mensagem do convite já carrega o comando completo com o link do repo — o
agente do seu parceiro não precisa saber o que é dropboss de antemão; o `npx`
instala tudo. Feche o convite quando todo mundo entrar: `dropboss close`.

O convite é serverless: o código `db1-…` carrega tudo (device + pasta). Mais gente
pode entrar com o mesmo código — o Syncthing faz mesh de N peers naturalmente.

### Comandos

| comando | faz o quê |
|---|---|
| `dropboss share [pasta]` | compartilha e abre o convite: 1 uso por padrão (`--uses N/0`, `--ttl D`, `--manual`) |
| `dropboss join <código> [--path p]` | entra numa pasta compartilhada |
| `dropboss close [pasta]` | fecha o convite (quem já entrou, fica) |
| `dropboss status` | peers, sync %, conflitos, convites abertos |
| `dropboss history [nome]` | versões antigas (30 dias, `.stversions`) |
| `dropboss restore <arquivo>` | restaura uma versão antiga |
| `dropboss leave [pasta]` | desengancha esta máquina — arquivos ficam intactos |

## O agent ganha contexto sozinho

O `share` grava `.claude/skills/dropboss/SKILL.md` dentro da pasta — e ele
**sincroniza junto**. Ou seja: o Claude do seu parceiro descobre sozinho que a
pasta é compartilhada, como conflitos funcionam, e que `.git` não sincroniza.
O produto se documenta pra cada agent que abrir a pasta.

## Regras do jogo

- **`.git` nunca sincroniza** (via `.stignore`) — sync bidirecional corrompe repo.
  Cada máquina pode ter seu próprio repo local; `git init` é seguro.
- **Edição simultânea do mesmo arquivo não faz merge**: a cópia perdedora vira
  `nome.sync-conflict-….ext`. `dropboss status` mostra; resolva e apague.
- **Coordenação é de vocês**: dividam por diretório, usem um arquivo de notas,
  worktrees — o que preferirem. O dropboss não impõe convenção nenhuma.
- **Versões antigas**: quando um peer sobrescreve/apaga um arquivo seu, a versão
  anterior fica 30 dias em `.stversions` (local, fora do sync).

## Teste

```sh
npm run e2e   # sobe dois syncthings isolados e faz o ciclo completo
```

## Modo VPS (o dropboss original)

`dropboss.sh` continua aqui: espelha uma pasta numa VPS com um Claude headless
morando dentro (crons + watchdog com push via ntfy). Veja o cabeçalho do script:

```sh
./dropboss.sh --vps root@SEU_IP --folder ~/sua-pasta
```
