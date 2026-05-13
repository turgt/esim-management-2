# Compose Email Modal — Design Spec

**Date:** 2026-05-13  
**Branch:** `chore/h5-csp-prep`  
**Status:** Approved

---

## Overview

Add a "Compose" button to `/admin/emails` that opens a modal allowing admins to send a new email to any address. Email body uses Quill.js rich text editor (CDN) and is wrapped in the existing branded `emailLayout()` template before sending via Resend.

---

## Architecture & Data Flow

**New files/changes:**
- `src/views/admin/emails.ejs` — Compose button, modal HTML, Quill init, fetch handler
- `src/controllers/adminController.js` — `composeEmail` function
- `src/routes/admin.js` — `POST /admin/emails/compose`

**Flow:**
1. Admin clicks "Compose" → modal opens
2. Fills: To (free-text email), Subject (text), Body (Quill rich text)
3. Submit → `fetch POST /admin/emails/compose` with JSON + `X-CSRF-Token` header
4. Controller validates → wraps body in `emailLayout()` → calls `sendMail()`
5. `sendMail()` sends via Resend and writes EmailLog (`type: 'custom'`)
6. Response `{ success: true }` → modal closes, success toast shown
7. Response `{ error }` → inline error shown in modal

**EmailLog type:** `'custom'` (new type)  
`emails.ejs` filter dropdown gets a new "Custom" option.

---

## UI Components

### Compose Button
Added to the existing `<div class="mb-8 flex items-center justify-between">` header on `emails.ejs` (right side), using existing `.btn .btn-primary` styles.

### Modal Layout
```
┌─────────────────────────────────────┐
│ Compose Email              [×]      │
├─────────────────────────────────────┤
│ To:      [email input]              │
│ Subject: [text input]               │
│ ┌─────────────────────────────────┐ │
│ │  Quill toolbar (B I U | link)   │ │
│ │  body area (~200px)             │ │
│ └─────────────────────────────────┘ │
│ [error message if any]              │
│              [Cancel] [Send Email]  │
└─────────────────────────────────────┘
```

Modal uses existing `.card` and `.btn` CSS classes. Backdrop: fixed overlay with `bg-black/50`. Closes on backdrop click or Cancel.

### Quill Editor
- **CDN:** `quill@1.3.7` from jsDelivr (JS + Snow theme CSS)
- **Loaded only in `emails.ejs`** (not globally)
- **Toolbar:** bold, italic, underline, link, ordered list, bullet list, clean
- **Submit:** `quill.root.innerHTML` sent as body string

### Toast Feedback
- Success: green `.alert` style, 3s auto-dismiss
- Error: red `.alert` style, persists until next action
- Appended to page top, uses existing project alert classes

---

## Backend

### Route
```
POST /admin/emails/compose
Middleware: ensureAuth, ensureAdmin
Content-Type: application/json
```

### Controller: `composeEmail`
```
Input: req.body = { to, subject, body }

Validation:
  - to: required, RFC email regex
  - subject: required, non-empty, max 200 chars
  - body: required; server strips HTML tags, rejects if remaining
           text content is empty (handles Quill empty state "<p><br></p>")

Success path:
  html = emailLayout(body)
  sendMail(to, subject, html, { type: 'custom', userId: req.user.id })
  res.json({ success: true })

Error path:
  res.status(400).json({ error: '<message>' })
```

### CSRF
Request sends `X-CSRF-Token: <csrfToken>` header. Existing CSRF middleware supports header-based tokens.

### Rate Limiting
Admin routes already covered by existing rate limit config.

---

## Testing

### Unit Tests (`node:test`)
- `composeEmail` with valid input → `sendMail` called once
- `composeEmail` with invalid email → 400 + error message
- `composeEmail` with empty subject → 400
- `composeEmail` with Quill empty body (`<p><br></p>`) → 400

### Integration Tests
- `POST /admin/emails/compose` authenticated admin → 200
- `POST /admin/emails/compose` unauthenticated → redirect/401
- EmailLog entry created with `type: 'custom'`

### Manual Smoke
- [ ] Compose button visible on `/admin/emails`
- [ ] Modal opens on click, closes on Cancel / backdrop click
- [ ] Invalid email address shows inline error
- [ ] Empty body shows inline error
- [ ] Successful send: modal closes + green toast + new row in email list with type `custom`
- [ ] Dark mode renders correctly

---

## Out of Scope
- Attachments
- CC / BCC fields
- Draft saving
- Template selection (existing `/admin/test-emails` covers this)
- Recipient autocomplete from user list
