// src/config/config.ts
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  companyId: process.env.CWM_COMPANY || '',
  companyUrl: process.env.CWM_SERVER || '',
  publicKey: process.env.CWM_PUBKEY || '',
  privateKey: process.env.CWM_PRIVATEKEY || '',
  clientId: process.env.CWM_CLIENTID || '',
  serverPort: process.env.SERVER_PORT || 8060,
};
