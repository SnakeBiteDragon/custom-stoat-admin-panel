const http = require('http');
const { MongoClient } = require('mongodb');

const config = require('./config');

let db;
const PORT = 3000;
let server;

async function handleApiRequest(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ message: 'Method Not Allowed' }));
    return;
  }

  const body = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(e); }
    });
  });

  const { action, data = {}, username, password } = body;

  switch (action) {
    case 'login': {
      const isValid = config.ADMIN_USERNAME === username && config.ADMIN_PASSWORD === password;
      res.writeHead(isValid ? 200 : 401);
      res.end(JSON.stringify({ success: isValid, message: isValid ? 'Authenticated' : 'Invalid Credentials' }));
      break;
    }

    case 'getUsers': {
      const query = data.q ? { username: new RegExp(data.q, 'i') } : {};
      const users = await db.collection('users').find(query, {
        projection: { username: 1, discriminator: 1, flags: 1, status: 1 }
      }).toArray();
      let accounts = [];
      try { accounts = await db.collection('accounts').find({}, { projection: { _id: 1, email: 1 } }).toArray(); } catch (e) {}
      const emailMap = {};
      accounts.forEach(a => { emailMap[a._id] = a.email; });
      const result = users.map(u => ({
        _id: u._id,
        username: u.username,
        discriminator: u.discriminator,
        email: emailMap[u._id] || null,
        banned: ((u.flags || 0) & 4) !== 0,
        presence: u.status?.presence || 'Offline'
      }));
      res.writeHead(200);
      res.end(JSON.stringify(result));
      break;
    }

    case 'banUser': {
      await db.collection('users').updateOne({ _id: data.userId }, { $bit: { flags: { or: 4 } } });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      break;
    }

    case 'unbanUser': {
      await db.collection('users').updateOne({ _id: data.userId }, { $bit: { flags: { and: ~4 } } });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      break;
    }

    case 'deleteUser': {
      await db.collection('users').deleteOne({ _id: data.userId });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      break;
    }

    case 'getServers': {
      const servers = await db.collection('servers').find({}, {
        projection: { name: 1, owner: 1, description: 1, channels: 1 }
      }).toArray();
      const ownerIds = [...new Set(servers.map(s => s.owner))];
      const owners = await db.collection('users').find(
        { _id: { $in: ownerIds } },
        { projection: { username: 1, discriminator: 1 } }
      ).toArray();
      const ownerMap = {};
      owners.forEach(o => { ownerMap[o._id] = `${o.username}#${o.discriminator}`; });
      const result = servers.map(s => ({
        _id: s._id,
        name: s.name,
        description: s.description || null,
        owner: ownerMap[s.owner] || s.owner,
        ownerID: s.owner,
        channelCount: s.channels?.length || 0
      }));
      res.writeHead(200);
      res.end(JSON.stringify(result));
      break;
    }

    case 'deleteServer': {
      await db.collection('servers').deleteOne({ _id: data.serverId });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      break;
    }

    case 'getInvites': {
      const invites = await db.collection('channel_invites').find({}).toArray();
      const creatorIds = [...new Set(invites.map(i => i.creator))];
      const creators = await db.collection('users').find(
        { _id: { $in: creatorIds } },
        { projection: { username: 1, discriminator: 1 } }
      ).toArray();
      const creatorMap = {};
      creators.forEach(c => { creatorMap[c._id] = `${c.username}#${c.discriminator}`; });
      const result = invites.map(i => ({
        _id: i._id,
        code: i._id,
        server: i.server,
        channel: i.channel,
        creator: creatorMap[i.creator] || i.creator,
        type: i.type
      }));
      res.writeHead(200);
      res.end(JSON.stringify(result));
      break;
    }

    case 'deleteInvite': {
      await db.collection('channel_invites').deleteOne({ _id: data.code });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      break;
    }

    case 'deleteAllInvites': {
      await db.collection('channel_invites').deleteMany({});
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      break;
    }

    case 'getStats': {
      const [userCount, serverCount, inviteCount, messageCount] = await Promise.all([
        db.collection('users').countDocuments(),
        db.collection('servers').countDocuments(),
        db.collection('channel_invites').countDocuments(),
        db.collection('messages').countDocuments()
      ]);
      res.writeHead(200);
      res.end(JSON.stringify({ userCount, serverCount, inviteCount, messageCount }));
      break;
    }

    default:
      res.writeHead(404);
      res.end(JSON.stringify({ message: 'Unknown action' }));
  }
}

const router = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    handleApiRequest(req, res);
  } else if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stoat Admin</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d0d0f;
      --surface: #141417;
      --surface2: #1c1c21;
      --border: #2a2a32;
      --accent: #7c6af7;
      --accent2: #f76a8c;
      --accent3: #6af7c8;
      --text: #e8e8f0;
      --muted: #6b6b80;
      --danger: #f76a6a;
      --success: #6af79a;
      --warn: #f7c46a;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'Syne', sans-serif; min-height: 100vh; }

    #loginScreen {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(ellipse at 30% 50%, #1a1040 0%, var(--bg) 60%);
    }
    .login-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 48px;
      width: 380px;
      box-shadow: 0 0 80px rgba(124,106,247,0.1);
    }
    .login-box h1 {
      font-size: 28px; font-weight: 800; margin-bottom: 6px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .login-box p { color: var(--muted); font-size: 13px; margin-bottom: 32px; }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .field input {
      width: 100%; background: var(--surface2); border: 1px solid var(--border);
      border-radius: 8px; padding: 12px 16px; color: var(--text);
      font-family: 'JetBrains Mono', monospace; font-size: 14px; outline: none; transition: border-color 0.2s;
    }
    .field input:focus { border-color: var(--accent); }

    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 16px; border-radius: 8px; border: none; cursor: pointer;
      font-family: 'Syne', sans-serif; font-weight: 600; font-size: 13px; transition: all 0.15s;
    }
    .btn-primary { background: var(--accent); color: white; width: 100%; justify-content: center; margin-top: 8px; font-size: 15px; padding: 13px; }
    .btn-primary:hover { background: #9080ff; }
    .btn-danger { background: rgba(247,106,106,0.12); color: var(--danger); border: 1px solid rgba(247,106,106,0.25); font-size: 12px; padding: 6px 12px; }
    .btn-danger:hover { background: rgba(247,106,106,0.22); }
    .btn-warn { background: rgba(247,196,106,0.12); color: var(--warn); border: 1px solid rgba(247,196,106,0.25); font-size: 12px; padding: 6px 12px; }
    .btn-warn:hover { background: rgba(247,196,106,0.22); }
    .btn-success { background: rgba(106,247,154,0.12); color: var(--success); border: 1px solid rgba(106,247,154,0.25); font-size: 12px; padding: 6px 12px; }
    .btn-success:hover { background: rgba(106,247,154,0.22); }
    .btn-ghost { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); font-size: 12px; padding: 6px 12px; }
    .btn-ghost:hover { color: var(--text); border-color: var(--accent); }
    #loginError { color: var(--danger); font-size: 13px; margin-top: 12px; text-align: center; min-height: 20px; }

    #dashboard { display: none; min-height: 100vh; }
    .topbar {
      background: var(--surface); border-bottom: 1px solid var(--border);
      padding: 0 32px; height: 60px;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 100;
    }
    .topbar-brand {
      font-size: 18px; font-weight: 800;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .topbar-tabs { display: flex; gap: 4px; }
    .tab {
      padding: 8px 18px; border-radius: 8px; border: none;
      background: transparent; color: var(--muted); cursor: pointer;
      font-family: 'Syne', sans-serif; font-weight: 600; font-size: 13px; transition: all 0.15s;
    }
    .tab:hover { color: var(--text); background: var(--surface2); }
    .tab.active { color: var(--accent); background: rgba(124,106,247,0.12); }

    .main { padding: 28px 32px; max-width: 1400px; margin: 0 auto; }

    .stats-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 28px; }
    .stat-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 18px 22px; position: relative; overflow: hidden;
    }
    .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; }
    .stat-card:nth-child(1)::before { background: var(--accent); }
    .stat-card:nth-child(2)::before { background: var(--accent2); }
    .stat-card:nth-child(3)::before { background: var(--accent3); }
    .stat-card:nth-child(4)::before { background: var(--warn); }
    .stat-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .stat-value { font-size: 30px; font-weight: 800; font-family: 'JetBrains Mono', monospace; }

    .panel { display: none; }
    .panel.active { display: block; }
    .panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
    .panel-title { font-size: 20px; font-weight: 700; }
    .search-input {
      background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
      padding: 9px 14px; color: var(--text); font-family: 'JetBrains Mono', monospace;
      font-size: 13px; outline: none; width: 240px; transition: border-color 0.2s;
    }
    .search-input:focus { border-color: var(--accent); }

    .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px,1fr)); gap: 14px; }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 18px; transition: border-color 0.2s, transform 0.15s;
    }
    .card:hover { border-color: rgba(124,106,247,0.4); transform: translateY(-2px); }
    .card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
    .card-avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 15px; color: white; flex-shrink: 0;
    }
    .card-avatar.server { border-radius: 10px; }
    .badge { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 20px; font-family: 'JetBrains Mono', monospace; }
    .badge-online { background: rgba(106,247,154,0.15); color: var(--success); }
    .badge-offline { background: rgba(107,107,128,0.15); color: var(--muted); }
    .badge-banned { background: rgba(247,106,106,0.15); color: var(--danger); }
    .badge-idle { background: rgba(247,196,106,0.15); color: var(--warn); }
    .card-name { font-weight: 700; font-size: 15px; margin-bottom: 3px; }
    .card-sub { font-size: 12px; color: var(--muted); font-family: 'JetBrains Mono', monospace; }
    .card-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }

    .invite-table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
    .invite-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .invite-table td { padding: 11px 16px; font-size: 13px; border-bottom: 1px solid rgba(42,42,50,0.5); font-family: 'JetBrains Mono', monospace; }
    .invite-table tr:last-child td { border-bottom: none; }
    .invite-table tr:hover td { background: var(--surface2); }

    .loading { color: var(--muted); font-size: 14px; padding: 48px; text-align: center; }
    .empty { color: var(--muted); font-size: 14px; padding: 48px; text-align: center; border: 1px dashed var(--border); border-radius: 12px; }
  </style>
</head>
<body>

<div id="loginScreen">
  <div class="login-box">
    <h1>Stoat Admin</h1>
    <p>Sign in to manage your instance</p>
    <div class="field">
      <label>Username</label>
      <input type="text" id="loginUser" autocomplete="username">
    </div>
    <div class="field">
      <label>Password</label>
      <input type="password" id="loginPass" autocomplete="current-password">
    </div>
    <button class="btn btn-primary" onclick="login()">Sign In</button>
    <div id="loginError"></div>
  </div>
</div>

<div id="dashboard">
  <div class="topbar">
    <div class="topbar-brand">⬡ Stoat Admin</div>
    <div class="topbar-tabs">
      <button class="tab active" onclick="switchTab('users', this)">Users</button>
      <button class="tab" onclick="switchTab('servers', this)">Servers</button>
      <button class="tab" onclick="switchTab('invites', this)">Invites</button>
    </div>
    <div style="font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace">instance admin</div>
  </div>

  <div class="main">
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Users</div><div class="stat-value" id="statUsers">—</div></div>
      <div class="stat-card"><div class="stat-label">Servers</div><div class="stat-value" id="statServers">—</div></div>
      <div class="stat-card"><div class="stat-label">Invites</div><div class="stat-value" id="statInvites">—</div></div>
      <div class="stat-card"><div class="stat-label">Messages</div><div class="stat-value" id="statMessages">—</div></div>
    </div>

    <div class="panel active" id="panel-users">
      <div class="panel-header">
        <div class="panel-title">Users</div>
        <input class="search-input" type="text" id="userSearch" placeholder="Search username..." oninput="loadUsers()">
      </div>
      <div class="card-grid" id="userGrid"><div class="loading">Loading...</div></div>
    </div>

    <div class="panel" id="panel-servers">
      <div class="panel-header">
        <div class="panel-title">Servers</div>
        <button class="btn btn-ghost" onclick="loadServers()">↻ Refresh</button>
      </div>
      <div class="card-grid" id="serverGrid"><div class="loading">Loading...</div></div>
    </div>

    <div class="panel" id="panel-invites">
      <div class="panel-header">
        <div class="panel-title">Invites</div>
        <button class="btn btn-danger" onclick="deleteAllInvites()">Delete All</button>
      </div>
      <div id="inviteContainer"><div class="loading">Loading...</div></div>
    </div>
  </div>
</div>

<script>
  const api = async (action, payload = {}) => {
    const res = await fetch('/api/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || res.status);
    return data;
  };

  async function login() {
    const username = document.getElementById('loginUser').value;
    const password = document.getElementById('loginPass').value;
    const err = document.getElementById('loginError');
    err.textContent = '';
    try {
      const res = await api('login', { username, password });
      if (res.success) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        loadStats();
        loadUsers();
      } else {
        err.textContent = res.message || 'Invalid credentials';
      }
    } catch (e) {
      err.textContent = e.message;
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') login();
  });

  function switchTab(tab, el) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('panel-' + tab).classList.add('active');
    el.classList.add('active');
    if (tab === 'users') loadUsers();
    if (tab === 'servers') loadServers();
    if (tab === 'invites') loadInvites();
  }

  async function loadStats() {
    try {
      const s = await api('getStats');
      document.getElementById('statUsers').textContent = s.userCount.toLocaleString();
      document.getElementById('statServers').textContent = s.serverCount.toLocaleString();
      document.getElementById('statInvites').textContent = s.inviteCount.toLocaleString();
      document.getElementById('statMessages').textContent = s.messageCount.toLocaleString();
    } catch (e) {}
  }

  async function loadUsers() {
    const q = document.getElementById('userSearch').value;
    const grid = document.getElementById('userGrid');
    try {
      const users = await api('getUsers', { data: { q } });
      if (!users.length) { grid.innerHTML = '<div class="empty">No users found</div>'; return; }
      grid.innerHTML = users.map(u => {
        const initials = u.username.slice(0, 2).toUpperCase();
        const presenceBadge = u.banned
          ? '<span class="badge badge-banned">Banned</span>'
          : u.presence === 'Online'
            ? '<span class="badge badge-online">Online</span>'
            : u.presence === 'Idle'
              ? '<span class="badge badge-idle">Idle</span>'
              : '<span class="badge badge-offline">' + (u.presence || 'Offline') + '</span>';
        const banBtn = u.banned
          ? '<button class="btn btn-success" onclick="unbanUser(\\'' + u._id + '\\')">Unban</button>'
          : '<button class="btn btn-warn" onclick="banUser(\\'' + u._id + '\\')">Ban</button>';
        return '<div class="card">' +
          '<div class="card-top">' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<div class="card-avatar">' + initials + '</div>' +
              '<div><div class="card-name">' + u.username + '</div>' +
              '<div class="card-sub">#' + u.discriminator + '</div></div>' +
            '</div>' + presenceBadge +
          '</div>' +
          '<div class="card-sub">' + (u.email || '<span style="opacity:0.4">no email</span>') + '</div>' +
          '<div class="card-sub" style="font-size:10px;margin-top:4px;opacity:0.35;word-break:break-all">' + u._id + '</div>' +
          '<div class="card-actions">' + banBtn +
            '<button class="btn btn-danger" onclick="deleteUser(\\'' + u._id + '\\')">Delete</button>' +
          '</div></div>';
      }).join('');
    } catch (e) {
      grid.innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
    }
  }

  async function banUser(userId) {
    if (!confirm('Ban this user?')) return;
    await api('banUser', { data: { userId } });
    loadUsers(); loadStats();
  }

  async function unbanUser(userId) {
    await api('unbanUser', { data: { userId } });
    loadUsers();
  }

  async function deleteUser(userId) {
    if (!confirm('Permanently delete this user?')) return;
    await api('deleteUser', { data: { userId } });
    loadUsers(); loadStats();
  }

  async function loadServers() {
    const grid = document.getElementById('serverGrid');
    try {
      const servers = await api('getServers');
      if (!servers.length) { grid.innerHTML = '<div class="empty">No servers found</div>'; return; }
      grid.innerHTML = servers.map(s => {
        const initials = s.name.slice(0, 2).toUpperCase();
        const desc = s.description
          ? '<div class="card-sub" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:Syne,sans-serif">' + s.description + '</div>'
          : '';
        return '<div class="card">' +
          '<div class="card-top">' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<div class="card-avatar server">' + initials + '</div>' +
              '<div><div class="card-name">' + s.name + '</div>' +
              '<div class="card-sub">' + s.owner + '</div></div>' +
            '</div>' +
            '<span class="badge badge-offline">' + s.channelCount + ' ch</span>' +
          '</div>' + desc +
          '<div class="card-sub" style="font-size:10px;margin-top:6px;opacity:0.35;word-break:break-all">' + s._id + '</div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-danger" onclick="deleteServer(\\'' + s._id + '\\')">Delete Server</button>' +
          '</div></div>';
      }).join('');
    } catch (e) {
      grid.innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
    }
  }

  async function deleteServer(serverId) {
    if (!confirm('Delete this server? This cannot be undone.')) return;
    await api('deleteServer', { data: { serverId } });
    loadServers(); loadStats();
  }

  async function loadInvites() {
    const container = document.getElementById('inviteContainer');
    try {
      const invites = await api('getInvites');
      if (!invites.length) { container.innerHTML = '<div class="empty">No active invites</div>'; return; }
      let rows = invites.map(i =>
        '<tr><td>' + i.code + '</td><td style="opacity:0.5;font-size:11px">' + (i.server || '—') + '</td><td>' + i.creator + '</td><td>' + (i.type || 'Server') + '</td>' +
        '<td><button class="btn btn-danger" onclick="deleteInvite(\\'' + i.code + '\\')">Delete</button></td></tr>'
      ).join('');
      container.innerHTML = '<table class="invite-table"><thead><tr><th>Code</th><th>Server ID</th><th>Created By</th><th>Type</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table>';
    } catch (e) {
      container.innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
    }
  }

  async function deleteInvite(code) {
    await api('deleteInvite', { data: { code } });
    loadInvites(); loadStats();
  }

  async function deleteAllInvites() {
    if (!confirm('Delete ALL invites?')) return;
    await api('deleteAllInvites');
    loadInvites(); loadStats();
  }
</script>
</body>
</html>`);
  } else {
    res.writeHead(404);
    res.end();
  }
};

async function startServer() {
  try {
    const client = new MongoClient(config.MONGODB_URI);
    await client.connect();
    db = client.db('revolt');
    console.log("Connected to MongoDB (revolt db)");
    server = http.createServer(router);
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

startServer();
