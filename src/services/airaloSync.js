import { getAllPackages,getCountryPackages, initialize, isInitialized } from './airaloClient.js';
import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'airalo-sync' });

const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour

export async function syncPackages() {
  if (!isInitialized()) {
    log.warn('Airalo not initialized, skipping sync');
    return;
  }

  try {
    log.info('Starting Airalo package sync');
    //const result = await getAllPackages();
    const countryCode = process.env.COUNTRY || 'TR'; // Optionally filter by country
    const result = await getCountryPackages(countryCode); // New method to fetch SIM packages with more details
    const packages = result?.data || [];

    if (!packages.length) {
      log.warn('No packages returned from Airalo API');
      return;
    }

    let upserted = 0;
    const now = new Date();

    for (const pkg of packages) {
      try {
        await db.AiraloPackage.upsert({
          packageId: pkg.package_id || pkg.id,
          slug: pkg.slug || '',
          //countryCode: pkg.country_code || null,
          countryCode: countryCode,
          title: pkg.title || '',
          operatorTitle: pkg.operator_title || pkg.operator?.title || '',
          type: pkg.type || 'local',
          data: pkg.data || '',
          day: pkg.day || 0,
          amount: pkg.amount || 0,
          price: pkg.price || 0,
          netPrice: pkg.net_price || 0,
          isUnlimited: pkg.is_unlimited || false,
          voice: pkg.voice || null,
          text: pkg.text || null,
          rechargeability: pkg.rechargeability || false,
          imageUrl: pkg.image?.url || pkg.operator?.image?.url || null,
          rawData: pkg,
          lastSyncedAt: now,
        });
        upserted++;
      } catch (err) {
        log.error({ err, packageId: pkg.package_id || pkg.id }, 'Failed to upsert package');
      }
    }

    log.info({ total: packages.length, upserted }, 'Airalo package sync complete');
  } catch (err) {
    log.error({ err }, 'Airalo package sync failed');
  }
}

export async function startSync() {
  try {
    await initialize();

    if (!isInitialized()) {
      log.warn('Airalo not initialized, sync will not start');
      return;
    }

    // Initial sync on startup
    await syncPackages();

    // Schedule hourly sync
    setInterval(syncPackages, SYNC_INTERVAL);
    log.info({ intervalMs: SYNC_INTERVAL }, 'Airalo package sync scheduled');
  } catch (err) {
    log.error({ err }, 'Failed to start Airalo sync');
  }
}
