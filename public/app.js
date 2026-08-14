const $ = id => document.getElementById(id);

const state = {
  loggedIn: false,
  accounts: [],
  zones: [],
  workers: [],
  pages: [],
  kvs: []
};

setRandomNames();
$('uuid').value = crypto.randomUUID();
fillSelect($('accountId'), [], '自动选择第一个账户');
fillSelect($('zoneId'), [], '自动随机子域名');
fillSelect($('quickZone'), [], '无可用域名');
fillProjectSelect();
fillKvSelect();

$('loginButton').addEventListener('click', login);
$('backToLogin').addEventListener('click', () => {
  state.loggedIn = false;
  showPage('login');
  setLoginStatus('已返回登录页');
});
$('quickDeploy').addEventListener('click', () => runDeploy(collectQuickPayload));
$('deploy').addEventListener('click', () => runDeploy(collectAdvancedPayload));

$('newNames').addEventListener('click', setRandomNames);

$('newUuid').addEventListener('click', () => {
  $('uuid').value = crypto.randomUUID();
});

$('bindDomain').addEventListener('change', updateQuickDomainPreview);
$('quickZone').addEventListener('change', updateQuickDomainPreview);

$('clearLogs').addEventListener('click', () => {
  $('logs').textContent = '';
});

$('accountId').addEventListener('change', async () => {
  if ($('accountId').value) await loadResources();
});

$('zoneId').addEventListener('change', () => {
  if (!$('advancedHostname').value.trim()) return;
  const zone = state.zones.find(item => item.id === $('zoneId').value);
  if (zone && $('advancedHostname').value.trim().split('.').length <= 2) $('advancedHostname').value = zone.name;
});

$('deployMode').addEventListener('change', syncModeState);

$('existingProject').addEventListener('change', () => {
  const selected = parseProjectValue($('existingProject').value);
  if (!selected) return;
  $('deployMode').value = 'update';
  $('deployType').value = selected.type;
  $('projectName').value = selected.name;
  syncModeState();
  setResult(`已选择 ${selected.type === 'pages' ? 'Pages' : 'Worker'} 项目，更新模式只同步代码`, 'success');
});

$('kvId').addEventListener('change', () => {
  const selected = state.kvs.find(item => item.id === $('kvId').value);
  if (selected) $('kvTitle').value = selected.title || '';
});

$('loadAccounts').addEventListener('click', async () => {
  setResult('刷新 Cloudflare 账户和域名中...');
  setBusy(true);
  try {
    await loadCloudflareBase();
    setResult('账户和域名读取完成', 'success');
    if ($('accountId').value) await loadResources();
  } catch (error) {
    setResult(error.message, 'error');
    log(`错误: ${error.message}`);
  } finally {
    setBusy(false);
  }
});

$('loadResources').addEventListener('click', async () => {
  setBusy(true);
  try {
    await loadResources();
  } catch (error) {
    setResult(error.message, 'error');
    log(`错误: ${error.message}`);
  } finally {
    setBusy(false);
  }
});

async function login() {
  setLoginStatus('登录中...');
  setBusy(true);
  try {
    await loadCloudflareBase();
    state.loggedIn = true;
    showPage('deploy');
    setLoginStatus('登录成功', 'success');
    setResult('已登录，可以一键部署', 'success');
  } catch (error) {
    setLoginStatus(error.message, 'error');
    log(`登录失败: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function loadCloudflareBase() {
  const credentials = getCredentials();
  const [accountsRes, zonesRes] = await Promise.all([
    post('/api/accounts', { credentials }),
    post('/api/zones', { credentials })
  ]);
    state.accounts = accountsRes.accounts || [];
    state.zones = zonesRes.zones || [];
    fillSelect($('accountId'), state.accounts, '自动选择第一个账户');
    fillSelect($('zoneId'), state.zones, '自动随机子域名');
    fillSelect($('quickZone'), state.zones, state.zones.length ? '不绑定域名' : '无可用域名');
    updateQuickDomainPreview();
    log(`账户数量: ${state.accounts.length}`);
  log(`可用 Zone: ${state.zones.length}`);
}

async function runDeploy(collector) {
  if (!state.loggedIn) {
    setResult('请先登录', 'error');
    showPage('login');
    return;
  }
  setResult('部署中...');
  setBusy(true);
  try {
    const payload = collector();
    const result = await post('/api/deploy', payload);
    (result.logs || []).forEach(log);
    const url = formatDeployResult(payload, result);
    setResult(url, 'success');
  } catch (error) {
    setResult(error.message, 'error');
    log(`错误: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function formatDeployResult(payload, result) {
  if (payload.deployMode === 'update') return `${result.projectName} 代码同步完成`;
  const rawUuid = String(result.uuid || '');
  const 主UUID = rawUuid.split(/[,;\n]+/)[0].split('#')[0].trim() || rawUuid;
  if (result.domain?.hostname) return `https://${result.domain.hostname}/${主UUID}`;
  return `${result.projectName} 部署完成，主 UUID: ${主UUID}`;
}

async function loadResources() {
  const credentials = getCredentials();
  const accountId = $('accountId').value;
  if (!accountId) throw new Error('请先读取并选择 Account');
  setResult('读取现有项目和 KV 中...');
  const resources = await post('/api/resources', { credentials, accountId });
  state.workers = resources.workers || [];
  state.pages = resources.pages || [];
  state.kvs = resources.kvs || [];
  fillProjectSelect();
  fillKvSelect();
  log(`现有 Worker: ${state.workers.length}`);
  log(`现有 Pages: ${state.pages.length}`);
  log(`现有 KV: ${state.kvs.length}`);
  (resources.warnings || []).forEach(warning => log(`提示: ${warning}`));
  setResult('现有项目读取完成', 'success');
}

function getCredentials() {
  const email = $('email').value.trim();
  const key = $('key').value.trim();
  if (!email || !key) throw new Error('请填写 Cloudflare 邮箱和 Global API Key');
  return { email, key };
}

function collectQuickPayload() {
  const selectedZone = state.zones.find(item => item.id === $('quickZone').value) || state.zones[0];
  const shouldBindDomain = $('bindDomain').checked && !!selectedZone;
  const hostname = shouldBindDomain ? randomSubdomain(selectedZone.name) : '';
  return {
    credentials: getCredentials(),
    accountId: $('accountId').value,
    deployMode: 'create',
    deployType: 'pages',
    sourceMode: 'encoded',
    projectName: randomName('edge'),
    uuid: crypto.randomUUID(),
    kvTitle: randomName('store'),
    hostname,
    zoneId: shouldBindDomain ? selectedZone.id : '',
    autoDomain: false
  };
}

function collectAdvancedPayload() {
  const credentials = getCredentials();
  const deployMode = $('deployMode').value;
  const selectedProject = parseProjectValue($('existingProject').value);
  if (deployMode === 'update') {
    const projectName = $('projectName').value.trim() || selectedProject?.name || '';
    if (!projectName) throw new Error('更新现有项目时必须选择或填写项目名称');
    return {
      credentials,
      accountId: $('accountId').value,
      deployMode,
      deployType: $('deployType').value,
      sourceMode: $('sourceMode').value,
      projectName
    };
  }
  const hostname = $('advancedHostname').value.trim();
  const zoneId = $('zoneId').value;
  if (hostname && !zoneId && state.zones.length) {
    const matched = matchZone(hostname);
    if (matched) $('zoneId').value = matched.id;
  }
  if (hostname && !$('zoneId').value && !hostname.includes('.')) throw new Error('自定义域名需要完整域名或先选择 Zone');
  return {
    credentials,
    accountId: $('accountId').value,
    deployMode,
    deployType: $('deployType').value,
    sourceMode: $('sourceMode').value,
    projectName: $('projectName').value.trim() || randomName('edge'),
    uuid: $('uuid').value.trim() || crypto.randomUUID(),
    kvTitle: $('kvTitle').value.trim() || randomName('store'),
    kvId: $('kvId').value,
    hostname,
    zoneId: $('zoneId').value,
    autoDomain: false,
    enableWorkersDev: $('enableWorkersDev').checked
  };
}

function fillSelect(select, items, emptyLabel) {
  select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = emptyLabel;
  select.append(empty);
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name} (${item.id})`;
    select.append(option);
  }
  if (items.length === 1) select.value = items[0].id;
}

function fillProjectSelect() {
  const select = $('existingProject');
  select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = state.workers.length || state.pages.length ? '请选择要更新的项目' : '暂无项目，先读取';
  select.append(empty);
  for (const worker of state.workers) appendOption(select, `worker:${worker.name}`, `Worker: ${worker.title || worker.name}`);
  for (const page of state.pages) {
    const kvText = page.kvId ? ` / 已有 KV: ${shortId(page.kvId)}` : '';
    appendOption(select, `pages:${page.name}`, `Pages: ${page.title || page.name}${kvText}`);
  }
}

function fillKvSelect() {
  const select = $('kvId');
  select.innerHTML = '';
  appendOption(select, '', $('deployMode').value === 'update' ? '更新模式不修改 KV' : '新建随机 KV');
  for (const kv of state.kvs) appendOption(select, kv.id, `${kv.title || kv.id} (${kv.id})`);
}

function appendOption(select, value, text) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  select.append(option);
}

function parseProjectValue(value) {
  if (!value || !value.includes(':')) return null;
  const index = value.indexOf(':');
  return {
    type: value.slice(0, index),
    name: value.slice(index + 1)
  };
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || `请求失败: ${response.status}`);
  return data;
}

function setRandomNames() {
  $('projectName').value = randomName('edge');
  $('kvTitle').value = randomName('store');
  $('kvId').value = '';
  $('existingProject').value = '';
  $('deployMode').value = 'create';
  updateQuickDomainPreview();
  syncModeState();
}

function updateQuickDomainPreview() {
  const selectedZone = state.zones.find(item => item.id === $('quickZone').value) || state.zones[0];
  if (!$('bindDomain').checked) {
    $('quickHostnamePreview').value = '不绑定域名';
    return;
  }
  if (!selectedZone) {
    $('quickHostnamePreview').value = '账号内没有可用域名';
    return;
  }
  $('quickHostnamePreview').value = randomSubdomain(selectedZone.name);
}

function randomSubdomain(zoneName) {
  return `${randomName('edge')}.${zoneName}`;
}

function randomName(prefix) {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${suffix}`;
}

function shortId(id) {
  return id && id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-6)}` : id;
}

function matchZone(hostname) {
  return state.zones
    .filter(zone => hostname === zone.name || hostname.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

function syncModeState() {
  const updating = $('deployMode').value === 'update';
  $('deploy').textContent = updating ? '更新部署' : '高级部署';
  $('modeHint').textContent = updating
    ? '更新模式只同步代码，不创建 KV，不修改 UUID、KV 绑定、域名或 Pages 项目配置。'
    : '新建模式会按表单配置随机 UUID、KV 和可选域名。';
  for (const id of ['uuid', 'kvTitle', 'kvId', 'advancedHostname', 'zoneId', 'enableWorkersDev']) {
    $(id).disabled = updating;
  }
  if ($('kvId').options[0]) $('kvId').options[0].textContent = updating ? '更新模式不修改 KV' : '新建随机 KV';
}

function showPage(page) {
  $('loginPage').classList.toggle('page-hidden', page !== 'login');
  $('deployPage').classList.toggle('page-hidden', page !== 'deploy');
}

function setBusy(busy) {
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
}

function setLoginStatus(text, type = '') {
  $('loginStatus').textContent = text;
  $('loginStatus').className = `result ${type}`.trim();
}

function setResult(text, type = '') {
  $('result').textContent = text;
  $('result').className = `result ${type}`.trim();
}

function log(text) {
  const target = $('logs');
  target.textContent += `${text}\n`;
  target.scrollTop = target.scrollHeight;
}
