/* ─────────────────────────────────────────────────────────────────────
   Users Management Widget
   ThingsBoard custom widget — HTML/CSS/JS tab implementation

   Layout matches: Figma node 2300:107484 "Desktop - Users" (body only)
   Data source:    ThingsBoard REST API  /api/users?pageSize=N&page=N
   ───────────────────────────────────────────────────────────────────── */

var uwCtx;
var uwRoot;
var uwSubscriptions = [];

var uwState = {
  users: [],
  filteredUsers: [],
  activeFilter: 'all',
  page: 0,
  pageSize: 10,
  totalPages: 0,
  totalElements: 0,
  loading: false,
  toastTimer: null
};

/* ─── Lifecycle ─────────────────────────────────────────────────────── */

self.onInit = function () {
  uwCtx = self.ctx;
  uwRoot = uwCtx.$container[0].querySelector('.uw-root');

  if (!uwRoot) {
    console.error('[users-widget] .uw-root not found in container');
    return;
  }

  uwState.pageSize = (uwCtx.settings && uwCtx.settings.pageSize) ? parseInt(uwCtx.settings.pageSize) : 10;

  uwBindEvents();
  uwLoadUsers();
};

self.onDataUpdated = function () {
  /* Not used — widget fetches data directly via REST, not entity subscription */
};

self.onResize = function () {
  if (!uwRoot) return;
  var width = uwRoot.offsetWidth;
  uwRoot.classList.toggle('uw-micro',  width < 520);
  uwRoot.classList.toggle('uw-narrow', width >= 520 && width < 760);
};

self.onDestroy = function () {
  uwSubscriptions.forEach(function (sub) {
    if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe();
  });
  uwSubscriptions = [];
  if (uwState.toastTimer) clearTimeout(uwState.toastTimer);
  uwRoot = null;
  uwCtx = null;
};

/* ─── Event Binding ─────────────────────────────────────────────────── */

function uwBindEvents() {
  /* Role filter chips */
  var chips = uwRoot.querySelectorAll('.uw-filter-chip');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      uwSetFilter(chip.getAttribute('data-filter'));
    });
  });

  /* Prev / Next pagination */
  var prevBtn = uwRoot.querySelector('.uw-prev-btn');
  var nextBtn = uwRoot.querySelector('.uw-next-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      if (uwState.page > 0) {
        uwState.page--;
        uwLoadUsers();
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      if (uwState.page < uwState.totalPages - 1) {
        uwState.page++;
        uwLoadUsers();
      }
    });
  }

  /* Add user */
  var addBtn = uwRoot.querySelector('.uw-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      if (uwCtx.actionsApi && typeof uwCtx.actionsApi.handleWidgetAction === 'function') {
        uwCtx.actionsApi.handleWidgetAction({}, { id: 'addUser' }, null, null, null, null);
      }
    });
  }

  /* Assign scope */
  var assignBtn = uwRoot.querySelector('.uw-assign-btn');
  if (assignBtn) {
    assignBtn.addEventListener('click', function () {
      uwShowToast('Please select at least one user to assign scope.', 'error');
    });
  }

  /* Toast close */
  var toastClose = uwRoot.querySelector('.uw-toast-close');
  if (toastClose) {
    toastClose.addEventListener('click', function () {
      uwHideToast();
    });
  }

  /* Error retry */
  var retryBtn = uwRoot.querySelector('.uw-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      uwLoadUsers();
    });
  }

  /* Row actions — event delegation on tbody */
  var tbody = uwRoot.querySelector('.uw-tbody');
  if (tbody) {
    tbody.addEventListener('click', function (e) {
      var btn = e.target.closest('.uw-icon-btn');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var userId = btn.getAttribute('data-id');
      var user = uwFindUser(userId);
      if (!user) return;
      if (action === 'edit')     uwHandleEdit(user);
      if (action === 'delete')   uwHandleDelete(user);
      if (action === 'navigate') uwHandleNavigate(user);
    });
  }
}

/* ─── Data Loading ──────────────────────────────────────────────────── */

function uwLoadUsers() {
  uwSetLoading(true);
  uwHideError();

  var qs = '?pageSize=' + uwState.pageSize +
           '&page='     + uwState.page +
           '&sortProperty=createdTime&sortOrder=DESC';

  var sub = uwCtx.http.get('/api/users' + qs).subscribe(
    function (resp) {
      uwState.users         = resp.data          || [];
      uwState.totalElements = resp.totalElements || 0;
      uwState.totalPages    = resp.totalPages    || 1;
      uwSetLoading(false);
      uwApplyFilter();
    },
    function (err) {
      uwSetLoading(false);
      var msg = (err && err.error && err.error.message) ? err.error.message : 'Unable to load users.';
      uwShowError(msg);
    }
  );
  uwSubscriptions.push(sub);
}

/* ─── Filter ────────────────────────────────────────────────────────── */

function uwSetFilter(filter) {
  uwState.activeFilter = filter;
  uwState.page = 0;

  var chips = uwRoot.querySelectorAll('.uw-filter-chip');
  chips.forEach(function (chip) {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === filter);
    chip.setAttribute('aria-pressed', chip.getAttribute('data-filter') === filter ? 'true' : 'false');
  });

  uwApplyFilter();
}

function uwApplyFilter() {
  if (uwState.activeFilter === 'all') {
    uwState.filteredUsers = uwState.users.slice();
  } else {
    uwState.filteredUsers = uwState.users.filter(function (u) {
      return u.authority === uwState.activeFilter;
    });
  }
  uwRenderTable();
  uwRenderPagination();
}

/* ─── Table Rendering ───────────────────────────────────────────────── */

function uwRenderTable() {
  var tbody = uwRoot.querySelector('.uw-tbody');
  var empty = uwRoot.querySelector('.uw-empty-state');
  if (!tbody) return;

  if (!uwState.filteredUsers.length) {
    tbody.innerHTML = '';
    if (empty) { empty.classList.add('visible'); }
    return;
  }
  if (empty) { empty.classList.remove('visible'); }

  tbody.innerHTML = uwState.filteredUsers.map(function (user) {
    return uwBuildRow(user);
  }).join('');
}

function uwBuildRow(user) {
  var name       = uwUserName(user);
  var email      = uwEscape(user.email || '');
  var role       = uwFormatRole(user.authority);
  var scope      = uwEscape(uwUserScope(user));
  var status     = uwUserStatus(user);
  var statusCls  = status === 'Active' ? 'uw-badge-positive' : 'uw-badge-negative';
  var lastActive = uwEscape(uwLastActive(user));
  var uid        = uwEscape(user.id.id);

  return '<tr class="uw-row">' +
    '<td class="uw-col-user">' + uwEscape(name) + '</td>' +
    '<td class="uw-col-email">' + email + '</td>' +
    '<td class="uw-col-role"><span class="uw-badge uw-badge-info">' + uwEscape(role) + '</span></td>' +
    '<td class="uw-col-scope">' + scope + '</td>' +
    '<td class="uw-col-status"><span class="uw-badge ' + statusCls + '">' + status + '</span></td>' +
    '<td class="uw-col-last-active">' + lastActive + '</td>' +
    '<td class="uw-col-actions">' +
      '<div class="uw-actions-cell">' +
        '<button class="uw-icon-btn" data-action="edit"     data-id="' + uid + '" title="Edit user">' +
          '<span class="material-icons">edit</span>' +
        '</button>' +
        '<button class="uw-icon-btn" data-action="delete"   data-id="' + uid + '" title="Delete user">' +
          '<span class="material-icons">delete</span>' +
        '</button>' +
        '<button class="uw-icon-btn" data-action="navigate" data-id="' + uid + '" title="View details">' +
          '<span class="material-icons">chevron_right</span>' +
        '</button>' +
      '</div>' +
    '</td>' +
  '</tr>';
}

/* ─── Pagination Rendering ──────────────────────────────────────────── */

function uwRenderPagination() {
  var container = uwRoot.querySelector('.uw-page-numbers');
  var prevBtn   = uwRoot.querySelector('.uw-prev-btn');
  var nextBtn   = uwRoot.querySelector('.uw-next-btn');
  if (!container) return;

  var total = Math.max(uwState.totalPages, 1);
  var cur   = uwState.page;

  prevBtn.disabled = cur === 0;
  nextBtn.disabled = cur >= total - 1;

  /* Show at most 7 page buttons with ellipsis logic */
  var pages = uwPageRange(cur, total, 7);
  container.innerHTML = pages.map(function (p) {
    if (p === '…') {
      return '<span class="uw-page-ellipsis">…</span>';
    }
    return '<button class="uw-page-num' + (p === cur ? ' active' : '') +
           '" data-page="' + p + '">' + (p + 1) + '</button>';
  }).join('');

  container.querySelectorAll('.uw-page-num').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = parseInt(btn.getAttribute('data-page'), 10);
      if (p !== uwState.page) {
        uwState.page = p;
        uwLoadUsers();
      }
    });
  });
}

function uwPageRange(current, total, maxVisible) {
  if (total <= maxVisible) {
    var arr = [];
    for (var i = 0; i < total; i++) arr.push(i);
    return arr;
  }
  var pages = [];
  var half  = Math.floor(maxVisible / 2);
  var start = Math.max(0, current - half);
  var end   = Math.min(total - 1, start + maxVisible - 1);
  if (end - start < maxVisible - 1) start = Math.max(0, end - maxVisible + 1);

  if (start > 0) { pages.push(0); if (start > 1) pages.push('…'); }
  for (var j = start; j <= end; j++) pages.push(j);
  if (end < total - 1) { if (end < total - 2) pages.push('…'); pages.push(total - 1); }
  return pages;
}

/* ─── Row Actions ───────────────────────────────────────────────────── */

function uwHandleEdit(user) {
  if (uwCtx.stateController) {
    try {
      uwCtx.stateController.navigateTo('user-edit', { params: { userId: user.id.id } });
    } catch (e) { /* state not defined */ }
  }
}

function uwHandleDelete(user) {
  var name = uwUserName(user);
  if (!window.confirm('Delete user "' + name + '"? This action cannot be undone.')) return;

  var sub = uwCtx.http.delete('/api/user/' + user.id.id).subscribe(
    function () {
      uwShowToast('User "' + name + '" deleted successfully.', 'success');
      uwLoadUsers();
    },
    function (err) {
      var msg = (err && err.error && err.error.message) ? err.error.message : 'Failed to delete user.';
      uwShowToast(msg, 'error');
    }
  );
  uwSubscriptions.push(sub);
}

function uwHandleNavigate(user) {
  if (uwCtx.stateController) {
    try {
      uwCtx.stateController.navigateTo('user-details', { params: { userId: user.id.id } });
    } catch (e) { /* state not defined */ }
  }
}

/* ─── Data Helpers ──────────────────────────────────────────────────── */

function uwFindUser(id) {
  for (var i = 0; i < uwState.users.length; i++) {
    if (uwState.users[i].id.id === id) return uwState.users[i];
  }
  return null;
}

function uwUserName(user) {
  var first = (user.firstName || '').trim();
  var last  = (user.lastName  || '').trim();
  var full  = (first + ' ' + last).trim();
  return full || user.email || 'Unknown';
}

function uwFormatRole(authority) {
  var map = {
    'SYS_ADMIN':      'System Admin',
    'TENANT_ADMIN':   'Tenant Admin',
    'CUSTOMER_USER':  'Customer'
  };
  return map[authority] || authority || '';
}

function uwUserScope(user) {
  if (!user) return 'All sites';
  var auth = user.authority;
  if (auth === 'SYS_ADMIN' || auth === 'TENANT_ADMIN') return 'All sites';
  if (user.additionalInfo) {
    var info = user.additionalInfo;
    if (info.scope) return String(info.scope);
    if (Array.isArray(info.customerIds) && info.customerIds.length) {
      var n = info.customerIds.length;
      return n + (n === 1 ? ' site' : ' sites');
    }
  }
  return 'All sites';
}

function uwUserStatus(user) {
  if (user.additionalInfo && user.additionalInfo.lastLoginTs) return 'Active';
  return 'Inactive';
}

function uwLastActive(user) {
  var ts = user.additionalInfo && user.additionalInfo.lastLoginTs;
  if (!ts) return 'Never';
  var diff = Date.now() - ts;
  if (diff < 60000)        return 'Just now';
  if (diff < 3600000)      return Math.floor(diff / 60000) + ' min ago';
  if (diff < 86400000)     return Math.floor(diff / 3600000) + ' hr ago';
  if (diff < 604800000)    return Math.floor(diff / 86400000) + ' days ago';
  return new Date(ts).toLocaleDateString();
}

/* ─── UI State Helpers ──────────────────────────────────────────────── */

function uwSetLoading(on) {
  uwState.loading = on;
  var el = uwRoot.querySelector('.uw-loading-overlay');
  if (el) el.classList.toggle('visible', on);
}

function uwShowError(msg) {
  var el  = uwRoot.querySelector('.uw-error-state');
  var txt = uwRoot.querySelector('.uw-error-msg');
  if (txt) txt.textContent = msg;
  if (el)  el.classList.add('visible');
}

function uwHideError() {
  var el = uwRoot.querySelector('.uw-error-state');
  if (el) el.classList.remove('visible');
}

function uwShowToast(msg, type) {
  var toast = uwRoot.querySelector('.uw-toast');
  var icon  = uwRoot.querySelector('.uw-toast-icon');
  var text  = uwRoot.querySelector('.uw-toast-msg');
  if (!toast) return;

  if (text) text.textContent = msg;
  if (icon) icon.textContent = type === 'success' ? 'check_circle' : 'error';

  toast.className = 'uw-toast visible uw-toast-' + (type || 'success');

  if (uwState.toastTimer) clearTimeout(uwState.toastTimer);
  uwState.toastTimer = setTimeout(function () {
    uwHideToast();
    uwState.toastTimer = null;
  }, 3000);
}

function uwHideToast() {
  var toast = uwRoot.querySelector('.uw-toast');
  if (toast) toast.classList.remove('visible');
}

/* ─── Utility ───────────────────────────────────────────────────────── */

function uwEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
