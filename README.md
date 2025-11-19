# WhatsApp Baileys Server - Idealis CRM

Servidor Node.js para integração WhatsApp usando Baileys.

## 🚀 Deploy no Railway (Recomendado)

### Passo 1: Criar conta no Railway
1. Acesse [railway.app](https://railway.app)
2. Faça login com GitHub

### Passo 2: Fazer Deploy
1. No Railway, clique em **"New Project"**
2. Selecione **"Deploy from GitHub repo"**
3. Autorize o Railway a acessar seus repositórios
4. Selecione o repositório do projeto
5. Railway detectará automaticamente que é um projeto Node.js

### Passo 3: Configurar Variáveis de Ambiente
No Railway, vá em **Variables** e adicione:

```
SUPABASE_URL=https://oawmdehwahrqenzldjxz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_aqui
PORT=3000
NODE_ENV=production
```

**⚠️ IMPORTANTE:** Pegue sua `SUPABASE_SERVICE_ROLE_KEY` em:
https://supabase.com/dashboard/project/oawmdehwahrqenzldjxz/settings/api

### Passo 4: Deploy
1. Railway fará o deploy automaticamente
2. Após o deploy, copie a URL do serviço (ex: `https://seu-projeto.up.railway.app`)
3. Anote essa URL - você precisará dela no frontend

### Passo 5: Configurar Frontend
No arquivo `src/pages/WhatsAppMeu.tsx`, atualize a URL do WebSocket:

```typescript
const wsUrl = 'wss://seu-projeto.up.railway.app';
```

## 🔧 Desenvolvimento Local

### Instalação
```bash
npm install
```

### Configurar .env
```bash
cp .env.example .env
# Edite o .env com suas credenciais
```

### Executar
```bash
npm run dev
```

Servidor rodará em: `http://localhost:3000`

## 📡 Endpoints

### Health Check
```
GET /health
```

### WebSocket
```
ws://localhost:3000
```

## 🔐 Segurança

- Use HTTPS/WSS em produção
- Mantenha a `SUPABASE_SERVICE_ROLE_KEY` em segredo
- Railway oferece SSL/TLS automaticamente

## 📝 Notas

- O Railway oferece $5/mês grátis (suficiente para começar)
- As sessões do WhatsApp são salvas em `auth_sessions/`
- Railway persiste esses arquivos automaticamente

## 🆘 Troubleshooting

### Erro de conexão com WhatsApp
- Verifique se o QR code foi escaneado
- Aguarde alguns segundos após escanear

### Erro ao enviar mensagens
- Confirme que a sessão está "connected"
- Verifique os logs no Railway

## 📚 Documentação

- [Baileys](https://github.com/WhiskeySockets/Baileys)
- [Railway Docs](https://docs.railway.app)
- [Supabase Docs](https://supabase.com/docs)
