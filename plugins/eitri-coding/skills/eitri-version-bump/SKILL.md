---
name: eitri-version-bump
description: >-
  Lembrete e automação de bump semver em projetos Eitri. SEMPRE ativar ao
  concluir qualquer tarefa de codificação num projeto Eitri — lembre o
  usuário de incrementar a versão no eitri-app.conf.js (patch ou minor)
  e ofereça executar o bump via script Python. Também ativar quando o
  usuário mencionar "bump", "versão", "version", "push-version",
  "deploy" ou "publicar" no contexto de um Eitri-App.
---

# Eitri Version Bump

## Quando ativar

**Ao concluir qualquer tarefa de codificação** em um projeto Eitri
(detectado por `eitri-app.conf.js` ou `app-config.yaml`), este skill
deve ser invocado para lembrar o desenvolvedor de dar bump na versão.

Ativar também quando o usuário mencionar "bump", "versão", "version",
"push-version", "deploy" ou "publicar".

## Fluxo

1. **Leia a versão atual** do `eitri-app.conf.js` e mostre ao usuário:

   > 📦 **Versão atual:** `X.Y.Z` (em `eitri-app.conf.js`)

2. **Lembre o usuário** que a versão precisa ser incrementada antes do
   `eitri push-version`:

   > ⚠️ **Lembrete de versão:** Antes de fazer `eitri push-version`,
   > incremente a versão em `eitri-app.conf.js`.

3. **Pergunte o tipo de bump:**
   - **patch** (ex: `1.2.3` → `1.2.4`) — correções, ajustes visuais,
     refatorações internas
   - **minor** (ex: `1.2.3` → `1.3.0`) — nova funcionalidade, nova view,
     nova integração
   - **major** (ex: `1.2.3` → `2.0.0`) — breaking changes, reescrita
     significativa
   - **Agora não** — o usuário fará o bump manualmente mais tarde

4. **Sugira uma `versionMessage`** baseada nas alterações feitas na task.
   A mensagem é **obrigatória** — todo bump deve ter uma descrição.
   A mensagem deve ser curta e descritiva (1 linha). Exemplos:

   - `"Correção do cálculo de frete no checkout"`
   - `"Nova tela de detalhes do produto"`
   - `"Refatoração dos providers de autenticação"`

   Apresente a sugestão e pergunte se o usuário quer usar essa mensagem
   ou editar. **Não prossiga sem uma mensagem definida.**

5. **Execute o script** com a flag `--message` (sempre obrigatória):

   ```bash
   python3 "<SKILL_DIR>/scripts/bump_version.py" <patch|minor|major> <path/to/eitri-app.conf.js> --message "descrição das alterações"
   ```

   Substitua `<SKILL_DIR>` pelo caminho absoluto do diretório desta skill.

6. **Se o usuário recusar o bump**, respeite — ele pode querer fazer
   manualmente mais tarde. Apenas confirme que ele está ciente:

   > 👍 Sem problemas. Lembre de incrementar a versão antes do próximo
   > `eitri push-version`.

## Regras

- **Nunca faça o bump sem perguntar.** Sempre ofereça e espere
  confirmação explícita do usuário.
- **A `versionMessage` é obrigatória.** Todo bump deve incluir uma
  mensagem descrevendo as alterações. Nunca execute o script sem
  `--message`. Sugira uma mensagem baseada no que foi feito na task.
- **Se a task foi trivial** (ex: só leu código, respondeu uma pergunta,
  não alterou nenhum arquivo), não é necessário lembrar.
- **Em workspaces multi-app** (`app-config.yaml`), identifique qual app
  foi alterado e ofereça bump apenas para ele.
- **Mostre a versão atual** antes de propor o bump para o usuário ter
  contexto.
- **Após o bump**, mostre a versão nova e confirme que o arquivo foi
  atualizado.

## Localização do script

O script Python fica em:
[bump_version.py](./scripts/bump_version.py)
