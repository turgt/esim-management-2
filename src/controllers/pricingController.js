import db from '../db/models/index.js';
import { calcFinalPrice, getGlobalMarkup, setGlobalMarkup } from '../services/pricingService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'pricing' });

/**
 * GET /admin/pricing — Show pricing management page
 */
export async function showPricing(req, res) {
  try {
    const globalMarkup = await getGlobalMarkup();

    const packages = await db.AiraloPackage.findAll({
      order: [['countryCode', 'ASC'], ['price', 'ASC']],
    });

    // Group by country
    const countryGroups = {};
    for (const pkg of packages) {
      const cc = pkg.countryCode || 'OTHER';
      if (!countryGroups[cc]) countryGroups[cc] = [];
      countryGroups[cc].push({
        id: pkg.id,
        packageId: pkg.packageId,
        title: pkg.title,
        operatorTitle: pkg.operatorTitle,
        data: pkg.data,
        day: pkg.day,
        price: parseFloat(pkg.price) || 0,
        netPrice: parseFloat(pkg.netPrice) || 0,
        overrideType: pkg.overrideType || 'none',
        overrideValue: pkg.overrideValue !== null ? parseFloat(pkg.overrideValue) : null,
        finalPrice: calcFinalPrice(pkg, globalMarkup),
        isUnlimited: pkg.isUnlimited,
      });
    }

    res.render('admin/pricing', {
      title: 'Pricing',
      globalMarkup,
      countryGroups,
      packageCount: packages.length,
      pricingSuccess: req.session.pricingSuccess || null,
      pricingError: req.session.pricingError || null,
    });

    // Clear flash messages after rendering
    delete req.session.pricingSuccess;
    delete req.session.pricingError;
  } catch (err) {
    log.error({ err }, 'showPricing error');
    res.render('error', { message: 'Failed to load pricing page' });
  }
}

/**
 * POST /admin/pricing/global-markup — Update global markup
 */
export async function updateGlobalMarkup(req, res) {
  try {
    const value = parseFloat(req.body.globalMarkup);
    if (isNaN(value) || value < 0) {
      req.session.pricingError = 'Invalid markup value';
      return res.redirect('/admin/pricing');
    }

    await setGlobalMarkup(value);
    log.info({ globalMarkup: value, admin: req.session.user.username }, 'Global markup updated');
    req.session.pricingSuccess = 'Global markup updated to ' + value + '%';
    res.redirect('/admin/pricing');
  } catch (err) {
    log.error({ err }, 'updateGlobalMarkup error');
    req.session.pricingError = 'Failed to update global markup';
    res.redirect('/admin/pricing');
  }
}

/**
 * POST /admin/pricing/preview — Preview price changes without saving
 * Body: { globalMarkup?: number, overrides: [{ packageId, type, value }] }
 */
export async function previewChanges(req, res) {
  try {
    const { globalMarkup: newGlobalMarkup, overrides } = req.body;
    const currentGlobalMarkup = await getGlobalMarkup();
    const effectiveMarkup = newGlobalMarkup !== undefined && newGlobalMarkup !== null
      ? parseFloat(newGlobalMarkup) : currentGlobalMarkup;

    const overrideMap = {};
    if (Array.isArray(overrides)) {
      for (const o of overrides) {
        overrideMap[o.packageId] = { type: o.type, value: o.value !== null ? parseFloat(o.value) : null };
      }
    }

    const packages = await db.AiraloPackage.findAll();
    const changes = [];

    for (const pkg of packages) {
      const oldFinal = calcFinalPrice(pkg, currentGlobalMarkup);

      const override = overrideMap[pkg.packageId];
      const virtualPkg = {
        price: pkg.price,
        overrideType: override ? override.type : pkg.overrideType,
        overrideValue: override ? override.value : pkg.overrideValue,
      };
      const newFinal = calcFinalPrice(virtualPkg, effectiveMarkup);

      if (Math.abs(oldFinal - newFinal) > 0.001) {
        changes.push({
          packageId: pkg.packageId,
          title: pkg.title,
          operatorTitle: pkg.operatorTitle,
          countryCode: pkg.countryCode,
          netPrice: parseFloat(pkg.netPrice) || 0,
          oldPrice: oldFinal,
          newPrice: newFinal,
          profit: Math.round((newFinal - (parseFloat(pkg.netPrice) || 0)) * 100) / 100,
        });
      }
    }

    res.json({ changes, effectiveMarkup });
  } catch (err) {
    log.error({ err }, 'previewChanges error');
    res.status(500).json({ error: 'Failed to preview changes' });
  }
}

/**
 * POST /admin/pricing/override — Save package overrides (bulk)
 * Body: { overrides: [{ packageId, type, value }] }
 */
export async function saveOverrides(req, res) {
  try {
    const { overrides } = req.body;
    if (!Array.isArray(overrides) || overrides.length === 0) {
      return res.status(400).json({ error: 'No overrides provided' });
    }

    let updated = 0;
    for (const o of overrides) {
      const type = ['none', 'fixed', 'markup'].includes(o.type) ? o.type : 'none';
      const value = type === 'none' ? null : (parseFloat(o.value) || null);

      const [count] = await db.AiraloPackage.update(
        { overrideType: type, overrideValue: value },
        { where: { packageId: o.packageId } }
      );
      updated += count;
    }

    log.info({ updated, total: overrides.length, admin: req.session.user.username }, 'Package overrides saved');
    res.json({ success: true, updated });
  } catch (err) {
    log.error({ err }, 'saveOverrides error');
    res.status(500).json({ error: 'Failed to save overrides' });
  }
}

/**
 * POST /admin/pricing/reset/:packageId — Reset a package to no override
 */
export async function resetOverride(req, res) {
  try {
    const { packageId } = req.params;
    await db.AiraloPackage.update(
      { overrideType: 'none', overrideValue: null },
      { where: { packageId } }
    );

    log.info({ packageId, admin: req.session.user.username }, 'Package override reset');
    res.json({ success: true });
  } catch (err) {
    log.error({ err }, 'resetOverride error');
    res.status(500).json({ error: 'Failed to reset override' });
  }
}
