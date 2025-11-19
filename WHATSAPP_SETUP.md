# 📱 Configuração WhatsApp - Idealis CRM

## 🎯 O que foi criado

Foi criado um **servidor Node.js separado** na pasta `whatsapp-server/` que roda o Baileys (biblioteca WhatsApp) e se comunica com seu Supabase.

### Por que um servidor separado?

O Baileys não funciona em Edge Functions do Supabase porque depende de pacotes Git que não são permitidos nesse ambiente. Por isso, precisamos de um servidor Node.js tradicional.

## 🚀 Como fazer o deploy (Railway - Grátis)

### Passo 1: Preparar o código
1. Faça push da pasta `whatsapp-server/` para seu repositório Git
2. Ou crie um repositório separado apenas com essa pasta

### Passo 2: Deploy no Railway
1. Acesse [railway.app](https://railway.app) e faça login com GitHub
2. Clique em **"New Project"**
3. Selecione **"Deploy from GitHub repo"**
4. Escolha o repositório (ou a pasta whatsapp-server)
5. Railway detectará automaticamente o projeto Node.js

### Passo 3: Configurar Variáveis de Ambiente
No Railway, vá em **Variables** e adicione:

```env
SUPABASE_URL=https://oawmdehwahrqenzldjxz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
PORT=3000
NODE_ENV=production
```

**⚠️ ONDE PEGAR A SERVICE_ROLE_KEY:**
1. Acesse: https://supabase.com/dashboard/project/oawmdehwahrqenzldjxz/settings/api
2. Copie a chave **"service_role"** (NÃO a "anon")
3. Cole no Railway

### Passo 4: Obter a URL do Deploy
1. Após o deploy, Railway gerará uma URL (ex: `https://whatsapp-server-production.up.railway.app`)
2. **COPIE ESSA URL** - você precisará dela no próximo passo

### Passo 5: Atualizar o Frontend
No arquivo `src/pages/WhatsAppMeu.tsx`, linha 122, substitua:

```typescript
const wsUrl = 'ws://localhost:3000'; // Desenvolvimento
```

Por:

```typescript
const wsUrl = 'wss://sua-url-do-railway.up.railway.app'; // Produção
```

**⚠️ IMPORTANTE:** Use `wss://` (com S) em produção, não `ws://`

### Passo 6: Testar
1. Acesse `/whatsapp-meu` no seu app
2. Clique em **"Conectar WhatsApp"**
3. Um QR Code REAL será gerado
4. Escaneie com seu WhatsApp
5. Pronto! ✅

## 💰 Custos

- **Railway:** $5/mês grátis (suficiente para começar)
- Depois: ~$5-10/mês dependendo do uso

## 🔧 Desenvolvimento Local (Opcional)

Se quiser testar localmente antes do deploy:

```bash
cd whatsapp-server
npm install
cp .env.example .env
# Edite o .env com suas credenciais
npm run dev
```

## 📊 Estrutura do Servidor

```
whatsapp-server/
├── server.js           # Servidor principal (Express + WebSocket)
├── baileys-handler.js  # Lógica do Baileys (WhatsApp)
├── package.json        # Dependências
├── .env.example        # Exemplo de variáveis
└── README.md          # Documentação detalhada
```

## 🔐 Segurança

✅ A `SUPABASE_SERVICE_ROLE_KEY` fica apenas no servidor (Railway)
✅ O frontend só se comunica via WebSocket seguro (WSS)
✅ Sessões do WhatsApp são salvas de forma segura

## 🆘 Problemas?

### QR Code não aparece
- Verifique os logs no Railway
- Confirme que as variáveis de ambiente estão corretas

### Erro ao escanear QR Code
- Aguarde 5-10 segundos após escanear
- Tente gerar um novo QR Code

### Mensagens não chegam
- Confirme que o status está "connected"
- Verifique os logs no Railway

## 📚 Arquivos Criados

- ✅ `whatsapp-server/` - Servidor Node.js completo
- ✅ `whatsapp_messages` - Tabela criada no Supabase
- ✅ Frontend atualizado em `src/pages/WhatsAppMeu.tsx`

## 🎉 Pronto!

Após seguir esses passos, você terá:
- ✅ Conexão real com WhatsApp
- ✅ QR Codes funcionais
- ✅ Recebimento de mensagens
- ✅ Envio de mensagens (quando implementado)
- ✅ Sincronização de contatos

---

**Dúvidas?** Confira o `whatsapp-server/README.md` para mais detalhes técnicos.
