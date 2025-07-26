import dotenv from 'dotenv';
dotenv.config();

import {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import express from 'express';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { File } from 'megajs';
import { fileURLToPath } from 'url';

import config from './config.cjs';
import autoreact from './lib/autoreact.cjs';
import { Handler, Callupdate, GroupUpdate } from './event/index.js';

const { emojis, doReact } = autoreact;
const app = express();
let useQR = false;
let initialConnection = true;

const PORT = process.env.PORT || 3000;
const MAIN_LOGGER = pino({ timestamp: () => `,"time":"${new Date().toJSON()}"` });
const logger = MAIN_LOGGER.child({ level: 'trace' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionDir = path.join(__dirname, 'session');
const credsPath = path.join(sessionDir, 'creds.json');

if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

async function downloadSessionData() {
  console.log("Debug SESSION_ID:", config.SESSION_ID);
  if (!config.SESSION_ID) return console.error("❌ Please add your session to SESSION_ID env !!");

  const sessionRaw = config.SESSION_ID.split("MEGALODON~MD~")[1];
  if (!sessionRaw || !sessionRaw.includes('#')) {
    return console.error("❌ Invalid SESSION_ID format!");
  }

  const [fileId, key] = sessionRaw.split('#');
  try {
    console.log("🔄 Downloading Session...");
    const megaFile = File.fromURL(`https://mega.nz/file/${fileId}#${key}`);
    const data = await new Promise((res, rej) =>
      megaFile.download((err, file) => (err ? rej(err) : res(file)))
    );
    await fs.promises.writeFile(credsPath, data);
    console.log("🔒 Session Successfully Loaded !!");
    return true;
  } catch (err) {
    console.error("❌ Failed to download session:", err);
    return false;
  }
}

async function start() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`🤖 Bot using WA v${version.join('.')} (Latest: ${isLatest})`);

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: useQR,
      browser: ['MEGALODON-MD', 'Safari', '3.3'],
      auth: state,
      getMessage: async key => ({
        conversation: 'MEGALODON-MD WhatsApp Bot'
      })
    });

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) start();
      } else if (connection === 'open') {
        if (initialConnection) {
          console.log(chalk.green("✅ MEGALODON-MD is now online!"));
          await sock.sendMessage(sock.user.id, {
            image: { url: 'https://files.catbox.moe/e1k73u.jpg' },
            caption: `✅ Connected as ${sock.user.name || sock.user.id}`,
            contextInfo: {
              externalAdReply: {
                title: "MEGALODON-MD",
                body: "ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴅʏʙʏ ᴛᴇᴄʜ",
                thumbnailUrl: "https://files.catbox.moe/xc6eca.jpg",
                sourceUrl: "https://whatsapp.com/channel/0029VbAdcIXJP216dKW1253g",
                mediaType: 1,
                renderLargerThumbnail: false
              }
            }
          });
          initialConnection = false;
        } else {
          console.log(chalk.blue("♻️ Connection reestablished."));
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', msg => Handler(msg, sock, logger));
    sock.ev.on('call', call => Callupdate(call, sock));
    sock.ev.on('group-participants.update', update => GroupUpdate(sock, update));

    if (config.MODE === 'public') sock.public = true;
    else sock.public = false;

    // Auto react
    sock.ev.on('messages.upsert', async msg => {
      try {
        const m = msg.messages[0];
        if (!m.key.fromMe && config.AUTO_REACT && m.message) {
          const emoji = emojis[Math.floor(Math.random() * emojis.length)];
          await doReact(emoji, m, sock);
        }
      } catch (err) {
        console.error("Auto react error:", err);
      }
    });

  } catch (err) {
    console.error("Critical Error:", err);
    process.exit(1);
  }
}

async function init() {
  if (fs.existsSync(credsPath)) {
    console.log("🔒 Session file found, starting...");
    await start();
  } else {
    const downloaded = await downloadSessionData();
    if (downloaded) {
      console.log("✅ Session downloaded, starting bot...");
      await start();
    } else {
      console.log("❌ No session found or invalid. Showing QR...");
      useQR = true;
      await start();
    }
  }
}

init();

// Web server
app.use(express.static(path.join(__dirname, "mydata")));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, "mydata", "index.html"));
});
app.listen(PORT, () => console.log(`🌐 Server running on http://localhost:${PORT}`));
