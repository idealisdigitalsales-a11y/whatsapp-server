import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { BaileysHandler } from './baileys-handler.js';

console.log('✅ All imports successful');
console.log('BaileysHandler:', typeof BaileysHandler);

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Store Baileys instances per closer
const baileysInstances = new Map();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeSessions: baileysInstances.size,
    uptime: process.uptime()
  });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  let closerId = null;
  let baileysHandler = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received:', data.type);

      switch (data.type) {
        case 'INIT_SESSION':
          closerId = data.closerId;
          
          // Check if session already exists
          if (baileysInstances.has(closerId)) {
            console.log(`Session already exists for ${closerId}`);
            baileysHandler = baileysInstances.get(closerId);
            
            // Send current status
            const status = await baileysHandler.getStatus();
            ws.send(JSON.stringify({
              type: 'SESSION_STATUS',
              status: status
            }));
          } else {
            // Create new Baileys instance
            console.log(`Creating new session for ${closerId}`);
            baileysHandler = new BaileysHandler(closerId, ws);
            baileysInstances.set(closerId, baileysHandler);
            
            await baileysHandler.initialize();
          }
          break;

        case 'DISCONNECT':
          if (baileysHandler) {
            await baileysHandler.disconnect();
            baileysInstances.delete(closerId);
            console.log(`Session ${closerId} disconnected`);
          }
          break;

        case 'SEND_MESSAGE':
          if (baileysHandler) {
            await baileysHandler.sendMessage(data.phone, data.message);
          }
          break;

        case 'MARK_READ':
          if (baileysHandler) {
            await baileysHandler.markAsRead(data.contactId);
          }
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    if (closerId && baileysHandler) {
      // Keep the session alive but mark as disconnected from frontend
      console.log(`Frontend disconnected but keeping session ${closerId} alive`);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 WhatsApp Baileys Server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  
  // Disconnect all Baileys instances
  for (const [closerId, handler] of baileysInstances.entries()) {
    console.log(`Disconnecting session ${closerId}`);
    await handler.disconnect();
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
