import { getAllPackages,getCountryPackages, initialize, isInitialized } from './airaloClient.js';
import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'airalo-sync' });

const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Parse the list of countries to sync from environment variables.
 * Supports AIRALO_COUNTRIES (comma-separated) with fallback to COUNTRY.
 */
function getSyncCountries() {
  return (process.env.AIRALO_COUNTRIES || process.env.COUNTRY || 'TR')
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Sync packages for a single country code.
 * Returns { countryCode, total, upserted } on success.
 */
async function syncCountryPackages(countryCode) {
  const result = await getCountryPackages(countryCode);
  const packages = result?.data || [];

  if (!packages.length) {
    log.warn({ countryCode }, 'No packages returned from Airalo API');
    return { countryCode, total: 0, upserted: 0 };
  }

  let upserted = 0;
  const now = new Date();

  for (const pkg of packages) {
    try {
      // Note: overrideType and overrideValue are intentionally excluded
      // so admin pricing overrides are preserved across syncs
      await db.AiraloPackage.upsert({
        packageId: pkg.package_id || pkg.id,
        slug: pkg.slug || '',
        countryCode,
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

  return { countryCode, total: packages.length, upserted };
}

export async function syncPackages() {
  if (!isInitialized()) {
    log.warn('Airalo not initialized, skipping sync');
    return;
  }

  const countries = getSyncCountries();
  log.info({ countries }, 'Starting Airalo package sync for countries');

  let totalUpserted = 0;
  let totalPackages = 0;
  const failed = [];

  for (const countryCode of countries) {
    try {
      const { total, upserted } = await syncCountryPackages(countryCode);
      totalPackages += total;
      totalUpserted += upserted;
      log.info({ countryCode, total, upserted }, 'Synced packages for country');
    } catch (err) {
      failed.push(countryCode);
      log.warn({ countryCode, err: err.message }, 'Failed to sync country, continuing with others');
    }
  }

  log.info(
    { countriesTotal: countries.length, countriesFailed: failed.length, failed, totalPackages, totalUpserted },
    'Airalo package sync complete'
  );
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
