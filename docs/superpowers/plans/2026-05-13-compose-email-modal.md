# Compose Email Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Compose" button to `/admin/emails` that opens a modal letting admins send a new email to any address using a Quill.js rich text editor, wrapped in the branded DataPatch email template.

**Architecture:** New `composeEmail` controller function in `adminController.js` handles validation and dispatches via the existing `sendMail` + `emailLayout` from `emailService.js`. A single new route `POST /admin/emails/compose` is added to `admin.js`. The entire UI lives in `emails.ejs`: a "Compose" button triggers a hidden modal containing a Quill editor loaded from CDN; the form submits via `fetch` with CSRF header.

**Tech Stack:** Node.js (ES Modules), Express, EJS, Quill.js 1.3.7 (jsDelivr CDN), `node:test` for tests.

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `src/controllers/adminController.js` | Add `composeEmail` export |
| Modify | `src/routes/admin.js` | Import `composeEmail`, add route |
| Modify | `src/views/admin/emails.ejs` | Compose button, modal, Quill CDN, fetch handler, filter dropdown "Custom" |
| Modify | `tests/integration/admin.test.js` | Add compose validation unit tests |

---

## Security Notes

**`quill.root.innerHTML` (read, not write):** Quill's standard API for retrieving composed HTML. We only read from this property and POST it to the server — we never write it back into the DOM. No XSS risk from this read.

**Server-side body:** The `body` HTML is admin-authored content wrapped in `emailLayout()` and sent as an email. The admin is an authenticated trusted actor. The body is never rendered back into any web page. Risk is scoped to email recipients, which is acceptable for an admin-only compose flow.

**No `innerHTML` writes for user data:** All user-visible strings (errors, toast messages, button labels) use `textContent` or direct attribute manipulation — never `innerHTML`. Button state changes use targeted child element manipulation.

---

## Task 1: Unit Tests for Compose Email Validation

**Files:**
- Modify: `tests/integration/admin.test.js`

- [ ] **Step 1: Add compose validation test suite to existing admin.test.js**

Append inside the outer `describe('Admin System', ...)` block (before the closing `});`):

```javascript
  describe('composeEmail validation logic', () => {
    it('accepts valid email addresses', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      assert.ok(emailRegex.test('user@example.com'));
      assert.ok(emailRegex.test('admin+tag@sub.domain.org'));
    });

    it('rejects invalid email addresses', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      assert.ok(!emailRegex.test('notanemail'));
      assert.ok(!emailRegex.test('missing@'));
      assert.ok(!emailRegex.test('@nodomain.com'));
      assert.ok(!emailRegex.test(''));
    });

    it('detects empty Quill body (strips HTML tags)', () => {
      const stripHtml = (html) => html.replace(/<[^>]+>/g, '').trim();
      assert.equal(stripHtml('<p><br></p>'), '');
      assert.equal(stripHtml('<p>  </p>'), '');
      assert.equal(stripHtml(''), '');
      assert.notEqual(stripHtml('<p>Hello world</p>'), '');
      assert.notEqual(stripHtml('<strong>Bold text</strong>'), '');
    });

    it('validates subject max length of 200 chars', () => {
      const maxLen = 200;
      assert.ok('Hello World'.length <= maxLen);
      assert.ok('x'.repeat(201).length > maxLen);
    });

    it('rejects blank subject', () => {
      assert.ok(!''.trim());
      assert.ok(!'   '.trim());
      assert.ok('Valid Subject'.trim());
    });
  });
```

- [ ] **Step 2: Run tests to confirm new tests pass (pure logic, no mocks needed)**

```bash
npm test
```

Expected: all tests pass including the 5 new compose validation tests.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/admin.test.js
git commit -m "test: add compose email validation unit tests"
```

---

## Task 2: Implement composeEmail Controller

**Files:**
- Modify: `src/controllers/adminController.js`

- [ ] **Step 1: Append `composeEmail` export after `replyToEmail` (around line 956)**

```javascript
export async function composeEmail(req, res) {
  try {
    const { to, subject, body } = req.body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!to || !emailRegex.test(to.trim())) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (subject.trim().length > 200) {
      return res.status(400).json({ error: 'Subject must be 200 characters or fewer' });
    }

    const bodyText = body ? body.replace(/<[^>]+>/g, '').trim() : '';
    if (!bodyText) {
      return res.status(400).json({ error: 'Body cannot be empty' });
    }

    const { emailLayout, sendMail } = await import('../services/emailService.js');
    const html = emailLayout(body);
    await sendMail(to.trim(), subject.trim(), html, { type: 'custom', userId: req.session.user.id });

    await logAudit('admin.email_compose', {
      userId: req.session.user.id,
      entity: 'EmailLog',
      details: { to: to.trim(), subject: subject.trim() },
      ipAddress: getIp(req)
    });

    return res.json({ success: true });
  } catch (err) {
    log.error({ err }, 'composeEmail error');
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/controllers/adminController.js
git commit -m "feat: add composeEmail controller"
```

---

## Task 3: Add Route

**Files:**
- Modify: `src/routes/admin.js`

- [ ] **Step 1: Add `composeEmail` to the existing import from adminController.js**

Find this line (around line 8):

```javascript
  listEmails, showEmailDetail, downloadAttachment, replyToEmail,
```

Replace with:

```javascript
  listEmails, showEmailDetail, downloadAttachment, replyToEmail, composeEmail,
```

- [ ] **Step 2: Add the route after the existing email routes**

Find this line (around line 69):

```javascript
router.post('/emails/:id/reply', ensureAuth, ensureAdmin, replyToEmail);
```

Add immediately BEFORE any `router.get('/emails/:id', ...)` routes and immediately after this line:

```javascript
router.post('/emails/compose', ensureAuth, ensureAdmin, composeEmail);
```

**Route order matters:** `POST /emails/compose` must appear before any `GET /emails/:id` pattern to prevent Express from treating "compose" as an `:id` parameter. Since this is a POST and `:id` routes are GET, there is no conflict in practice — but placing it logically near the other email routes is correct.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add POST /admin/emails/compose route"
```

---

## Task 4: Update emails.ejs — Button, Modal, Quill, Filter

**Files:**
- Modify: `src/views/admin/emails.ejs`

- [ ] **Step 1: Add "Compose" button to the page header**

Find this block (lines 3–8):

```html
<div class="mb-8 flex items-center justify-between">
  <div>
    <p class="text-sm text-[var(--text-secondary)] mb-1">Email Management</p>
    <h1 class="text-page-title">Emails</h1>
  </div>
</div>
```

Replace with:

```html
<div class="mb-8 flex items-center justify-between">
  <div>
    <p class="text-sm text-[var(--text-secondary)] mb-1">Email Management</p>
    <h1 class="text-page-title">Emails</h1>
  </div>
  <button onclick="openComposeModal()" class="btn btn-primary inline-flex items-center gap-2">
    <i data-lucide="pencil" class="w-4 h-4"></i>
    Compose
  </button>
</div>
```

- [ ] **Step 2: Add "Custom" option to filter dropdown**

Find (around line 77):

```html
      <option value="esim_activation_failed" <%= typeFilter === 'esim_activation_failed' ? 'selected' : '' %>>Activation Failed</option>
```

Add immediately after:

```html
      <option value="custom" <%= typeFilter === 'custom' ? 'selected' : '' %>>Custom</option>
```

- [ ] **Step 3: Replace the final `<%- include('../partials/footer') %>` with the modal block + footer**

Find the last line of the file:

```html
<%- include('../partials/footer') %>
```

Replace with this entire block (modal + Quill CDN + script + footer):

```html
<!-- Compose Email Modal -->
<div id="composeModal" class="fixed inset-0 z-50 hidden">
  <div class="fixed inset-0 bg-black/50" onclick="closeComposeModal()"></div>
  <div class="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
    <div class="card w-full max-w-2xl pointer-events-auto">
      <div class="card-header">
        <h2 class="card-title flex items-center gap-2">
          <i data-lucide="pencil" class="w-4 h-4"></i> Compose Email
        </h2>
        <button onclick="closeComposeModal()" class="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
      </div>
      <div class="p-5 space-y-4">
        <div id="composeError" class="hidden alert alert-error text-sm"></div>
        <div>
          <label class="block text-sm font-medium mb-1">To</label>
          <input id="composeTo" type="email" placeholder="recipient@example.com" class="input w-full">
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Subject</label>
          <input id="composeSubject" type="text" placeholder="Subject" maxlength="200" class="input w-full">
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Message</label>
          <div id="quillEditor" style="min-height:200px;background:#fff;border-radius:0 0 4px 4px;"></div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="closeComposeModal()" class="btn btn-secondary">Cancel</button>
          <button onclick="submitCompose()" id="composeSendBtn" class="btn btn-primary inline-flex items-center gap-2">
            <i data-lucide="send" class="w-4 h-4" id="composeSendIcon"></i>
            <span id="composeSendLabel">Send Email</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Toast notification -->
<div id="composeToast" class="fixed top-4 right-4 z-[60] hidden max-w-sm"></div>

<!-- Quill CDN (loaded only on this page) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.snow.css">
<script src="https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js"></script>

<script>
(function () {
  var quill;

  window.openComposeModal = function () {
    document.getElementById('composeModal').classList.remove('hidden');
    if (!quill) {
      quill = new Quill('#quillEditor', {
        theme: 'snow',
        modules: {
          toolbar: [
            ['bold', 'italic', 'underline'],
            ['link'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['clean']
          ]
        }
      });
    }
    lucide.createIcons();
  };

  window.closeComposeModal = function () {
    document.getElementById('composeModal').classList.add('hidden');
    var errorEl = document.getElementById('composeError');
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
    document.getElementById('composeTo').value = '';
    document.getElementById('composeSubject').value = '';
    if (quill) { quill.setText(''); }
  };

  window.submitCompose = async function () {
    var to = document.getElementById('composeTo').value.trim();
    var subject = document.getElementById('composeSubject').value.trim();
    var body = quill ? quill.root.innerHTML : '';
    var bodyText = body.replace(/<[^>]+>/g, '').trim();
    var errorEl = document.getElementById('composeError');
    var sendBtn = document.getElementById('composeSendBtn');
    var sendIcon = document.getElementById('composeSendIcon');
    var sendLabel = document.getElementById('composeSendLabel');

    errorEl.textContent = '';
    errorEl.classList.add('hidden');

    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      errorEl.textContent = 'Enter a valid email address.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!subject) {
      errorEl.textContent = 'Subject is required.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!bodyText) {
      errorEl.textContent = 'Message body cannot be empty.';
      errorEl.classList.remove('hidden');
      return;
    }

    sendBtn.disabled = true;
    sendIcon.style.display = 'none';
    sendLabel.textContent = 'Sending…';

    try {
      var res = await fetch('/admin/emails/compose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': '<%= typeof csrfToken !== "undefined" ? csrfToken : "" %>'
        },
        body: JSON.stringify({ to: to, subject: subject, body: body })
      });
      var data = await res.json();

      if (data.success) {
        closeComposeModal();
        showComposeToast('Email sent successfully.', 'success');
      } else {
        errorEl.textContent = data.error || 'Failed to send email.';
        errorEl.classList.remove('hidden');
      }
    } catch (e) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.classList.remove('hidden');
    } finally {
      sendBtn.disabled = false;
      sendIcon.style.display = '';
      sendLabel.textContent = 'Send Email';
      lucide.createIcons();
    }
  };

  function showComposeToast(message, type) {
    var toast = document.getElementById('composeToast');
    toast.className = 'fixed top-4 right-4 z-[60] max-w-sm alert ' +
      (type === 'success' ? 'alert-success' : 'alert-error');
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(function () { toast.classList.add('hidden'); }, 3000);
  }
}());
</script>

<%- include('../partials/footer') %>
```

- [ ] **Step 4: Manually verify the UI**

Start the app:
```bash
docker compose up --build -d
```

Open `http://localhost:3000/admin/emails` and verify:
- [ ] "Compose" button visible top-right
- [ ] Click Compose → modal opens with Quill toolbar
- [ ] Type invalid email → inline error shown (no page reload)
- [ ] Leave body empty → inline error shown
- [ ] Fill valid To, Subject, body → Send → modal closes, green toast appears for 3s
- [ ] Refresh page → new row with type `custom` appears in table
- [ ] Filter dropdown contains "Custom" option
- [ ] Dark mode toggle → modal background and text readable

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/admin/emails.ejs
git commit -m "feat: compose email modal with Quill rich text editor"
```

---

## Done

All tasks complete. The feature is live at `/admin/emails` — "Compose" button opens a modal with Quill editor, sends branded email via Resend, logged as `type: custom` in EmailLog.
