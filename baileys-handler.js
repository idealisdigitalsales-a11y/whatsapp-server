import * as baileys from '@whiskeysockets/baileys';
import * as nodeCrypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';

// Polyfill global crypto for Baileys in environments where it's missing
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = nodeCrypto;
}


const {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = baileys;

const logger = pino({ level: 'info' });

console.log('✅ Baileys imported successfully');
console.log('makeWASocket type:', typeof makeWASocket);

export class BaileysHandler {
  constructor(closerId, ws) {
    this.closerId = closerId;
    this.ws = ws;
    this.sock = null;
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  async initialize() {
    try {
      console.log(`[${this.closerId}] Initializing Baileys...`);

      // Update status to connecting
      await this.updateSessionStatus('connecting');

      // Get latest Baileys version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`[${this.closerId}] Using Baileys version ${version.join('.')}`);

      // Initialize auth state
      const authPath = `./auth_sessions/${this.closerId}`;
      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      // Create socket
      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: false,
        browser: ['Idealis CRM', 'Chrome', '1.0.0'],
        logger,
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: false
      });

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log(`[${this.closerId}] QR Code received`);

          // Generate QR code as data URL
          const qrDataUrl = await QRCode.toDataURL(qr);

          // Save to Supabase
          await this.supabase
            .from('whatsapp_sessions')
            .update({
              qr_code: qr,
              status: 'waiting_scan',
              last_activity: new Date().toISOString(),
            })
            .eq('closer_id', this.closerId);

          // Send to frontend
          this.ws.send(
            JSON.stringify({
              type: 'QR_CODE',
              qrCode: qr,
              qrDataUrl,
            })
          );
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log(
            `[${this.closerId}] Connection closed. Status:`,
            statusCode,
            'Error:',
            lastDisconnect?.error
          );

          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          const isBadSession = statusCode === DisconnectReason.badSession;
          const shouldReconnect = !isLoggedOut && !isBadSession;

          if (isLoggedOut || isBadSession) {
            console.log(
              `[${this.closerId}] Clearing auth folder due to`,
              isBadSession ? 'bad session' : 'logged out'
            );
            try {
              await fs.promises.rm(authPath, { recursive: true, force: true });
            } catch (err) {
              console.error(
                `[${this.closerId}] Error clearing auth folder:`,
                err
              );
            }
          }

          await this.updateSessionStatus('disconnected');

          if (shouldReconnect) {
            setTimeout(() => this.initialize(), 5000);
          } else {
            this.ws.send(
              JSON.stringify({
                type: 'DISCONNECTED',
                reason: isBadSession ? 'BAD_SESSION' : 'LOGGED_OUT',
              })
            );
          }
        }

        if (connection === 'open') {
          console.log(`[${this.closerId}] Connected to WhatsApp!`);

          await this.updateSessionStatus('connected');

          this.ws.send(
            JSON.stringify({
              type: 'CONNECTED',
              message: 'WhatsApp conectado com sucesso!',
            })
          );

          // Sync contacts and groups
          await this.syncContactsAndGroups();
        }
      });

      // Save credentials when updated
      this.sock.ev.on('creds.update', saveCreds);

      // Handle incoming messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        console.log(`[${this.closerId}] messages.upsert type=${type}, count=${messages.length}`);

        for (const msg of messages) {
          if (!msg.message) continue;

          await this.handleIncomingMessage(msg);
        }
      });

    } catch (error) {
      console.error(`[${this.closerId}] Error initializing:`, error);
      await this.updateSessionStatus('failed');
      
      this.ws.send(JSON.stringify({
        type: 'ERROR',
        message: error.message
      }));
    }
  }

  async handleIncomingMessage(msg) {
    try {
      const remoteJid = msg.key.remoteJid;
      const messageText = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         '[Mídia]';
      const fromMe = msg.key.fromMe || false;

      console.log(`[${this.closerId}] New message ${fromMe ? 'sent' : 'from'} ${remoteJid}`);

      // Get or create contact
      const contactName = msg.pushName || remoteJid.split('@')[0];
      const isGroup = remoteJid.includes('@g.us');

      // Get sender info for group messages
      const senderJid = isGroup && !fromMe ? (msg.key.participant || msg.participant) : null;
      const senderName = isGroup && !fromMe ? (msg.pushName || senderJid?.split('@')[0]) : null;

      const { data: existingContact, error: contactError } = await this.supabase
        .from('whatsapp_contacts')
        .select('id, nao_lidas')
        .eq('closer_id', this.closerId)
        .eq('telefone', remoteJid)
        .maybeSingle();

      if (contactError) {
        console.error(`[${this.closerId}] Error fetching contact:`, contactError);
      }

      let contactId;

      if (existingContact) {
        // Update existing contact
        const updatedUnread = fromMe ? 0 : ((existingContact.nao_lidas || 0) + 1);

        const { error: updateError } = await this.supabase
          .from('whatsapp_contacts')
          .update({
            ultima_mensagem: messageText,
            ultima_mensagem_timestamp: new Date().toISOString(),
            nao_lidas: updatedUnread
          })
          .eq('id', existingContact.id);
        
        if (updateError) {
          console.error(`[${this.closerId}] Error updating contact:`, updateError);
        }

        contactId = existingContact.id;
      } else {
        // Create new contact
        const { data: newContact, error: insertError } = await this.supabase
          .from('whatsapp_contacts')
          .insert({
            closer_id: this.closerId,
            telefone: remoteJid,
            nome: contactName,
            is_group: isGroup,
            ultima_mensagem: messageText,
            ultima_mensagem_timestamp: new Date().toISOString(),
            nao_lidas: fromMe ? 0 : 1
          })
          .select()
          .maybeSingle();
        
        if (insertError) {
          console.error(`[${this.closerId}] Error inserting contact:`, insertError);
          return;
        }

        if (!newContact) {
          console.error(`[${this.closerId}] Failed to create contact for ${remoteJid}`);
          return;
        }

        contactId = newContact.id;
      }

      // Determine message type and content
      let messageType = 'text';
      let fileUrl = null;
      let fileName = null;

      if (msg.message?.audioMessage) {
        messageType = 'audio';
        fileUrl = msg.message.audioMessage.url;
        fileName = 'audio.ogg';
      } else if (msg.message?.imageMessage) {
        messageType = 'image';
        fileUrl = msg.message.imageMessage.url;
        fileName = 'image.jpg';
      } else if (msg.message?.videoMessage) {
        messageType = 'video';
        fileUrl = msg.message.videoMessage.url;
        fileName = 'video.mp4';
      } else if (msg.message?.documentMessage) {
        messageType = 'document';
        fileUrl = msg.message.documentMessage.url;
        fileName = msg.message.documentMessage.fileName || 'document';
      }

      // Save message
      const { error: messageError } = await this.supabase
        .from('whatsapp_messages')
        .insert({
          contact_id: contactId,
          closer_id: this.closerId,
          mensagem_id_whatsapp: msg.key.id,
          mensagem_texto: messageText,
          enviada_por: fromMe ? 'closer' : 'contato',
          tipo: messageType,
          arquivo_url: fileUrl,
          arquivo_nome: fileName,
          sender_phone: senderJid,
          sender_name: senderName,
          timestamp: new Date(msg.messageTimestamp * 1000).toISOString(),
          lida: fromMe
        });

      if (messageError) {
        console.error(`[${this.closerId}] Error inserting message:`, messageError);
        return;
      }

      // Notify frontend
      this.ws.send(JSON.stringify({
        type: 'NEW_MESSAGE',
        contact: {
          id: contactId,
          telefone: remoteJid,
          nome: contactName
        },
        message: messageText
      }));

    } catch (error) {
      console.error(`[${this.closerId}] Error handling message:`, error);
    }
  }

  async syncContactsAndGroups() {
    try {
      console.log(`[${this.closerId}] Syncing contacts and groups...`);

      // Get all groups
      const groups = await this.sock.groupFetchAllParticipating();
      
      for (const [jid, chat] of Object.entries(groups)) {
        await this.supabase
          .from('whatsapp_contacts')
          .upsert({
            closer_id: this.closerId,
            telefone: jid,
            nome: chat.subject || chat.name || jid.split('@')[0],
            is_group: true,
            group_participants: chat.participants?.map(p => p.id) || null
          }, {
            onConflict: 'closer_id,telefone'
          });
      }

      console.log(`[${this.closerId}] Synced ${Object.keys(groups).length} groups`);

      // Get individual chats from store
      const store = this.sock.store;
      if (store?.chats) {
        const individualChats = Object.values(store.chats).filter(
          chat => !chat.id.includes('@g.us')
        );

        for (const chat of individualChats) {
          const jid = chat.id;
          const name = chat.name || jid.split('@')[0];

          await this.supabase
            .from('whatsapp_contacts')
            .upsert({
              closer_id: this.closerId,
              telefone: jid,
              nome: name,
              is_group: false
            }, {
              onConflict: 'closer_id,telefone'
            });
        }

        console.log(`[${this.closerId}] Synced ${individualChats.length} individual contacts`);
      } else {
        console.log(`[${this.closerId}] Store not available, skipping individual contacts sync`);
      }
    } catch (error) {
      console.error(`[${this.closerId}] Error syncing contacts:`, error);
    }
  }

  async sendMessage(phone, message) {
    try {
      if (!this.sock) {
        throw new Error('Socket not initialized');
      }

      const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
      
      await this.sock.sendMessage(jid, { text: message });
      
      console.log(`[${this.closerId}] Message sent to ${phone}`);
      
      return { success: true };
    } catch (error) {
      console.error(`[${this.closerId}] Error sending message:`, error);
      throw error;
    }
  }

  async markAsRead(contactId) {
    try {
      await this.supabase
        .from('whatsapp_contacts')
        .update({ nao_lidas: 0 })
        .eq('id', contactId);
      
      console.log(`[${this.closerId}] Marked contact ${contactId} as read`);
    } catch (error) {
      console.error(`[${this.closerId}] Error marking as read:`, error);
    }
  }

  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout();
        this.sock = null;
      }
      await this.updateSessionStatus('disconnected');
      console.log(`[${this.closerId}] Disconnected`);
    } catch (error) {
      console.error(`[${this.closerId}] Error disconnecting:`, error);
    }
  }

  async updateSessionStatus(status) {
    try {
      await this.supabase
        .from('whatsapp_sessions')
        .upsert({
          closer_id: this.closerId,
          status,
          last_activity: new Date().toISOString()
        });
    } catch (error) {
      console.error(`[${this.closerId}] Error updating status:`, error);
    }
  }

  async getStatus() {
    const { data } = await this.supabase
      .from('whatsapp_sessions')
      .select('status')
      .eq('closer_id', this.closerId)
      .single();
    
    return data?.status || 'disconnected';
  }
}
