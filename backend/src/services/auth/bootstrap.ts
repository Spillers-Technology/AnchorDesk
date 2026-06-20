/**
 * First-boot auth bootstrap: seed the AuthSetting row from env, and create the
 * initial local admin when the users table is empty. Idempotent — safe to run
 * on every start. Never overwrites an existing admin or password.
 */
import { FastifyBaseLogger } from 'fastify';
import { config } from '../../config/config';
import * as userRepo from '../../repositories/userRepository';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password';
import { ensureAuthSettings } from './authConfig';

export async function bootstrapAuth(log: FastifyBaseLogger): Promise<void> {
  await ensureAuthSettings();

  const userCount = await userRepo.count();
  if (userCount > 0) return;

  const { username, password, email } = config.bootstrapAdmin;

  if (!password) {
    log.warn(
      'No users exist and BOOTSTRAP_ADMIN_PASSWORD is unset. ' +
        'Set it (and AUTH_SESSION_SECRET) to create the first admin, or use OIDC/SAML SSO. ' +
        'With OIDC_DISABLED=true, all requests run as the dev admin.'
    );
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    log.error(`BOOTSTRAP_ADMIN_PASSWORD is too short (min ${MIN_PASSWORD_LENGTH}); admin not created.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const admin = await userRepo.createLocal(
    { username, passwordHash, email, role: 'admin', displayName: username },
    'bootstrap'
  );
  log.info(`Created bootstrap admin '${admin.username}' (id ${admin.id}). Change the password after first login.`);
}
