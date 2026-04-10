import db from '../db/models/index.js';

/**
 * Calculate the final price for a package given its override settings and the global markup.
 * @param {object} pkg - AiraloPackage instance or plain object with price, overrideType, overrideValue
 * @param {number} globalMarkup - Global markup percentage (e.g. 20 for 20%)
 * @returns {number} Final price rounded to 2 decimal places
 */
export function calcFinalPrice(pkg, globalMarkup) {
  const basePrice = parseFloat(pkg.price) || 0;
  const overrideVal = pkg.overrideValue !== null && pkg.overrideValue !== undefined
    ? parseFloat(pkg.overrideValue) : null;

  if (pkg.overrideType === 'fixed' && overrideVal !== null) {
    return Math.round(overrideVal * 100) / 100;
  }

  if (pkg.overrideType === 'markup' && overrideVal !== null) {
    return Math.round(basePrice * (1 + overrideVal / 100) * 100) / 100;
  }

  // No override — apply global markup
  const markup = parseFloat(globalMarkup) || 0;
  return Math.round(basePrice * (1 + markup / 100) * 100) / 100;
}

/**
 * Get the global markup percentage from Settings.
 * Returns 0 if not found.
 */
export async function getGlobalMarkup() {
  const setting = await db.Setting.findByPk('global_markup_percent');
  return setting ? parseFloat(setting.value) || 0 : 0;
}

/**
 * Set the global markup percentage.
 * @param {number} value - Markup percentage
 */
export async function setGlobalMarkup(value) {
  await db.Setting.upsert({
    key: 'global_markup_percent',
    value: String(value),
  });
}
