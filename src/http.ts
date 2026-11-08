import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { createPublicCanteenRouter } from './canteenPublic';

const port = Number(process.env.PORT || 3301);
const publicUrl = process.env.CANTEEN_MCP_PUBLIC_URL || `http://localhost:${port}`;
await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/basan-canteen');
const mailReady = Boolean(process.env.CANTEEN_SMTP_USER && process.env.CANTEEN_SMTP_PASSWORD);
const mailer = nodemailer.createTransport({
  host: process.env.CANTEEN_SMTP_HOST || 'smtp.qq.com',
  port: Number(process.env.CANTEEN_SMTP_PORT || 465),
  secure: process.env.CANTEEN_SMTP_SECURE !== 'false',
  auth: { user: process.env.CANTEEN_SMTP_USER, pass: process.env.CANTEEN_SMTP_PASSWORD },
  connectionTimeout: 15000, socketTimeout: 20000,
});
const app = express();
app.use(express.json());
app.use(await createPublicCanteenRouter(mongoose, {
  publicUrl, menuFile: process.env.CANTEEN_MENU_FILE,
  preferencesFile: process.env.CANTEEN_PREFERENCES_FILE,
  secureCookies: new URL(publicUrl).protocol === 'https:',
  mailReady,
  sendMail: ({ to, subject, text }) => mailer.sendMail({
    from: { name: '八三食堂', address: process.env.CANTEEN_SMTP_USER || '' }, to, subject, text,
  }),
}));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
const web = fileURLToPath(new URL('../web/', import.meta.url));
app.use(express.static(web));
for (const route of ['/', '/canteen']) app.get(route, (_req, res) => res.sendFile(web + 'index.html'));
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`八三食堂 MCP 已启动：${publicUrl}/canteen`);
});
async function close() {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  mailer.close();
  await mongoose.disconnect();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
