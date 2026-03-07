import { body, validationResult } from 'express-validator';

// Collect validation errors and return response
export function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(e => e.msg);
    // For API-like requests
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(400).json({ errors: errorMessages });
    }
    // For form submissions - store errors in session and redirect back
    req.session.validationErrors = errorMessages;
    req.session.formData = req.body;
    return res.redirect('back');
  }
  next();
}

export const registerRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers and underscores')
    .escape(),
  body('email')
    .trim()
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  body('displayName')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Display name must be at most 50 characters')
    .escape()
];

export const loginRules = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username or email is required'),
  body('password')
    .notEmpty().withMessage('Password is required')
];

export const profileUpdateRules = [
  body('displayName')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Display name must be at most 50 characters')
    .escape(),
  body('phone')
    .optional()
    .trim()
    .matches(/^[+]?[\d\s()-]*$/).withMessage('Please enter a valid phone number'),
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail()
];

export const passwordChangeRules = [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('New password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('New password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('New password must contain at least one number'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
];

export const adminCreateUserRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers and underscores')
    .escape(),
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('esimLimit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('eSIM limit must be between 1 and 100')
];

export const assignEsimRules = [
  body('userId')
    .isInt({ min: 1 }).withMessage('Please select a valid user'),
  body('offerId')
    .trim()
    .notEmpty().withMessage('Please select an offer')
];

export const topupRules = [
  body('offerId')
    .trim()
    .notEmpty().withMessage('Please select an offer for top-up')
];

export const forgotPasswordRules = [
  body('email')
    .trim()
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail()
];

export const resetPasswordRules = [
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
];
