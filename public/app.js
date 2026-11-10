const state = { user: null, bills: [], selectedBill: null, lineCount: 0 };
const $ = selector => document.querySelector(selector);
const loginScreen = $('#login-screen');
const appShell = $('#app');
const toast = $('#toast');

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

async function boot() {
  $('#today-label').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  try {
    const session = await api('/api/session');
    if (session.user) await enterApp(session.user);
  } catch { /* the sign-in screen stays visible */ }
}

async function enterApp(user) {
  state.user = user;
  loginScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  $('#user-name').textContent = user.name;
  $('#role-pill').textContent = user.role.toUpperCase();
  const initials = user.role === 'manager' ? 'DM' : 'DA';
  $('.user-avatar').textContent = initials;
  $('#accountant-tools').classList.toggle('hidden', user.role !== 'accountant');
  await refreshBills();
  await loadTotals();
}

function showLogin() {
  state.user = null;
  state.bills = [];
  state.selectedBill = null;
  appShell.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  $('#login-error').textContent = '';
  try {
    const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
    await enterApp(result.user);
  } catch (error) { $('#login-error').textContent = error.message; }
});

document.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', () => {
  const manager = button.dataset.login === 'manager';
  $('input[name="email"]').value = manager ? 'manager@billdrop.demo' : 'accountant@billdrop.demo';
  $('input[name="password"]').value = manager ? 'billdrop-demo-2' : 'billdrop-demo-1';
}));

$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch { /* clear the local view anyway */ }
  showLogin();
});

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', async () => {
  const bills = button.dataset.view === 'bills';
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item === button));
  $('#bills-view').classList.toggle('hidden', !bills);
  $('#suppliers-view').classList.toggle('hidden', bills);
  $('#top-title').textContent = bills ? 'Bills' : 'Supplier totals';
  if (!bills) await loadTotals();
}));

$('#refresh-button').addEventListener('click', refreshBills);

async function refreshBills() {
  try {
    const result = await api('/api/bills');
    state.bills = result.bills;
    $('#bill-count').textContent = String(result.bills.length);
    renderBills();
    if (state.selectedBill) {
      const refreshed = result.bills.find(item => item.id === state.selectedBill.id);
      if (refreshed) await selectBill(refreshed.id);
    }
  } catch (error) { showToast(error.message); }
}

function statusLabel(status) {
  return status === 'saved' ? 'SAVED' : status === 'failed' ? 'FAILED' : status === 'reading' ? 'READING' : 'REVIEW';
}

function renderBills() {
  const host = $('#bill-list');
  if (!state.bills.length) {
    host.innerHTML = '<p class="no-totals">No bills yet. Open the made-up sample to start.</p>';
    return;
  }
  host.innerHTML = state.bills.map(bill => `
    <button class="bill-row ${state.selectedBill?.id === bill.id ? 'selected' : ''}" data-bill-id="${escapeHtml(bill.id)}" type="button">
      <span class="bill-icon">▧</span><span><span class="bill-row-title">${escapeHtml(bill.bill_number || 'New bill')}</span><span class="bill-row-sub">${escapeHtml(new Date(bill.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'}))} · ${bill.total === null ? 'Amount pending' : `₹${Number(bill.total).toLocaleString('en-IN')}`}</span></span>
      <span class="tiny-status ${escapeHtml(bill.status)}">${statusLabel(bill.status)}</span>
    </button>`).join('');
  host.querySelectorAll('[data-bill-id]').forEach(button => button.addEventListener('click', () => selectBill(button.dataset.billId)));
}

async function selectBill(id) {
  try {
    const result = await api(`/api/bills/${encodeURIComponent(id)}`);
    state.selectedBill = result.bill;
    renderBills();
    renderReview(result.bill);
  } catch (error) { showToast(error.message); }
}

function renderReview(bill) {
  $('#empty-review').classList.add('hidden');
  $('#review-content').classList.remove('hidden');
  $('#review-title').textContent = bill.bill_number || 'New bill';
  const badge = $('#status-badge');
  badge.textContent = bill.status === 'saved' ? 'SAVED RECORD' : statusLabel(bill.status) === 'FAILED' ? 'READING FAILED' : 'READY TO REVIEW';
  badge.classList.toggle('failed', bill.status === 'failed');
  const notice = $('#notice');
  notice.classList.toggle('hidden', !bill.problem);
  notice.classList.toggle('error', bill.status === 'failed');
  notice.textContent = bill.problem || '';
  $('#bill-preview').src = `/api/bills/${encodeURIComponent(bill.id)}/file`;
  $('#ocr-text-wrap').classList.toggle('hidden', !bill.ocr_text);
  $('#ocr-text').textContent = bill.ocr_text || '';
  const form = $('#review-form');
  form.elements.supplier.value = bill.supplier || '';
  form.elements.bill_number.value = bill.bill_number || '';
  form.elements.bill_date.value = bill.bill_date || '';
  form.elements.total.value = bill.total ?? '';
  $('#line-items').innerHTML = '';
  state.lineCount = 0;
  (bill.lines?.length ? bill.lines : [{ description: '', amount: '' }]).forEach(line => addLine(line.description, line.amount));
  const readOnly = state.user.role !== 'accountant' || bill.status === 'failed';
  form.querySelectorAll('input,button').forEach(element => { element.disabled = readOnly; });
  $('#save-button').textContent = bill.status === 'saved' ? 'Save changes' : 'Save checked bill →';
  updateSum();
}

function addLine(description = '', amount = '') {
  state.lineCount += 1;
  const row = document.createElement('div');
  row.className = 'line-row';
  row.innerHTML = `<input class="line-description" aria-label="Line description ${state.lineCount}" placeholder="Description" maxlength="160" value="${escapeHtml(description)}"><input class="line-amount" aria-label="Line amount ${state.lineCount}" type="number" min="0" step="0.01" placeholder="₹ Amount" value="${amount === '' ? '' : Number(amount)}"><button class="remove-line" type="button" aria-label="Remove line">×</button>`;
  row.querySelector('.remove-line').addEventListener('click', () => { row.remove(); updateSum(); });
  row.querySelectorAll('input').forEach(input => input.addEventListener('input', updateSum));
  $('#line-items').append(row);
  updateSum();
}

function updateSum() {
  const sum = [...document.querySelectorAll('.line-amount')].reduce((total,input) => total + (Number(input.value) || 0),0);
  $('#sum-hint').textContent = `Lines total: ₹${sum.toLocaleString('en-IN')}`;
}

$('#add-line').addEventListener('click', () => addLine());

$('#review-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.selectedBill) return;
  const form = event.currentTarget;
  const lines = [...document.querySelectorAll('.line-row')].map(row => ({
    description: row.querySelector('.line-description').value.trim(),
    amount: Number(row.querySelector('.line-amount').value) || 0
  })).filter(line => line.description);
  const payload = {
    supplier: form.elements.supplier.value.trim(), bill_number: form.elements.bill_number.value.trim(),
    bill_date: form.elements.bill_date.value, lines, total: Number(form.elements.total.value)
  };
  $('#save-button').disabled = true;
  try {
    const result = await api(`/api/bills/${encodeURIComponent(state.selectedBill.id)}/save`, { method: 'POST', body: JSON.stringify(payload) });
    state.selectedBill = result.bill;
    showToast(result.bill.problem || 'Bill saved to the records.');
    await refreshBills();
    await loadTotals();
  } catch (error) { showToast(error.message); }
  finally { $('#save-button').disabled = false; }
});

$('#upload-button').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) { showToast('File is larger than 4 MB.'); return; }
  const accepted = ['application/pdf','image/png','image/jpeg'];
  if (!accepted.includes(file.type)) { showToast('Choose a PDF, JPG, or PNG bill.'); return; }
  $('#upload-button').disabled = true;
  $('#upload-message').textContent = 'Uploading and reading the bill…';
  try {
    const data = await fileToBase64(file);
    const result = await api('/api/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, mimeType: file.type, data }) });
    await refreshBills();
    await selectBill(result.bill.id);
    $('#upload-message').textContent = result.bill.status === 'failed' ? result.bill.problem : 'Bill ready for your review.';
  } catch (error) { $('#upload-message').textContent = error.message; }
  finally { $('#upload-button').disabled = false; }
});

function fileToBase64(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

$('#sample-button').addEventListener('click', async () => {
  $('#sample-button').disabled = true;
  $('#upload-message').textContent = 'Opening the made-up sample bill…';
  try {
    const result = await api('/api/sample', { method: 'POST', body: '{}' });
    await refreshBills();
    await selectBill(result.bill.id);
    $('#upload-message').textContent = 'Sample is ready. Check the fields, then save it.';
  } catch (error) { $('#upload-message').textContent = error.message; }
  finally { $('#sample-button').disabled = false; }
});

async function loadTotals() {
  if (!state.user) return;
  try {
    const result = await api('/api/supplier-totals');
    const monthDate = new Date(`${result.month}-01T00:00:00`);
    $('#totals-month').textContent = new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(monthDate);
    $('#supplier-totals').innerHTML = result.totals.length ? result.totals.map(row => `<div class="total-row"><strong>${escapeHtml(row.supplier)}</strong><strong>₹${Number(row.total).toLocaleString('en-IN')}</strong><small>${row.bills} saved bill${row.bills === 1 ? '' : 's'}</small></div>`).join('') : '<p class="no-totals">No bills saved this month yet.</p>';
  } catch (error) { $('#supplier-totals').innerHTML = `<p class="no-totals">${escapeHtml(error.message)}</p>`; }
}

boot();
