import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import QRCode from 'qrcode';

const logger = pino({ level: 'info' });

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
              last_activity: new Date().toISOString()
            })
            .eq('closer_id', this.closerId);

          // Send to frontend
          this.ws.send(JSON.stringify({
            type: 'QR_CODE',
            qrCode: qr,
            qrDataUrl: qrDataUrl
          }));
        }

        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log(`[${this.closerId}] Connection closed. Reconnect:`, shouldReconnect);

          await this.updateSessionStatus('disconnected');

          if (shouldReconnect) {
            setTimeout(() => this.initialize(), 5000);
          }
        }

        if (connection === 'open') {
          console.log(`[${this.closerId}] Connected to WhatsApp!`);
          
          await this.updateSessionStatus('connected');
          
          this.ws.send(JSON.stringify({
            type: 'CONNECTED',
            message: 'WhatsApp conectado com sucesso!'
          }));

          // Sync contacts and groups
          await this.syncContactsAndGroups();
        }
      });

      // Save credentials when updated
      this.sock.ev.on('creds.update', saveCreds);

      // Handle incoming messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;

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

      console.log(`[${this.closerId}] New message from ${remoteJid}`);

      // Get or create contact
      const contactName = msg.pushName || remoteJid.split('@')[0];
      const isGroup = remoteJid.includes('@g.us');

      const { data: existingContact } = await this.supabase
        .from('whatsapp_contacts')
        .select('id')
        .eq('closer_id', this.closerId)
        .eq('telefone', remoteJid)
        .single();

      let contactId;

      if (existingContact) {
        // Update existing contact
        await this.supabase
          .from('whatsapp_contacts')
          .update({
            ultima_mensagem: messageText,
            ultima_mensagem_timestamp: new Date().toISOString(),
            nao_lidas: this.supabase.rpc('increment', { x: 1 })
          })
          .eq('id', existingContact.id);
        
        contactId = existingContact.id;
      } else {
        // Create new contact
        const { data: newContact } = await this.supabase
          .from('whatsapp_contacts')
          .insert({
            closer_id: this.closerId,
            telefone: remoteJid,
            nome: contactName,
            is_group: isGroup,
            ultima_mensagem: messageText,
            ultima_mensagem_timestamp: new Date().toISOString(),
            nao_lidas: 1
          })
          .select()
          .single();
        
        contactId = newContact.id;
      }

      // Save message
      await this.supabase
        .from('whatsapp_messages')
        .insert({
          contact_id: contactId,
          message_id: msg.key.id,
          from_me: false,
          message_text: messageText,
          timestamp: new Date(msg.messageTimestamp * 1000).toISOString(),
          status: 'received'
        });

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

      // Get all chats
      const chats = await this.sock.groupFetchAllParticipating();
      
      for (const [jid, chat] of Object.entries(chats)) {
        const isGroup = jid.includes('@g.us');
        
        await this.supabase
          .from('whatsapp_contacts')
          .upsert({
            closer_id: this.closerId,
            telefone: jid,
            nome: chat.subject || chat.name || jid.split('@')[0],
            is_group: isGroup,
            group_participants: isGroup ? chat.participants?.map(p => p.id) : null
          }, {
            onConflict: 'closer_id,telefone'
          });
      }

      console.log(`[${this.closerId}] Synced ${Object.keys(chats).length} contacts/groups`);
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
