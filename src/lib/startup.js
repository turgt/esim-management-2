import logger from './logger.js';
import bcrypt from 'bcrypt';

const log = logger.child({ module: 'startup' });

export async function bootstrap(db) {
  try {
    const adminExists = await db.User.findOne({ where: { username: 'admin' } });
    if (!adminExists) {
      const password = process.env.ADMIN_PASSWORD || 'admin123';
      const hash = await bcrypt.hash(password, 10);
      await db.User.create({
        username: 'admin',
        passwordHash: hash,
        isAdmin: true,
        isActive: true
      });
      log.info('Admin user created (first-time setup)');
    } else {
      log.debug('Admin user already exists, skipping bootstrap');
    }
  } catch (err) {
    log.error({ err }, 'Bootstrap failed');
  }
}
