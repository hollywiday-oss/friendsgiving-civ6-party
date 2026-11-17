(() => {
  const STORAGE_KEY = 'worldsAtWarRegistrationsV1';
  const categories = ['appetizers', 'mains', 'desserts', 'drinks'];
  const labels = { appetizers: 'Appetizers', mains: 'Main courses', desserts: 'Desserts', drinks: 'Drinks' };
  const $ = selector => document.querySelector(selector);
  const config = window.FRIENDSGIVING_SUPABASE || {};
  const sharedRequested = Boolean(config.url && config.anonKey);
  const localRead = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { players: [], food: [], teams: {} }; } catch { return { players: [], food: [], teams: {} }; } };
  const localSave = value => localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  let data = localRead();
  let session = null;
  let sharedMode = false;
  let userId = '';
  let refreshRunning = false;

  const sessionKey = `friendsgiving-session-${new URL(config.url || 'https://invalid.local').hostname}`;
  async function authRequest(path, body) {
    const response = await fetch(`${config.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: config.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.msg || result.message || 'Guest sign-in failed');
    return result;
  }
  async function ensureSession() {
    try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { session = null; }
    if (session?.refresh_token && session.expires_at * 1000 < Date.now() + 60000) {
      try { session = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token }); } catch { session = null; }
    }
    if (!session?.access_token) session = await authRequest('signup', { data: {} });
    if (!session.expires_at && session.expires_in) session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in;
    localStorage.setItem(sessionKey, JSON.stringify(session)); userId = session.user.id;
  }
  async function api(path, options = {}) {
    const response = await fetch(`${config.url}/rest/v1/${path}`, { ...options, headers: { apikey: config.anonKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }, signal: AbortSignal.timeout(12000) });
    if (response.status === 204) return null;
    const body = await response.text();
    if (!response.ok) throw new Error(body || `Request failed (${response.status})`);
    return body ? JSON.parse(body) : null;
  }
  const upsert = row => api('registrations?on_conflict=user_id%2Ckind%2Cname_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
  const updateRow = (id, values) => api(`registrations?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(values) });
  const deleteOwnRows = () => api(`registrations?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(item => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
    document.querySelectorAll('[role="tabpanel"]').forEach(panel => { panel.hidden = panel.id !== `panel-${tab.dataset.tab}`; });
  }));
  document.querySelectorAll('input[name="attendance"]').forEach(input => input.addEventListener('change', () => { $('#player-options').hidden = input.value !== 'play' || !input.checked; }));
  document.querySelectorAll('input[name="setup"]').forEach(input => input.addEventListener('change', () => { $('#team-options').hidden = input.value !== 'own' || !input.checked; }));

  $('#civ-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name')).trim();
    if (!name) return;
    if (sharedRequested && !sharedMode) return setMessage('#civ-message', 'Shared sign-ups are unavailable right now. Please try again shortly.');
    const attendance = form.get('attendance');
    const registration = { name, attendance, setup: attendance === 'play' ? form.get('setup') : null,
      team_mode: attendance === 'play' && form.get('setup') === 'own' ? form.get('teamMode') : null };
    if (sharedMode) {
      try { await upsert({ user_id: userId, kind: 'player', name_key: name.toLocaleLowerCase(), ...registration, food_type: null, dish: null, host_id: null }); } catch { return setMessage('#civ-message', 'Could not save. Please check your connection and try again.'); }
      setMessage('#civ-message', `Registration saved for ${name}.`); await refreshShared();
    } else {
      const previous = data.players.findIndex(person => person.name.toLowerCase() === name.toLowerCase());
      const item = { id: previous >= 0 ? data.players[previous].id : crypto.randomUUID(), ...registration, teamMode: registration.team_mode || '' };
      if (previous >= 0) data.players[previous] = item; else data.players.push(item);
      localSave(data); setMessage('#civ-message', `Registration saved for ${name}.`); renderTeams();
    }
  });

  $('#food-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name')).trim();
    if (!name || !form.get('type')) return;
    if (sharedRequested && !sharedMode) return setMessage('#food-message', 'Shared sign-ups are unavailable right now. Please try again shortly.');
    const item = { name, food_type: form.get('type'), dish: String(form.get('dish') || '').trim() || null };
    if (sharedMode) {
      try { await upsert({ user_id: userId, kind: 'food', name_key: name.toLocaleLowerCase(), ...item, attendance: null, setup: null, team_mode: null, host_id: null }); } catch { return setMessage('#food-message', 'Could not save. Please check your connection and try again.'); }
      setMessage('#food-message', `Potluck registration saved for ${name}.`); event.currentTarget.reset(); await refreshShared();
    } else {
      const previous = data.food.findIndex(person => person.name.toLowerCase() === name.toLowerCase());
      const localItem = { id: previous >= 0 ? data.food[previous].id : crypto.randomUUID(), name, type: item.food_type, dish: item.dish || '' };
      if (previous >= 0) data.food[previous] = localItem; else data.food.push(localItem);
      localSave(data); setMessage('#food-message', `Potluck registration saved for ${name}.`); event.currentTarget.reset(); renderFood();
    }
  });

  function playerTeams() {
    const hosts = data.players.filter(person => person.attendance === 'play' && person.setup === 'own');
    const openHosts = hosts.filter(person => (person.team_mode || person.teamMode) === 'open');
    const soloHosts = hosts.filter(person => (person.team_mode || person.teamMode) === 'solo');
    const joiners = data.players.filter(person => person.attendance === 'play' && person.setup === 'join');
    const assignments = Object.fromEntries(openHosts.map(host => [host.id, []]));
    if (sharedMode) {
      for (const joiner of joiners) if (assignments[joiner.host_id]) assignments[joiner.host_id].push(joiner);
      const assigned = new Set(Object.values(assignments).flat().map(person => person.id));
      return { hosts, openHosts, soloHosts, joiners, assignments, pending: joiners.filter(person => !assigned.has(person.id)) };
    }
    const stored = data.teams || {};
    for (const host of openHosts) assignments[host.id] = (stored[host.id] || []).map(id => joiners.find(person => person.id === id)).filter(Boolean);
    const assigned = new Set(Object.values(assignments).flat().map(person => person.id));
    const pending = joiners.filter(person => !assigned.has(person.id));
    for (const host of openHosts) if (!assignments[host.id].length && pending.length) assignments[host.id].push(pending.shift());
    return { hosts, openHosts, soloHosts, joiners, assignments, pending };
  }

  function renderTeams() {
    const { hosts, openHosts, soloHosts, joiners, assignments, pending } = playerTeams();
    const watchers = data.players.filter(person => person.attendance === 'watch').length;
    $('#team-summary').textContent = `${data.players.length} registered · ${hosts.length + joiners.length} playing · ${watchers} watching`;
    const cards = [];
    const hostCard = (host, mates, mode) => `<article class="team-card"><div class="team-card-header"><span>🏛 TEAM · ${escapeHTML(host.name).toUpperCase()}</span><span class="team-badge">${mode === 'solo' ? 'SOLO SETUP' : 'HOST SETUP'}</span></div><div class="team-member"><span class="member-name"><span class="member-icon">♟</span>${escapeHTML(host.name)} <small>host</small></span></div>${mates.map(mate => {
      const canSwitch = !sharedMode || mate.user_id === userId;
      const control = canSwitch ? `<select class="swap-select" aria-label="Switch your team" data-member="${mate.id}" data-current="${host.id}"><option value="${host.id}">This team</option>${openHosts.filter(other => other.id !== host.id).map(other => `<option value="${other.id}">Team ${escapeHTML(other.name)}</option>`).join('')}</select>` : `<small>joining</small>`;
      return `<div class="team-member"><span class="member-name"><span class="member-icon">♟</span>${escapeHTML(mate.name)}</span>${control}</div>`;
    }).join('')}</article>`;
    for (const host of openHosts) cards.push(hostCard(host, assignments[host.id] || [], 'open'));
    for (const host of soloHosts) cards.push(hostCard(host, [], 'solo'));
    if (!cards.length && !joiners.length) $('#teams-list').innerHTML = '<div class="empty-state"><span>🏛</span><strong>No players registered.</strong><p>Player registrations will appear here.</p></div>';
    else {
      const unmatched = [...pending, ...(!openHosts.length ? joiners : [])];
      const unique = [...new Map(unmatched.map(person => [person.id, person])).values()];
      if (unique.length) cards.push(`<div class="unmatched"><strong>Players without a team</strong>${unique.map(person => `<div class="team-member"><span class="member-name"><span class="member-icon">♟</span>${escapeHTML(person.name)}</span></div>`).join('')}${openHosts.length ? 'No additional open setups are available.' : 'No players have offered an open setup.'}</div>`);
      $('#teams-list').innerHTML = cards.join('');
      document.querySelectorAll('.swap-select').forEach(select => select.addEventListener('change', async () => {
        const member = select.dataset.member, from = select.dataset.current, to = select.value;
        if (sharedMode) {
      try { await updateRow(member, { host_id: to }); await refreshShared(); } catch { setMessage('#civ-message', 'Could not change teams. Please try again.'); }
        } else {
          data.teams = data.teams || {}; data.teams[from] = (data.teams[from] || []).filter(id => id !== member);
          data.teams[to] = [...new Set([...(data.teams[to] || []), member])]; localSave(data); renderTeams();
        }
      }));
    }
  }

  function renderFood() {
    const countOf = category => data.food.filter(item => (item.food_type || item.type) === category).length;
    const counts = Object.fromEntries(categories.map(category => [category, countOf(category)]));
    const total = data.food.length; $('#food-total').textContent = `${total} ${total === 1 ? 'person' : 'people'}`;
    $('#food-roster-count').textContent = `${total} ${total === 1 ? 'dish' : 'dishes'}`;
    for (const category of categories) $(`#count-${category}`).textContent = counts[category];
    const widths = total ? categories.map(category => counts[category] / total) : [0, 0, 0, 0];
    categories.forEach((category, index) => { $(`.bar-${category}`).style.flex = widths[index] ? String(widths[index] * 100) : '0 0 0'; });
    const minimum = total ? Math.min(...categories.map(category => counts[category])) : 0;
    const least = categories.filter(category => counts[category] === minimum);
    $('#balance-tip').textContent = total === 0 ? 'No potluck registrations yet.' : least.length === categories.length ? 'All categories have equal registrations.' : `Fewest registrations: ${least.map(category => labels[category]).join(' or ')}.`;
    if (!total) { $('#food-list').innerHTML = '<div class="food-empty"><strong>No dishes registered yet.</strong><p>Potluck sign-ups will appear here.</p></div>'; return; }
    const icons = { appetizers: '🥙', mains: '🍛', desserts: '🍰', drinks: '🥤' };
    $('#food-list').innerHTML = categories.flatMap(category => data.food.filter(item => (item.food_type || item.type) === category)
      .map(item => `<article class="food-card"><div class="food-card-header"><span>${icons[category]} ${labels[category]}</span></div><strong>${escapeHTML(item.name)}</strong><p>${item.dish ? escapeHTML(item.dish) : 'Dish details not added.'}</p></article>`)).join('');
  }

  async function refreshShared() {
    if (!session || !sharedMode || refreshRunning) return;
    refreshRunning = true;
    try {
      const rows = await api('registrations?select=*&order=created_at.asc');
      data.players = rows.filter(row => row.kind === 'player'); data.food = rows.filter(row => row.kind === 'food');
      renderTeams(); renderFood(); await pairCurrentPlayer();
      $('#sync-status').textContent = 'Shared sign-ups are connected.';
    } catch (error) {
      console.error('Registration sync failed', error);
      $('#sync-status').textContent = 'Could not sync right now. Check your connection and try again.';
    } finally { refreshRunning = false; }
  }

  async function pairCurrentPlayer() {
    const openHosts = data.players.filter(person => person.attendance === 'play' && person.setup === 'own' && person.team_mode === 'open');
    if (!openHosts.length) return;
    for (const me of data.players.filter(person => person.user_id === userId && person.attendance === 'play' && person.setup === 'join' && !person.host_id)) {
      const counts = Object.fromEntries(openHosts.map(host => [host.id, data.players.filter(person => person.host_id === host.id).length]));
      const host = [...openHosts].sort((first, second) => counts[first.id] - counts[second.id])[0];
      try { await updateRow(me.id, { host_id: host.id }); me.host_id = host.id; renderTeams(); } catch { /* Retry pairing on the next refresh. */ }
    }
  }

  async function startSharedMode() {
    try {
      await ensureSession();
      sharedMode = true;
      await refreshShared();
      window.setInterval(() => { if (document.visibilityState === 'visible') refreshShared(); }, 8000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshShared(); });
    } catch (error) {
      console.error('Could not connect to shared sign-ups', error);
      $('#sync-status').textContent = 'Shared sign-ups are unavailable. Refresh this page to try again.';
    }
  }

  function setMessage(selector, message) { $(selector).textContent = message; }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  $('#clear-data').addEventListener('click', async () => {
    if (!data.players.length && !data.food.length) return;
    const prompt = sharedMode ? 'Remove your player and potluck sign-ups from the shared list?' : 'Clear all sign-ups saved in this browser?';
    if (!window.confirm(prompt)) return;
    if (sharedMode) {
      try { await deleteOwnRows(); } catch { $('#sync-status').textContent = 'Could not remove your registrations. Please try again.'; return; }
      data.teams = {};
    } else { data = { players: [], food: [], teams: {} }; localSave(data); }
    renderTeams(); renderFood(); $('#civ-message').textContent = ''; $('#food-message').textContent = '';
  });
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    if (tab.dataset.tab === 'civ') renderTeams();
  }));

  if (sharedRequested) {
    $('#sync-status').textContent = 'Connecting to shared sign-ups…';
    startSharedMode();
  } else {
    $('#sync-status').textContent = 'Sign-ups are saved in this browser only.';
    renderTeams(); renderFood();
  }
})();
