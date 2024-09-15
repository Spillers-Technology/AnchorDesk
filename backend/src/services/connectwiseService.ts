// src/services/connectwiseService.ts
import { ManageAPI } from 'connectwise-rest';
import { config } from '../config/config';

export const cwm = new ManageAPI({
  companyId: config.companyId,
  companyUrl: config.companyUrl,
  publicKey: config.publicKey,
  privateKey: config.privateKey,
  clientId: config.clientId,
  entryPoint: 'v4_6_release',
  apiVersion: '3.0.0',
  timeout: 20000,
  retry: false,
  retryOptions: {
    retries: 4,
    minTimeout: 50,
    maxTimeout: 45000,
    randomize: true,
  },
  debug: true,
});
