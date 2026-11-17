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
  let client = null;
  let sharedMode = false;
  let userId = '';
  let refreshRunning = false;

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
      const { error } = await client.from('registrations').upsert({ user_id: userId, kind: 'player', name_key: name.toLocaleLowerCase(), ...registration, food_type: null, dish: null, host_id: null }, { onConflict: 'user_id,kind,name_key' });
      if (error) return setMessage('#civ-message', 'Could not save. Please check your connection and try again.');
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
      const { error } = await client.from('registrations').upsert({ user_id: userId, kind: 'food', name_key: name.toLocaleLowerCase(), ...item, attendance: null, setup: null, team_mode: null, host_id: null }, { onConflict: 'user_id,kind,name_key' });
      if (error) return setMessage('#food-message', 'Could not save. Please check your connection and try again.');
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
      const { error } = await client.from('registrations').update({ host_id: to }).eq('id', member).eq('user_id', userId);
          if (error) setMessage('#civ-message', 'Could not change teams. Please try again.'); else await refreshShared();
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
    if (!client || !sharedMode || refreshRunning) return;
    refreshRunning = true;
    try {
      const { data: rows, error } = await client.from('registrations').select('*').order('created_at');
      if (error) throw error;
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
      const { error } = await client.from('registrations').update({ host_id: host.id }).eq('id', me.id).eq('user_id', userId);
      if (!error) { me.host_id = host.id; renderTeams(); }
    }
  }

  async function startSharedMode() {
    try {
      if (!window.supabase?.createClient) throw new Error('Supabase library unavailable');
      client = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      let { data: authData, error } = await client.auth.getSession();
      if (error) throw error;
      if (!authData.session) ({ data: authData, error } = await client.auth.signInAnonymously());
      if (error || !authData.session) throw error || new Error('Could not start a guest session');
      userId = authData.session.user.id; sharedMode = true;
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
      const { error } = await client.from('registrations').delete().eq('user_id', userId);
      if (error) { $('#sync-status').textContent = 'Could not remove your registrations. Please try again.'; return; }
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
