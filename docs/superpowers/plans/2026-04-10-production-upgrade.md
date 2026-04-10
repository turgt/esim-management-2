# Production Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch production UI from sidebar layout to demo-style topbar+tabbar navigation, and complete the Airalo API migration.

**Architecture:** The production CSS (`input.css`) already contains all v2-equivalent component classes (`.tabbar`, `.topbar`, `.content-area`, `.breadcrumb`, etc.) with dark mode support. The migration is primarily a template rewrite: replace the sidebar-based `header.ejs`/`footer.ejs` with a topbar+tabbar layout matching the demo's `layout.ejs` pattern. Airalo migration is 95% done — only admin dashboard balance, env docs, and a label fix remain.

**Tech Stack:** Express.js, EJS templates, Tailwind CSS v4, Lucide icons, Airalo SDK

---

## File Map

### Workstream 1: Design Migration
| Action | File | Responsibility |
|--------|------|----------------|
| Rewrite | `src/views/partials/header.ejs` | Remove sidebar, add topbar + tabbar + content-area wrapper |
| Rewrite | `src/views/partials/footer.ejs` | Close new layout structure, remove sidebar closing divs |
| Modify | `src/input.css` | Remove sidebar CSS, fine-tune topbar/tabbar/content-area styles |
| Verify | All 16 user templates + 13 admin templates | Ensure they render correctly in new layout |

### Workstream 2: Airalo Completion
| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/controllers/adminController.js:4,25` | Switch balance from Zendit to Airalo |
| Modify | `src/views/admin/dashboard.ejs:21` | Fix "Zendit Balance" label |
| Modify | `.env.example` | Add Airalo/Paddle/Resend env vars |

---

## Task 1: Rewrite header.ejs — Topbar + Tabbar Layout

**Files:**
- Rewrite: `src/views/partials/header.ejs`

This is the core change. Replace the sidebar-based layout with a topbar (top) + tabbar (bottom, mobile only) system. Keep all existing functionality: dark mode, theme toggle, email verification banner, CSRF, Lucide icons, toast system.

- [ ] **Step 1: Rewrite header.ejs**

Replace the entire file with the new topbar+tabbar layout. The key structural changes:
- Remove: Desktop sidebar (`<aside class="sidebar">`) and mobile sidebar overlay
- Remove: `openSidebar()`, `closeSidebar()`, `toggleSidebar()` JS functions
- Add: `<header class="topbar">` with logo, nav links, avatar, theme toggle
- Add: `<nav class="tabbar">` at bottom with Lucide icons for mobile
- Content wrapper: `<main class="content-area">` (or `content-area-wide` for admin)
- Auth pages: Keep `<div class="auth-wrapper">` + `<div class="auth-card">` pattern
- Admin nav: Separate set of topbar links and tabbar items when `user.isAdmin` and on admin pages

Write this content to `src/views/partials/header.ejs`:

```ejs
<!DOCTYPE html>
<html lang="en" class="<%= (typeof user !== 'undefined' && user && user.theme === 'dark') ? 'dark' : '' %>">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= title %> - DataPatch</title>
  <link rel="icon" type="image/svg+xml" href="/public/favicon.svg">
  <link rel="preconnect" href="https://api.fontshare.com" crossorigin>
  <link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800&f[]=general-sans@400,500,600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/public/styles.css?v=<%= Date.now() %>">
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
  <script>
    (function() {
      var saved = localStorage.getItem('theme');
      if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    })();

    function toggleTheme() {
      var isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      updateThemeIcon(isDark);
      <% if (typeof user !== 'undefined' && user) { %>
      fetch('/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'theme=' + (isDark ? 'dark' : 'light') + '&_csrf=<%= typeof csrfToken !== "undefined" ? csrfToken : "" %>'
      }).catch(function() {});
      <% } %>
    }

    function updateThemeIcon(isDark) {
      document.querySelectorAll('.theme-sun').forEach(function(el) { el.style.display = isDark ? 'block' : 'none'; });
      document.querySelectorAll('.theme-moon').forEach(function(el) { el.style.display = isDark ? 'none' : 'block'; });
    }

    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text).then(function() {
        var icon = btn.querySelector('[data-lucide]');
        if (icon) {
          icon.setAttribute('data-lucide', 'check');
          lucide.createIcons();
          setTimeout(function() {
            icon.setAttribute('data-lucide', 'copy');
            lucide.createIcons();
          }, 1500);
        }
        showToast('Copied to clipboard!', 'success');
      });
    }

    function showToast(message, type) {
      type = type || 'success';
      var container = document.getElementById('toast-container');
      if (!container) return;
      var toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(function() { toast.remove(); }, 300);
      }, 4000);
    }
  </script>
</head>

<% if (typeof user !== 'undefined' && user) { %>
<%
  /* Determine if we're on an admin page */
  var _isAdminPage = typeof title !== 'undefined' && (
    title === 'Admin Dashboard' || title === 'Manage Users' || title === 'Admin Panel' ||
    title === 'All Datas' || title === 'Data Detail' || title === 'Assign Data' ||
    title === 'Admin Payments' || title === 'Vendors' || title === 'Vendor Detail' ||
    title === 'Create Vendor' || title === 'Edit Vendor' || title === 'Emails' ||
    title === 'Email Detail' || title === 'Zendit Purchase' ||
    (title && title.includes && (title.includes('Top-up') || title.includes('Top Up') || title.includes('Admin')))
  );
  var _isVendorPage = typeof title !== 'undefined' && title === 'Vendor Dashboard';
%>
<%/* ===== AUTHENTICATED: Topbar + Tabbar Layout ===== */%>
<body class="bg-[var(--surface-1)] text-[var(--text-primary)] font-sans antialiased">

  <!-- Topbar -->
  <header class="topbar">
    <% if (locals.backUrl) { %>
    <a href="<%= backUrl %>" class="topbar-back">
      <i data-lucide="chevron-left" class="w-5 h-5"></i>
      <%= title %>
    </a>
    <% } else { %>
    <a href="/offers" class="topbar-logo">DataPatch</a>
    <% } %>

    <% if (_isAdminPage && user.isAdmin) { %>
    <nav class="topbar-nav">
      <a href="/admin/dashboard" class="<%= title === 'Admin Dashboard' ? 'active' : '' %>">Dashboard</a>
      <a href="/admin/users" class="<%= title === 'Manage Users' || title === 'Admin Panel' ? 'active' : '' %>">Users</a>
      <a href="/admin/esims" class="<%= title === 'All Datas' || title === 'Data Detail' || title === 'Assign Data' ? 'active' : '' %>">All Datas</a>
      <a href="/admin/payments" class="<%= title === 'Admin Payments' ? 'active' : '' %>">Payments</a>
      <a href="/admin/vendors" class="<%= title === 'Vendors' || title === 'Vendor Detail' || title === 'Create Vendor' || title === 'Edit Vendor' ? 'active' : '' %>">Vendors</a>
      <a href="/admin/emails" class="<%= title === 'Emails' || title === 'Email Detail' ? 'active' : '' %>">Emails</a>
      <a href="/admin/zendit/purchase" class="<%= title === 'Zendit Purchase' ? 'active' : '' %>">Zendit</a>
    </nav>
    <% } else if (!locals.backUrl) { %>
    <nav class="topbar-nav">
      <a href="/offers" class="<%= title === 'Offers' ? 'active' : '' %>">Plans</a>
      <a href="/purchases" class="<%= title === 'My Datas' || title === 'My Purchases' || title === 'Purchase Status' || title === 'QR Code' || title === 'Payment' || title === 'Payment Result' || title === 'Top-up Data' ? 'active' : '' %>">My Datas</a>
      <a href="/payment/history" class="<%= title === 'My Payments' || title === 'Receipt' ? 'active' : '' %>">Payments</a>
      <a href="/compatibility" class="<%= title === 'eSIM Compatibility' ? 'active' : '' %>">Compatibility</a>
      <a href="/profile" class="<%= title === 'Profile' ? 'active' : '' %>">Profile</a>
    </nav>
    <% } %>

    <div class="topbar-right">
      <button onclick="toggleTheme()" class="topbar-bell" title="Toggle theme" aria-label="Toggle theme">
        <i data-lucide="sun" class="w-[18px] h-[18px] theme-sun" style="display:none;"></i>
        <i data-lucide="moon" class="w-[18px] h-[18px] theme-moon"></i>
      </button>
      <% if (user.isAdmin && !_isAdminPage) { %>
      <a href="/admin/dashboard" class="topbar-bell" title="Admin Panel" aria-label="Admin Panel">
        <i data-lucide="shield" class="w-[18px] h-[18px]"></i>
      </a>
      <% } else if (_isAdminPage) { %>
      <a href="/offers" class="topbar-bell" title="Back to App" aria-label="Back to App">
        <i data-lucide="arrow-left" class="w-[18px] h-[18px]"></i>
      </a>
      <% } %>
      <a href="/profile" class="topbar-avatar">
        <%= (user.displayName || user.username).charAt(0).toUpperCase() %>
      </a>
    </div>
  </header>

  <% if (locals.backUrl) { %>
  <div class="breadcrumb">
    <a href="<%= _isAdminPage ? '/admin/dashboard' : '/offers' %>">
      <i data-lucide="home" class="w-3.5 h-3.5"></i>
    </a>
    <span class="separator">›</span>
    <span><%= title %></span>
  </div>
  <% } %>

  <% if (user.emailVerified === false && user.email) { %>
  <div id="verify-banner" class="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300 text-center py-2.5 text-sm font-medium">
    <i data-lucide="mail-warning" class="w-4 h-4 inline-block -mt-0.5 mr-1"></i>
    <span id="verify-msg">Your email is not verified. Check your inbox or</span>
    <button type="button" id="resend-btn" onclick="resendVerification()" class="underline font-semibold hover:text-amber-900 dark:hover:text-amber-200 ml-0.5">resend the link</button>
  </div>
  <script>
    function resendVerification() {
      var btn = document.getElementById('resend-btn');
      var msg = document.getElementById('verify-msg');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      fetch('/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': '<%= typeof csrfToken !== "undefined" ? csrfToken : "" %>' }
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          msg.textContent = data.error;
          btn.style.display = 'none';
        } else {
          msg.textContent = data.message;
          btn.style.display = 'none';
          setTimeout(function() {
            msg.textContent = 'Still not received?';
            btn.textContent = 'Resend again';
            btn.disabled = false;
            btn.style.display = 'inline';
          }, 120000);
        }
      })
      .catch(function() {
        msg.textContent = 'Something went wrong. Try again later.';
        btn.style.display = 'none';
      });
    }
  </script>
  <% } %>

  <main class="<%= _isAdminPage ? 'content-area-wide' : 'content-area' %>">

<% } else { %>
<%/* ===== AUTH: Centered Layout ===== */%>
<body class="bg-[var(--surface-1)] text-[var(--text-primary)] font-sans antialiased no-tabbar">
  <div class="auth-wrapper">
    <div class="auth-card">
      <div class="auth-brand">
        <div class="auth-brand-icon">
          <i data-lucide="signal" class="w-6 h-6"></i>
        </div>
        <span class="auth-brand-title">DataPatch</span>
      </div>

<% } %>

<script>
document.addEventListener('DOMContentLoaded', function() {
  lucide.createIcons();
  var isDark = document.documentElement.classList.contains('dark');
  updateThemeIcon(isDark);
});
</script>
```

- [ ] **Step 2: Verify header.ejs renders without syntax errors**

Run: `cd /Users/turgt/Desktop/CODES/esim-management-2 && node -e "import('./src/server.js')" 2>&1 | head -5`

Check that the server starts without EJS compilation errors by hitting a few routes:
```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/auth/login
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/offers
```
Expected: `200` for login (or redirect), `200` or `302` for offers.

---

## Task 2: Rewrite footer.ejs — Close New Layout

**Files:**
- Rewrite: `src/views/partials/footer.ejs`

The footer must close the layout opened by header.ejs. For authenticated users, close `<main>`, add the tabbar, add footer links, add toast container. For auth pages, close the auth-wrapper.

- [ ] **Step 1: Rewrite footer.ejs**

Write this content to `src/views/partials/footer.ejs`:

```ejs
<% if (typeof user !== 'undefined' && user) { %>
  </main>

  <%
    var _isAdminPage = typeof title !== 'undefined' && (
      title === 'Admin Dashboard' || title === 'Manage Users' || title === 'Admin Panel' ||
      title === 'All Datas' || title === 'Data Detail' || title === 'Assign Data' ||
      title === 'Admin Payments' || title === 'Vendors' || title === 'Vendor Detail' ||
      title === 'Create Vendor' || title === 'Edit Vendor' || title === 'Emails' ||
      title === 'Email Detail' || title === 'Zendit Purchase' ||
      (title && title.includes && (title.includes('Top-up') || title.includes('Top Up') || title.includes('Admin')))
    );
  %>

  <!-- Footer Links -->
  <footer class="py-4 mt-auto border-t border-[var(--border-default)] mx-4 sm:mx-6 lg:mx-8">
    <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mb-2">
      <a href="/legal/about" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Hakkimizda</a>
      <a href="/legal/terms" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Hizmet Sartlari</a>
      <a href="/legal/privacy" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Gizlilik</a>
      <a href="/legal/kvkk" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">KVKK</a>
      <a href="/legal/distance-sales" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Mesafeli Satis</a>
      <a href="/legal/delivery-refund" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Teslimat ve Iade</a>
      <a href="/legal/refund" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Iade Politikasi</a>
    </div>
    <div class="flex items-center justify-center gap-3 mb-2">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" class="h-6 w-auto opacity-60"><rect width="48" height="32" rx="4" fill="#1A1F71"/><text x="24" y="20" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold" font-family="Arial,sans-serif">VISA</text></svg>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" class="h-6 w-auto opacity-60"><rect width="48" height="32" rx="4" fill="#252525"/><circle cx="19" cy="16" r="10" fill="#EB001B"/><circle cx="29" cy="16" r="10" fill="#F79E1B"/><path d="M24 8.8a10 10 0 0 1 0 14.4 10 10 0 0 1 0-14.4z" fill="#FF5F00"/></svg>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 32" class="h-6 w-auto opacity-60"><rect width="60" height="32" rx="4" fill="#1E64FF"/><text x="30" y="20" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="Arial,sans-serif">iyzico</text></svg>
    </div>
    <p class="text-xs text-[var(--text-tertiary)] text-center">&copy; <%= new Date().getFullYear() %> DataPatch</p>
  </footer>

  <!-- Tabbar (Mobile) -->
  <% if (_isAdminPage && user.isAdmin) { %>
  <nav class="tabbar">
    <a href="/admin/dashboard" class="<%= title === 'Admin Dashboard' ? 'active' : '' %>">
      <i data-lucide="layout-dashboard" class="w-5 h-5"></i>
      <span>Panel</span>
    </a>
    <a href="/admin/users" class="<%= title === 'Manage Users' || title === 'Admin Panel' ? 'active' : '' %>">
      <i data-lucide="users" class="w-5 h-5"></i>
      <span>Users</span>
    </a>
    <a href="/admin/esims" class="<%= title === 'All Datas' || title === 'Data Detail' || title === 'Assign Data' ? 'active' : '' %>">
      <i data-lucide="layers" class="w-5 h-5"></i>
      <span>eSIM</span>
    </a>
    <a href="/admin/payments" class="<%= title === 'Admin Payments' ? 'active' : '' %>">
      <i data-lucide="credit-card" class="w-5 h-5"></i>
      <span>Payments</span>
    </a>
    <a href="/admin/vendors" class="<%= title === 'Vendors' || title === 'Vendor Detail' ? 'active' : '' %>">
      <i data-lucide="store" class="w-5 h-5"></i>
      <span>Vendors</span>
    </a>
  </nav>
  <% } else { %>
  <nav class="tabbar">
    <a href="/offers" class="<%= title === 'Offers' ? 'active' : '' %>">
      <i data-lucide="globe" class="w-5 h-5"></i>
      <span>Plans</span>
    </a>
    <a href="/purchases" class="<%= title === 'My Datas' || title === 'My Purchases' || title === 'Purchase Status' || title === 'QR Code' || title === 'Payment' || title === 'Payment Result' || title === 'Top-up Data' ? 'active' : '' %>">
      <i data-lucide="smartphone" class="w-5 h-5"></i>
      <span>My Datas</span>
    </a>
    <a href="/payment/history" class="<%= title === 'My Payments' || title === 'Receipt' ? 'active' : '' %>">
      <i data-lucide="receipt" class="w-5 h-5"></i>
      <span>Payments</span>
    </a>
    <a href="/profile" class="<%= title === 'Profile' ? 'active' : '' %>">
      <i data-lucide="user" class="w-5 h-5"></i>
      <span>Profile</span>
    </a>
  </nav>
  <% } %>

  <div id="toast-container" class="toast-container"></div>

<% } else { %>
  <div class="text-center mt-6">
    <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mb-3">
      <a href="/legal/about" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Hakkimizda</a>
      <a href="/legal/terms" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Hizmet Sartlari</a>
      <a href="/legal/privacy" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Gizlilik</a>
      <a href="/legal/kvkk" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">KVKK</a>
      <a href="/legal/distance-sales" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Mesafeli Satis</a>
      <a href="/legal/delivery-refund" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Teslimat ve Iade</a>
      <a href="/legal/refund" class="text-[0.6875rem] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">Iade Politikasi</a>
    </div>
    <div class="flex items-center justify-center gap-3 mb-2">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" class="h-5 w-auto opacity-50"><rect width="48" height="32" rx="4" fill="#1A1F71"/><text x="24" y="20" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold" font-family="Arial,sans-serif">VISA</text></svg>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" class="h-5 w-auto opacity-50"><rect width="48" height="32" rx="4" fill="#252525"/><circle cx="19" cy="16" r="10" fill="#EB001B"/><circle cx="29" cy="16" r="10" fill="#F79E1B"/><path d="M24 8.8a10 10 0 0 1 0 14.4 10 10 0 0 1 0-14.4z" fill="#FF5F00"/></svg>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 32" class="h-5 w-auto opacity-50"><rect width="60" height="32" rx="4" fill="#1E64FF"/><text x="30" y="20" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="Arial,sans-serif">iyzico</text></svg>
    </div>
    <p class="text-xs text-[var(--text-tertiary)]">&copy; <%= new Date().getFullYear() %> DataPatch</p>
  </div>
  </div>
  </div>
<% } %>

<script>
  if (typeof lucide !== 'undefined') lucide.createIcons();
  document.querySelectorAll('form').forEach(function(form) {
    if (form.dataset.noProtect) return;
    form.addEventListener('submit', function() {
      var btn = form.querySelector('button[type="submit"]');
      if (btn && !btn.disabled) {
        btn.disabled = true;
        setTimeout(function() { btn.disabled = false; }, 5000);
      }
    });
  });
</script>
</body>
</html>
```

- [ ] **Step 2: Commit layout rewrite**

```bash
git add src/views/partials/header.ejs src/views/partials/footer.ejs
git commit -m "feat: replace sidebar layout with topbar + tabbar navigation"
```

---

## Task 3: Update CSS — Remove Sidebar, Tune Layout

**Files:**
- Modify: `src/input.css` (lines 429-619 sidebar section)

The sidebar CSS is dead code now. Remove it and ensure the topbar/tabbar/content-area styles handle the layout correctly. The `.topbar`, `.tabbar`, `.content-area`, `.breadcrumb` classes already exist in `input.css` — they were added during the v2 theme work. We just need to:
1. Remove sidebar-related classes (~190 lines)
2. Ensure `.content-area` has proper top padding for the fixed topbar
3. Ensure `.content-area` has proper bottom padding for the fixed tabbar on mobile
4. Switch font imports from Google Fonts Inter to Fontshare Cabinet Grotesk + General Sans (matching demo)

- [ ] **Step 1: Remove sidebar CSS block**

Delete lines 429-619 in `src/input.css` — everything from `.sidebar` through `.sidebar-overlay.open .sidebar-mobile`. Also remove `.mobile-header` block (lines 563-581).

- [ ] **Step 2: Ensure content-area has proper padding for fixed topbar/tabbar**

Verify these rules exist in `src/input.css` (they should from the v2 work):

```css
.content-area {
  padding: 24px 16px 100px;  /* 100px bottom for tabbar */
  max-width: 640px;
  margin: 0 auto;
  width: 100%;
}

/* At 1024px+, tabbar is hidden, reduce bottom padding */
@media (min-width: 1024px) {
  .content-area { max-width: 960px; padding: 32px 24px 48px; }
}
```

If the values differ, update them to match the demo's spacing.

- [ ] **Step 3: Verify body has topbar offset**

The topbar is `position: sticky; top: 0`. Content should flow naturally below it. Verify the `.topbar` has `z-index` set high enough (e.g., `z-index: 100`).

- [ ] **Step 4: Build CSS**

```bash
cd /Users/turgt/Desktop/CODES/esim-management-2 && npm run css:build
```

- [ ] **Step 5: Commit CSS changes**

```bash
git add src/input.css public/styles.css
git commit -m "refactor: remove sidebar CSS, tune topbar/tabbar layout spacing"
```

---

## Task 4: Verify All Routes Return 200

**Files:**
- None (verification only)

- [ ] **Step 1: Start the app and check all routes**

```bash
cd /Users/turgt/Desktop/CODES/esim-management-2 && docker compose up -d
```

Then check each route returns 200 (authenticated routes may redirect to login — that's expected):

```bash
# Auth pages (should return 200)
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/auth/login
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/auth/register
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/auth/forgot-password

# Landing page
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/

# Health check
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health
```

Expected: All return `200`.

- [ ] **Step 2: Log in and check authenticated routes**

Log in via the app and manually check:
- `/offers` — Grid of plans with filter chips
- `/purchases` — Purchase list with stat cards
- `/profile` — Profile form
- `/payment/history` — Payment history list
- `/compatibility` — Compatibility checker

Verify:
- Topbar visible at top with nav links
- Tabbar visible at bottom on mobile viewport
- No sidebar anywhere
- Content is properly centered

- [ ] **Step 3: Check admin routes**

Navigate to `/admin/dashboard` and verify:
- Admin topbar nav shows Dashboard, Users, All Datas, Payments, Vendors, Emails, Zendit
- Admin tabbar shows on mobile
- All admin pages render without EJS errors

---

## Task 5: Airalo — Fix Admin Dashboard Balance

**Files:**
- Modify: `src/controllers/adminController.js` (lines 4, 24-28)
- Modify: `src/views/admin/dashboard.ejs` (line 21)

- [ ] **Step 1: Update adminController.js import**

At line 4, add Airalo balance import:

```javascript
// Change this line:
import { listOffers, purchaseEsim as zenditPurchaseEsim, getUsage as zenditGetUsage, getBalance as zenditGetBalance, getEsimPlans, normalizeStatus } from '../services/zenditClient.js';
import { createOrder as airaloCreateOrder, getUsage as airaloGetUsage } from '../services/airaloClient.js';

// To:
import { listOffers, purchaseEsim as zenditPurchaseEsim, getUsage as zenditGetUsage, getBalance as zenditGetBalance, getEsimPlans, normalizeStatus } from '../services/zenditClient.js';
import { createOrder as airaloCreateOrder, getUsage as airaloGetUsage, getBalance as airaloGetBalance } from '../services/airaloClient.js';
```

- [ ] **Step 2: Update showDashboard balance logic**

Replace lines 24-28:

```javascript
// Change:
    let balance = null;
    try {
      balance = await zenditGetBalance();
    } catch (e) {
      log.warn({ err: e }, 'Could not fetch balance');
    }

// To:
    let balance = null;
    try {
      balance = await airaloGetBalance();
    } catch (e) {
      log.warn({ err: e }, 'Could not fetch Airalo balance, trying Zendit');
      try {
        balance = await zenditGetBalance();
      } catch (e2) {
        log.warn({ err: e2 }, 'Could not fetch Zendit balance either');
      }
    }
```

- [ ] **Step 3: Update dashboard.ejs label**

In `src/views/admin/dashboard.ejs` line 21, change:

```ejs
<!-- From: -->
<p class="stat-label">Zendit Balance</p>

<!-- To: -->
<p class="stat-label">Provider Balance</p>
```

- [ ] **Step 4: Update balance display for Airalo format**

The Airalo balance response format differs from Zendit. Check `airaloClient.js` `getBalance()` return format and update the dashboard template's balance display logic accordingly. The Airalo SDK returns `{ data: { balance: 123.45, currency: 'USD' } }` format.

Update line 22 in `src/views/admin/dashboard.ejs`:

```ejs
<!-- From: -->
<p class="stat-value text-[var(--brand-primary)]"><%= typeof balance !== 'undefined' && balance ? '$' + Number((balance.availableBalance / (balance.currencyDivisor || 100)).toFixed(2)).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-' %></p>

<!-- To: -->
<p class="stat-value text-[var(--brand-primary)]"><%= typeof balance !== 'undefined' && balance ? (balance.currency || '$') + ' ' + (typeof balance.balance === 'number' ? balance.balance.toLocaleString('en-US', {minimumFractionDigits: 2}) : (balance.availableBalance ? Number((balance.availableBalance / (balance.currencyDivisor || 100)).toFixed(2)).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-')) : '-' %></p>
```

This handles both Airalo format (`{ balance, currency }`) and Zendit format (`{ availableBalance, currencyDivisor }`).

- [ ] **Step 5: Commit**

```bash
git add src/controllers/adminController.js src/views/admin/dashboard.ejs
git commit -m "fix: switch admin dashboard balance from Zendit to Airalo with fallback"
```

---

## Task 6: Airalo — Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add missing environment variables**

Append the following to `.env.example`:

```env
# Airalo API
AIRALO_CLIENT_ID=your-airalo-client-id
AIRALO_CLIENT_SECRET=your-airalo-client-secret
AIRALO_ENV=sandbox

# Payment (Paddle)
PADDLE_API_KEY=
PADDLE_CLIENT_TOKEN=
PADDLE_WEBHOOK_SECRET=
PADDLE_PRODUCT_ID=

# Email (Resend) - alternative to SMTP
RESEND_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add Airalo, Paddle, and Resend env vars to .env.example"
```

---

## Task 7: Final Verification & Smoke Test

**Files:**
- None (verification only)

- [ ] **Step 1: Restart the application**

```bash
cd /Users/turgt/Desktop/CODES/esim-management-2 && docker compose restart app
```

- [ ] **Step 2: Visual smoke test**

Open browser and check:
1. `http://localhost:3000/auth/login` — Auth card centered, no topbar/tabbar
2. `http://localhost:3000/offers` (logged in) — Topbar with Plans/My Datas/Payments/Compatibility/Profile nav
3. Resize browser to mobile width — Tabbar appears at bottom, topbar nav links hide
4. `http://localhost:3000/admin/dashboard` — Admin topbar nav, admin tabbar on mobile
5. `http://localhost:3000/admin/dashboard` — "Provider Balance" label (not "Zendit Balance")
6. Dark mode toggle works from topbar

- [ ] **Step 3: Check for console errors**

Open browser DevTools and verify no JavaScript errors on:
- Login page
- Offers page
- Status page
- Admin dashboard

Expected: Lucide icons render, no 404s for CSS/JS, no EJS errors.

- [ ] **Step 4: Push to deploy**

```bash
git push origin main
```
