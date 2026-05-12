/* ─────────────────────────────────────────────────────────────────────
   Add / Edit User Widget
   Mode: self.ctx.stateParams.userId (truthy = edit) or settings.userId
   Customers: loaded from /api/customers → scope dropdown
   ───────────────────────────────────────────────────────────────────── */

var ufCtx;
var ufRoot;
var ufSubscriptions = [];

var ufState = {
  mode: 'add',
  userId: null,
  originalEmail: null,
  avatarDataUrl: null,
  toastTimer: null,
  saving: false,
  customers: []        /* [{ id: string, title: string }] */
};

/* ─── Lifecycle ─────────────────────────────────────────────────────── */

self.onInit = function () {
  ufCtx  = self.ctx;
  ufRoot = ufCtx.$container[0].querySelector('.uf-root');
  if (!ufRoot) return;

  var params   = ufCtx.stateParams || {};
  var settings = ufCtx.settings    || {};

  ufState.userId = params.userId || settings.userId || null;
  ufState.mode   = ufState.userId ? 'edit' : 'add';

  ufUpdateBreadcrumb(ufState.mode === 'edit' ? 'Loading…' : 'Add user');
  ufBindEvents();

  /* Load customers first, then user data (edit) in parallel */
  ufLoadCustomers(function () {
    if (ufState.mode === 'edit') ufLoadUser(ufState.userId);
  });
};

self.onDataUpdated = function () {};

self.onResize = function () {
  if (!ufRoot) return;
  ufRoot.classList.toggle('uf-narrow', ufRoot.offsetWidth < 600);
};

self.onDestroy = function () {
  ufSubscriptions.forEach(function (s) {
    if (s && s.unsubscribe) s.unsubscribe();
  });
  ufSubscriptions = [];
  if (ufState.toastTimer) clearTimeout(ufState.toastTimer);
  ufRoot = null;
  ufCtx  = null;
};

/* ─── Load Customers ────────────────────────────────────────────────── */

function ufLoadCustomers(onDone) {
  var url = '/api/customers?pageSize=200&page=0&sortProperty=title&sortOrder=ASC';
  var sub = ufCtx.http.get(url).subscribe(
    function (resp) {
      ufState.customers = (resp.data || []).map(function (c) {
        return { id: c.id.id, title: c.title };
      });
      ufBuildScopeOptions();
      if (onDone) onDone();
    },
    function () {
      /* Non-fatal: scope will just show "All sites" */
      ufBuildScopeOptions();
      if (onDone) onDone();
    }
  );
  ufSubscriptions.push(sub);
}

function ufBuildScopeOptions() {
  var select = ufRoot.querySelector('#uf-scope');
  if (!select) return;

  var html = '<option value="all">All sites</option>';
  ufState.customers.forEach(function (c) {
    html += '<option value="' + ufEscapeAttr(c.id) + '">' + ufEscapeHtml(c.title) + '</option>';
  });
  select.innerHTML = html;
}

/* ─── Scope visibility based on Role ───────────────────────────────── */

function ufOnRoleChange(authority) {
  var scopeSelect = ufRoot.querySelector('#uf-scope');
  var scopeField  = scopeSelect && scopeSelect.closest('.uf-field');
  var isCustomer  = authority === 'CUSTOMER_USER';

  if (scopeSelect) {
    scopeSelect.disabled = !isCustomer;
    if (!isCustomer) scopeSelect.value = 'all';
  }
  if (scopeField) {
    scopeField.classList.toggle('uf-field-disabled', !isCustomer);
  }
}

/* ─── Load User (Edit Mode) ─────────────────────────────────────────── */

function ufLoadUser(userId) {
  ufSetLoading(true);
  var sub = ufCtx.http.get('/api/user/' + userId).subscribe(
    function (user) {
      ufSetLoading(false);
      ufPopulateForm(user);
      ufUpdateBreadcrumb('Edit ' + ufUserName(user));
    },
    function () {
      ufSetLoading(false);
      ufShowToast('Failed to load user data.', 'error');
    }
  );
  ufSubscriptions.push(sub);
}

function ufPopulateForm(user) {
  ufSetVal('uf-first-name', user.firstName || '');
  ufSetVal('uf-last-name',  user.lastName  || '');
  ufSetVal('uf-email',      user.email     || '');
  ufSetVal('uf-phone',      (user.additionalInfo && user.additionalInfo.phone) || '');
  ufSetVal('uf-role',       user.authority || '');

  ufState.originalEmail = user.email;

  /* Set scope: customer id if CUSTOMER_USER, else "all" */
  var customerId = user.customerId && user.customerId.id;
  ufSetVal('uf-scope', (user.authority === 'CUSTOMER_USER' && customerId) ? customerId : 'all');
  ufOnRoleChange(user.authority || '');

  if (user.additionalInfo && user.additionalInfo.avatarUrl) {
    ufShowAvatar(user.additionalInfo.avatarUrl);
  }
}

/* ─── Save / Submit ─────────────────────────────────────────────────── */

function ufSubmit() {
  if (ufState.saving) return;
  if (!ufValidate()) return;

  ufState.saving = true;
  ufRoot.querySelector('.uf-confirm-btn').disabled = true;

  var authority  = ufGetVal('uf-role') || 'CUSTOMER_USER';
  var scopeVal   = ufGetVal('uf-scope');
  var customerId = (authority === 'CUSTOMER_USER' && scopeVal && scopeVal !== 'all')
    ? { id: scopeVal, entityType: 'CUSTOMER' }
    : null;

  var payload = {
    email:      ufGetVal('uf-email').trim(),
    firstName:  ufGetVal('uf-first-name').trim(),
    lastName:   ufGetVal('uf-last-name').trim(),
    authority:  authority,
    customerId: customerId,
    additionalInfo: {
      phone: ufGetVal('uf-phone').trim()
    }
  };

  if (ufState.mode === 'edit' && ufState.userId) {
    payload.id = { entityType: 'USER', id: ufState.userId };
  }

  var sub = ufCtx.http.post('/api/user?sendActivationMail=true', payload).subscribe(
    function (saved) {
      ufState.saving = false;
      ufRoot.querySelector('.uf-confirm-btn').disabled = false;
      var name = ufUserName(saved);
      ufShowToast(
        ufState.mode === 'add'
          ? 'User "' + name + '" added successfully.'
          : 'User "' + name + '" updated successfully.',
        'success'
      );
      setTimeout(ufNavigateBack, 1200);
    },
    function (err) {
      ufState.saving = false;
      ufRoot.querySelector('.uf-confirm-btn').disabled = false;
      ufShowToast(
        (err && err.error && err.error.message) || 'Failed to save user.',
        'error'
      );
    }
  );
  ufSubscriptions.push(sub);
}

/* ─── Validation ────────────────────────────────────────────────────── */

function ufValidate() {
  ufClearErrors();
  var ok = true;

  if (!ufGetVal('uf-first-name').trim()) {
    ufShowFieldError('uf-first-name', 'First name is required.');
    ok = false;
  }

  var email = ufGetVal('uf-email').trim();
  if (!email) {
    ufShowFieldError('uf-email', 'Email is required.');
    ok = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    ufShowFieldError('uf-email', 'Enter a valid email address.');
    ok = false;
  }

  if (!ufGetVal('uf-role')) {
    ufShowFieldError('uf-role', 'Role is required.');
    ok = false;
  }

  return ok;
}

function ufShowFieldError(fieldId, msg) {
  var input = ufRoot.querySelector('#' + fieldId);
  var field = input && input.closest('.uf-field');
  var err   = field && field.querySelector('.uf-field-error');
  if (input) input.classList.add('error');
  if (err)   { err.textContent = msg; err.classList.add('visible'); }
}

function ufClearErrors() {
  ufRoot.querySelectorAll('.uf-input.error, .uf-select.error').forEach(function (el) {
    el.classList.remove('error');
  });
  ufRoot.querySelectorAll('.uf-field-error.visible').forEach(function (el) {
    el.textContent = '';
    el.classList.remove('visible');
  });
}

/* ─── Events ────────────────────────────────────────────────────────── */

function ufBindEvents() {
  var confirmBtn = ufRoot.querySelector('.uf-confirm-btn');
  var cancelBtn  = ufRoot.querySelector('.uf-cancel-btn');
  var backBtn    = ufRoot.querySelector('.uf-breadcrumb-back');
  var toastClose = ufRoot.querySelector('.uf-toast-close');
  var fileInput  = ufRoot.querySelector('.uf-avatar-file');
  var roleSelect = ufRoot.querySelector('#uf-role');

  if (confirmBtn) confirmBtn.addEventListener('click', ufSubmit);
  if (cancelBtn)  cancelBtn.addEventListener('click', ufNavigateBack);
  if (backBtn)    backBtn.addEventListener('click', ufNavigateBack);
  if (toastClose) toastClose.addEventListener('click', ufHideToast);

  /* Role change → update scope state */
  if (roleSelect) {
    roleSelect.addEventListener('change', function () {
      ufOnRoleChange(roleSelect.value);
    });
  }

  /* Avatar file picker */
  if (fileInput) {
    fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        ufState.avatarDataUrl = ev.target.result;
        ufShowAvatar(ev.target.result);
      };
      reader.readAsDataURL(file);
    });
  }

  /* Clear error on input */
  ['uf-first-name', 'uf-email'].forEach(function (id) {
    var el = ufRoot.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('input', function () {
      el.classList.remove('error');
      var errEl = el.closest('.uf-field') && el.closest('.uf-field').querySelector('.uf-field-error');
      if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
    });
  });

  /* Init scope state for add mode (default role = empty → disable scope) */
  ufOnRoleChange('');
}

/* ─── Navigation ────────────────────────────────────────────────────── */

function ufNavigateBack() {
  if (ufCtx && ufCtx.stateController) {
    try { ufCtx.stateController.navigateTo('users', {}); return; } catch (e) {}
  }
  if (ufCtx && ufCtx.actionsApi) {
    try { ufCtx.actionsApi.goBack(); } catch (e) {}
  }
}

/* ─── UI Helpers ────────────────────────────────────────────────────── */

function ufSetLoading(on) {
  var el = ufRoot.querySelector('.uf-loading-overlay');
  if (el) el.classList.toggle('visible', on);
}

function ufUpdateBreadcrumb(label) {
  var el = ufRoot.querySelector('.uf-breadcrumb-current');
  if (el) el.textContent = label;
}

function ufShowAvatar(src) {
  var img  = ufRoot.querySelector('.uf-avatar-img');
  var icon = ufRoot.querySelector('.uf-avatar-circle .material-icons');
  if (img)  { img.src = src; img.classList.add('visible'); }
  if (icon) icon.style.display = 'none';
}

function ufShowToast(msg, type) {
  var toast = ufRoot.querySelector('.uf-toast');
  var text  = ufRoot.querySelector('.uf-toast-msg');
  var icon  = ufRoot.querySelector('.uf-toast-icon');
  if (!toast) return;
  if (text) text.textContent = msg;
  if (icon) icon.textContent = type === 'success' ? 'check_circle' : 'error';
  toast.className = 'uf-toast visible uf-toast-' + (type || 'success');
  if (ufState.toastTimer) clearTimeout(ufState.toastTimer);
  ufState.toastTimer = setTimeout(function () {
    ufHideToast();
    ufState.toastTimer = null;
  }, 3000);
}

function ufHideToast() {
  var toast = ufRoot.querySelector('.uf-toast');
  if (toast) toast.classList.remove('visible');
}

/* ─── DOM Helpers ───────────────────────────────────────────────────── */

function ufGetVal(id) {
  var el = ufRoot.querySelector('#' + id);
  return el ? el.value : '';
}

function ufSetVal(id, val) {
  var el = ufRoot.querySelector('#' + id);
  if (el) el.value = val;
}

function ufEscapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ufEscapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;');
}

/* ─── Data Helpers ──────────────────────────────────────────────────── */

function ufUserName(user) {
  if (!user) return '';
  var n = ((user.firstName || '') + ' ' + (user.lastName || '')).trim();
  return n || user.email || 'User';
}
