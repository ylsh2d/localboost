// ================================================================
// LOCALBOOST DASHBOARD — logique complète
// ================================================================

const ICONS  = { restaurant:'🍽️', coiffeur:'💇', beaute:'💅', boulangerie:'🥖', sport:'🏋️', sante:'🩺', commerce:'🛍️', autre:'📍' };
const LABELS = { restaurant:'Restaurant', coiffeur:'Coiffeur', beaute:'Institut de beauté', boulangerie:'Boulangerie', sport:'Sport / Fitness', sante:'Santé / Bien-être', commerce:'Commerce', autre:'Autre' };
const STATUS_COLOR = { pending:'var(--accent)', confirmed:'var(--green)', canceled:'var(--red)', done:'var(--muted)' };
const STATUS_LABEL = { pending:'⏳ En attente', confirmed:'✓ Confirmé', canceled:'✕ Annulé', done:'✓ Terminé' };

let merchant = null;
let reviews  = [];

function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Navigation ────────────────────────────────────────────────
const PAGE_INFO = {
  home:     ['Tableau de bord',   'Bienvenue 👋'],
  avis:     ['Avis Google',       'Gérez votre réputation en ligne'],
  social:   ['Réseaux sociaux',   'Publications et engagement'],
  messages: ['Messages',          'Vos demandes clients'],
  rdv:      ['Rendez-vous',       'Votre agenda'],
  params:   ['Mon commerce',      'Vos informations publiques'],
};

function go(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('on'));
  document.getElementById('page-' + page).classList.add('on');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('on');
  const [title, sub] = PAGE_INFO[page] || [page, ''];
  document.getElementById('tb-title').innerHTML = `${title} <span class="topbar-sub">— ${sub}</span>`;

  if (page === 'avis')     loadAvis();
  if (page === 'social')   loadSocial();
  if (page === 'messages') loadMessages();
  if (page === 'rdv')      loadRdv();
  if (page === 'params')   loadParams();
}

// ── Init / profil ─────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/merchant/me');
  if (!res.ok) { window.location.href = '/connexion-commercant.html'; return; }
  const data = await res.json();
  merchant = data.merchant;

  document.getElementById('sb-icon').textContent    = ICONS[merchant.business_type] || '🏪';
  document.getElementById('sb-name').textContent    = merchant.business_name || 'Mon commerce';
  document.getElementById('sb-type').textContent    = LABELS[merchant.business_type] || 'Commerce';
  document.getElementById('user-av').textContent    = (merchant.email || '?')[0].toUpperCase();
  document.getElementById('user-email').textContent = merchant.email || '';

  const statusLabels = { active:'✅ Actif', past_due:'⚠️ Paiement échoué', canceled:'❌ Annulé', none:'Aucun abonnement' };
  document.getElementById('plan-status').textContent = statusLabels[merchant.subscription_status] || '—';

  const link = merchant.slug ? `${location.origin}/commerce.html?slug=${merchant.slug}` : '—';
  document.getElementById('pub-link').textContent = link;

  loadHomeData();

  const p = new URLSearchParams(location.search);
  if (p.get('paiement') === 'ok') toast('🎉 Paiement confirmé ! Bienvenue sur LocalBoost.');
  if (p.get('google')   === 'connected') toast('✅ Compte Google connecté !');
  if (p.get('meta')     === 'connected') toast('✅ Facebook / Instagram connecté !');
  if (p.get('meta')     === 'error')     toast('Erreur lors de la connexion Meta.', true);
}

async function loadHomeData() {
  const [mRes, rRes] = await Promise.all([
    fetch('/api/merchant/messages'),
    fetch('/api/merchant/appointments'),
  ]);
  const msgs = (await mRes.json()).messages || [];
  const appts = (await rRes.json()).appointments || [];

  const unread  = msgs.filter(m => !m.is_read).length;
  const pending  = appts.filter(a => a.status === 'pending').length;
  const today    = new Date().toISOString().slice(0,10);
  const upcoming = appts.filter(a => a.appointment_date >= today && a.status !== 'canceled').length;

  document.getElementById('kpi-msgs').textContent = unread;
  document.getElementById('kpi-rdv').textContent  = pending;
  setBadge('badge-msg', unread);
  setBadge('badge-rdv', pending);

  // Aperçu messages
  const mDiv = document.getElementById('home-msgs');
  mDiv.innerHTML = msgs.length ? msgs.slice(0,3).map(m => `
    <div style="padding:12px 0;border-bottom:1px solid #F1F5F9">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div class="msg-av">${(m.client_name||'?')[0].toUpperCase()}</div>
        <div><div class="msg-name">${esc(m.client_name)}</div><div class="msg-date">${new Date(m.created_at).toLocaleDateString('fr-FR')}</div></div>
        ${!m.is_read ? '<span class="tag tag-amber" style="margin-left:auto">Nouveau</span>' : ''}
      </div>
      <div class="msg-text">${esc(m.message)}</div>
    </div>`).join('') : '<div class="empty">Aucun message pour le moment.</div>';

  // Aperçu RDV
  const rDiv = document.getElementById('home-rdv');
  const next3 = appts.filter(a => a.appointment_date >= today && a.status !== 'canceled').slice(0,3);
  rDiv.innerHTML = next3.length ? next3.map(a => {
    const [h,m] = a.appointment_time.split(':');
    const dateLabel = new Date(a.appointment_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
    return `<div class="rdv-item"><div class="rdv-time"><div class="rdv-h">${h}h</div><div class="rdv-m">${m}</div></div><div class="rdv-bar" style="background:${STATUS_COLOR[a.status]||'var(--muted)'}"></div><div class="rdv-info"><div class="rdv-client">${esc(a.client_name)} · ${dateLabel}</div><div class="rdv-service">${esc(a.service||'')}</div></div></div>`;
  }).join('') : '<div class="empty">Aucun rendez-vous à venir.</div>';
}

function setBadge(id, n) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = n > 0 ? 'inline-block' : 'none';
  el.textContent = n;
}

// ── Compte / session ──────────────────────────────────────────
async function logout() {
  await fetch('/api/auth/merchant/logout', { method:'POST' });
  window.location.href = '/';
}
async function portal() {
  const { url, error } = await fetch('/api/portal', { method:'POST' }).then(r=>r.json());
  if (url) window.location.href = url;
  else toast(error || 'Erreur', true);
}
function copyLink() {
  const link = document.getElementById('pub-link').textContent;
  navigator.clipboard.writeText(link).then(() => toast('✓ Lien copié !'));
}

// ── Avis Google ───────────────────────────────────────────────
function loadAvis() {
  const no = document.getElementById('avis-no-google');
  const pick = document.getElementById('avis-pick-loc');
  const main = document.getElementById('avis-main');
  no.style.display = 'none'; pick.style.display = 'none'; main.style.display = 'none';

  if (!merchant?.google_connected) { no.style.display = 'block'; return; }
  if (!merchant?.google_location_id) { pick.style.display = 'block'; loadLocs(); return; }

  main.style.display = 'block';
  document.getElementById('loc-name').textContent = merchant.google_location_name || 'votre fiche';
  fetchAvis();
}

async function connectGoogle() {
  const btn = document.getElementById('btn-google');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Redirection...';
  try {
    const { url, error } = await fetch('/api/auth/merchant/start').then(r=>r.json());
    if (url) window.location.href = url;
    else { toast(error || 'Connexion indisponible', true); btn.disabled=false; btn.innerHTML=orig; }
  } catch(e) { toast('Erreur serveur', true); btn.disabled=false; btn.innerHTML=orig; }
}

async function loadLocs() {
  const list = document.getElementById('locs-list');
  list.innerHTML = '<div class="empty">Chargement...</div>';
  const { accountId, locations } = await fetch('/api/google/locations').then(r=>r.json());
  if (!locations?.length) { list.innerHTML = '<div class="empty">Aucun établissement trouvé sur ce compte Google.</div>'; return; }
  list.innerHTML = locations.map(l => `<div class="rdv-item"><div class="rdv-info"><div class="rdv-client">${esc(l.title)}</div></div><button class="btn btn-dark btn-sm" onclick='pickLoc(${JSON.stringify(accountId)},${JSON.stringify(l.id)},${JSON.stringify(l.title)})'>Choisir</button></div>`).join('');
}

async function pickLoc(accountId, locationId, locationName) {
  await fetch('/api/google/select-location', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({accountId,locationId,locationName}) });
  toast('✅ Établissement sélectionné');
  const res = await fetch('/api/merchant/me');
  const data = await res.json();
  merchant = data.merchant;
  loadAvis();
}

async function syncAvis() {
  const btn = document.getElementById('btn-sync');
  btn.disabled = true; btn.textContent = '⏳ Synchronisation...';
  const { count, error } = await fetch('/api/google/sync', { method:'POST' }).then(r=>r.json());
  if (count !== undefined) { toast(`✅ ${count} avis synchronisé(s)`); fetchAvis(); }
  else toast(error || 'Erreur', true);
  btn.disabled = false; btn.textContent = '🔄 Synchroniser';
}

async function fetchAvis() {
  const { reviews: data } = await fetch('/api/google/reviews').then(r=>r.json());
  reviews = data || [];
  renderAvis();
  updateAvisKpis();
}

function updateAvisKpis() {
  const total = reviews.length;
  const avg = total ? (reviews.reduce((s,r)=>s+r.rating,0)/total).toFixed(1) : '—';
  const answered = reviews.filter(r=>r.reply_status==='published').length;
  const pending = total - answered;
  document.getElementById('a-rating').textContent = total ? avg+' ⭐' : '—';
  document.getElementById('a-total').textContent  = total + ' avis au total';
  document.getElementById('a-pct').textContent    = total ? Math.round(answered/total*100)+'%' : '—';
  document.getElementById('a-count').textContent  = `${answered} sur ${total}`;
  document.getElementById('a-pending').textContent = pending;
  document.getElementById('kpi-rating').textContent = total ? avg+' ⭐' : '—';
  document.getElementById('kpi-rating-sub').textContent = total ? total+' avis au total' : 'Connectez Google';
  setBadge('badge-avis', pending);

  const wrap = document.getElementById('rbar-wrap');
  if (!total) { wrap.innerHTML='<div class="empty">Aucun avis pour le moment.</div>'; return; }
  wrap.innerHTML = [5,4,3,2,1].map(n => {
    const c = reviews.filter(r=>r.rating===n).length;
    return `<div class="rbar-wrap"><div class="rbar-label"><span>${'⭐'.repeat(n)} ${n} étoile${n>1?'s':''}</span><span>${c}</span></div><div class="rbar-bg"><div class="rbar-fill" style="width:${Math.round(c/total*100)}%"></div></div></div>`;
  }).join('');
}

function renderAvis() {
  const f = document.getElementById('avis-filter').value;
  let list = reviews;
  if (f==='pending') list = list.filter(r=>r.reply_status!=='published');
  else if (f==='5') list = list.filter(r=>r.rating===5);
  else if (f==='neg') list = list.filter(r=>r.rating<=3);

  const el = document.getElementById('avis-list');
  if (!list.length) { el.innerHTML = `<div class="empty">${reviews.length===0?'Aucun avis synchronisé. Cliquez sur "Synchroniser".':'Aucun avis pour ce filtre.'}</div>`; return; }
  el.innerHTML = list.map(r => {
    const date = r.review_created_at ? new Date(r.review_created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '';
    const stars = '★'.repeat(r.rating) + `<span style="color:var(--line)">${'★'.repeat(5-r.rating)}</span>`;
    return `<div class="av-item">
      <div class="av-head">
        <div class="av-av">${(r.reviewer_name||'?')[0].toUpperCase()}</div>
        <div><div class="av-name">${esc(r.reviewer_name)}</div><div class="av-date">${date}</div><div class="av-stars">${stars}</div></div>
        <span class="tag ${r.reply_status==='published'?'tag-green':'tag-amber'}" style="margin-left:auto">${r.reply_status==='published'?'✓ Répondu':'⏳ En attente'}</span>
      </div>
      <div class="av-text">"${esc(r.comment)}"</div>
      ${r.reply_status==='published' ? `<div class="av-reply"><div class="av-reply-label">Votre réponse</div><div class="av-reply-text">${esc(r.reply_text)}</div></div>` : `<div id="av-act-${r.google_review_id}"><button class="btn btn-dark btn-sm" onclick="genReply('${r.google_review_id}')">🤖 Répondre avec IA</button></div>`}
    </div>`;
  }).join('');
}

function genReply(reviewId) {
  const r = reviews.find(x=>x.google_review_id===reviewId);
  if (!r) return;
  const el = document.getElementById('av-act-'+reviewId);
  el.innerHTML = '<div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  setTimeout(() => {
    const name = (r.reviewer_name||'').split(' ')[0] || 'cher client';
    const reply = r.rating <= 3
      ? `Merci pour votre retour sincère ${name}. Nous prenons votre remarque très au sérieux et ferons tout pour nous améliorer. N'hésitez pas à nous recontacter. 🙏`
      : `Merci beaucoup ${name} pour ce bel avis ! 🙏 Toute l'équipe est ravie de votre satisfaction. On a hâte de vous revoir très bientôt !`;
    el.innerHTML = `<textarea class="lb-textarea" id="reply-${reviewId}" style="margin-bottom:8px">${reply}</textarea>
      <button class="btn btn-dark btn-sm" onclick="publishReply('${reviewId}')">✅ Publier sur Google</button>
      <button class="btn btn-ghost btn-sm" onclick="genReply('${reviewId}')">🔄 Régénérer</button>`;
  }, 1400);
}

async function publishReply(reviewId) {
  const el = document.getElementById('av-act-'+reviewId);
  const reply = document.getElementById('reply-'+reviewId).value.trim();
  if (!reply) return;
  el.innerHTML = '<div class="empty" style="padding:8px">Publication en cours...</div>';
  const res = await fetch(`/api/google/reviews/${reviewId}/reply`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reply}) });
  if (res.ok) { toast('🎉 Réponse publiée sur votre vraie fiche Google !'); fetchAvis(); }
  else { const d = await res.json(); toast(d.error||'Erreur', true); genReply(reviewId); }
}

// ── Réseaux sociaux ───────────────────────────────────────────
function loadSocial() {
  const noMeta = document.getElementById('social-no-meta');
  const main   = document.getElementById('social-main');
  if (merchant?.meta_connected) {
    noMeta.style.display = 'none'; main.style.display = 'block';
    document.getElementById('meta-name').textContent = merchant.meta_page_name || 'votre page';
  } else {
    noMeta.style.display = 'block'; main.style.display = 'none';
  }
}

async function connectMeta() {
  const btn = document.getElementById('btn-meta');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Redirection...';
  try {
    const { url, error } = await fetch('/api/meta/connect').then(r=>r.json());
    if (url) window.location.href = url;
    else { toast(error || 'Meta non configuré', true); btn.disabled=false; btn.innerHTML=orig; }
  } catch(e) { toast('Erreur serveur', true); btn.disabled=false; btn.innerHTML=orig; }
}

async function disconnectMeta() {
  await fetch('/api/meta/disconnect', { method:'POST' });
  toast('🔌 Facebook/Instagram déconnecté');
  const d = await fetch('/api/merchant/me').then(r=>r.json());
  merchant = d.merchant;
  loadSocial();
}

const POSTS = [
  "🍕 Une envie irrésistible ce soir ? Notre nouveauté vient de sortir du four, disponible uniquement ce week-end. Pâte croustillante, garniture généreuse... Un pur régal ! 🤌\n\n📍 Réservez votre table via le lien en bio.",
  "🌟 Merci pour vos incroyables avis qui nous motivent chaque jour ! 💛\nCe week-end, on fête ça avec vous : -15% sur toute la carte avec le code MERCI15 (valable jusqu'à dimanche) 🎉",
  "✨ Chaque visite est une histoire. La vôtre commence ici.\n📍 Réservez en ligne via le lien en bio.",
];
let postIdx = 0;

function genPost() {
  const result = document.getElementById('social-result');
  const txt    = document.getElementById('social-text');
  result.classList.add('on');
  txt.innerHTML = '<div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  setTimeout(() => { txt.textContent = POSTS[postIdx++ % POSTS.length]; }, 1600);
}

function copyPost() {
  const txt = document.getElementById('social-text').textContent;
  navigator.clipboard.writeText(txt).then(() => toast('✓ Copié !'));
}

// ── Messages ──────────────────────────────────────────────────
async function loadMessages() {
  const el = document.getElementById('msgs-list');
  const { messages } = await fetch('/api/merchant/messages').then(r=>r.json());
  setBadge('badge-msg', (messages||[]).filter(m=>!m.is_read).length);
  document.getElementById('kpi-msgs').textContent = (messages||[]).filter(m=>!m.is_read).length;

  if (!messages?.length) { el.innerHTML = '<div class="empty"><span class="empty-icon">💬</span>Aucun message pour le moment.</div>'; return; }
  el.innerHTML = messages.map(m => {
    const date = new Date(m.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    return `<div class="msg-item">
      <div class="msg-head">
        <div class="msg-av">${(m.client_name||'?')[0].toUpperCase()}</div>
        <div><div class="msg-name">${esc(m.client_name)}${m.client_email?' · '+esc(m.client_email):''}</div><div class="msg-date">${date}</div></div>
        ${!m.is_read ? '<span class="tag tag-amber" style="margin-left:auto">Nouveau</span>' : ''}
      </div>
      <div class="msg-text">${esc(m.message)}</div>
      ${m.reply_text
        ? `<div class="msg-reply-block">✅ Votre réponse : ${esc(m.reply_text)}</div>`
        : `<div id="mf-${m.id}">
            <textarea class="lb-textarea" id="mt-${m.id}" style="min-height:55px;margin-bottom:8px" placeholder="Répondre à ce message..."></textarea>
            <button class="btn btn-dark btn-sm" onclick="replyMsg('${m.id}')">Envoyer</button>
            ${!m.is_read ? `<button class="btn btn-ghost btn-sm" onclick="markRead('${m.id}')">Marquer comme lu</button>` : ''}
           </div>`
      }
    </div>`;
  }).join('');
}

async function markRead(id) {
  await fetch(`/api/merchant/messages/${id}/read`, { method:'POST' });
  loadMessages(); loadHomeData();
}

async function replyMsg(id) {
  const val = document.getElementById('mt-'+id).value.trim();
  if (!val) return;
  await fetch(`/api/merchant/messages/${id}/reply`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reply:val}) });
  toast('✅ Réponse envoyée');
  loadMessages(); loadHomeData();
}

// ── RDV ───────────────────────────────────────────────────────
async function loadRdv() {
  const el = document.getElementById('rdv-list');
  const { appointments } = await fetch('/api/merchant/appointments').then(r=>r.json());
  const pending = (appointments||[]).filter(a=>a.status==='pending').length;
  setBadge('badge-rdv', pending);
  document.getElementById('kpi-rdv').textContent = pending;

  if (!appointments?.length) { el.innerHTML = '<div class="empty"><span class="empty-icon">📅</span>Aucun rendez-vous pour le moment.</div>'; return; }

  const typeLabel = { rdv:'📅 RDV', delivery:'🚴 Livraison', takeaway:'📦 À emporter' };
  el.innerHTML = appointments.map(a => {
    const [h,m] = a.appointment_time.split(':');
    const dateLabel = new Date(a.appointment_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});
    return `<div class="rdv-item">
      <div class="rdv-time"><div class="rdv-h">${h}h</div><div class="rdv-m">${m}</div></div>
      <div class="rdv-bar" style="background:${STATUS_COLOR[a.status]||'var(--muted)'}"></div>
      <div class="rdv-info">
        <div class="rdv-client">${esc(a.client_name)} · ${dateLabel}</div>
        <div class="rdv-service">${typeLabel[a.request_type]||'📅 RDV'} — ${esc(a.service||'Sans précision')}${a.client_phone?' · 📞 '+esc(a.client_phone):''}</div>
        ${a.delivery_address?`<div class="rdv-service">📍 ${esc(a.delivery_address)}</div>`:''}
      </div>
      <span class="tag" style="background:${STATUS_COLOR[a.status]}1A;color:${STATUS_COLOR[a.status]}">${STATUS_LABEL[a.status]||a.status}</span>
      <div class="rdv-acts">
        ${a.status==='pending' ? `<button class="btn btn-dark btn-sm" onclick="setStatus('${a.id}','confirmed')">Confirmer</button>` : ''}
        ${a.status!=='canceled' ? `<button class="btn btn-ghost btn-sm" onclick="setStatus('${a.id}','canceled')">Annuler</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="delRdv('${a.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function setStatus(id, status) {
  await fetch(`/api/merchant/appointments/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status}) });
  toast(status==='confirmed' ? '✅ Confirmé' : '🚫 Annulé');
  loadRdv(); loadHomeData();
}

async function delRdv(id) {
  await fetch(`/api/merchant/appointments/${id}`, { method:'DELETE' });
  toast('🗑️ Supprimé'); loadRdv(); loadHomeData();
}

async function createRdv() {
  const btn = document.getElementById('btn-create-rdv');
  const name = document.getElementById('m-name').value.trim();
  const date = document.getElementById('m-date').value;
  const time = document.getElementById('m-time').value;
  if (!name||!date||!time) { toast('Nom, date et heure sont obligatoires', true); return; }
  btn.disabled = true; btn.textContent = 'Création...';
  const res = await fetch('/api/merchant/appointments', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ clientName:name, clientPhone:document.getElementById('m-phone').value, clientEmail:document.getElementById('m-email').value, date, time, service:document.getElementById('m-service').value, requestType:document.getElementById('m-rtype').value, notes:document.getElementById('m-notes').value }),
  });
  const d = await res.json();
  btn.disabled = false; btn.textContent = 'Créer';
  if (res.ok) { toast('✅ Rendez-vous créé'); closeModal(); loadRdv(); loadHomeData(); }
  else toast(d.error||'Erreur', true);
}

// ── Paramètres ────────────────────────────────────────────────
function loadParams() {
  document.getElementById('p-name').value    = merchant.business_name || '';
  document.getElementById('p-type').value    = merchant.business_type || 'autre';
  document.getElementById('p-city').value    = merchant.city || '';
  document.getElementById('p-address').value = merchant.address || '';
  document.getElementById('p-phone').value   = merchant.phone || '';
  document.getElementById('p-desc').value    = merchant.description || '';
  document.getElementById('t-visible').classList.toggle('on', merchant.public_visible !== false);
  document.getElementById('t-delivery').classList.toggle('on', !!merchant.offers_delivery);

  const gStatus = document.getElementById('p-google-status');
  gStatus.textContent = merchant.google_connected ? '✓ Connecté' : 'Non connecté';
  gStatus.className = 'tag ' + (merchant.google_connected ? 'tag-green' : 'tag-muted');

  const mStatus = document.getElementById('p-meta-status');
  mStatus.textContent = merchant.meta_connected ? '✓ Connecté' : 'Non connecté';
  mStatus.className = 'tag ' + (merchant.meta_connected ? 'tag-green' : 'tag-muted');

  const link = merchant.slug ? `${location.origin}/commerce.html?slug=${merchant.slug}` : '—';
  document.getElementById('p-pub-link').textContent = link;
}

async function saveParams() {
  const btn = document.getElementById('btn-save');
  const msg = document.getElementById('save-msg');
  btn.disabled = true; btn.textContent = 'Enregistrement...';
  const res = await fetch('/api/merchant/profile', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      businessName:  document.getElementById('p-name').value,
      businessType:  document.getElementById('p-type').value,
      city:          document.getElementById('p-city').value,
      address:       document.getElementById('p-address').value,
      phone:         document.getElementById('p-phone').value,
      description:   document.getElementById('p-desc').value,
      publicVisible: document.getElementById('t-visible').classList.contains('on'),
      offersDelivery:document.getElementById('t-delivery').classList.contains('on'),
    }),
  });
  btn.disabled = false; btn.textContent = 'Enregistrer';
  if (res.ok) {
    msg.textContent = '✅ Modifications enregistrées'; msg.style.color = 'var(--green)';
    const d = await fetch('/api/merchant/me').then(r=>r.json());
    merchant = d.merchant;
    document.getElementById('pub-link').textContent = merchant.slug ? `${location.origin}/commerce.html?slug=${merchant.slug}` : '—';
  } else {
    msg.textContent = 'Erreur lors de l\'enregistrement'; msg.style.color = 'var(--red)';
  }
  setTimeout(() => { msg.textContent = ''; }, 4000);
}

// ── Modals ────────────────────────────────────────────────────
function openModal(id) { document.getElementById('overlay').classList.add('on'); document.getElementById('modal-'+id).style.display='block'; }
function closeModal()   { document.getElementById('overlay').classList.remove('on'); document.querySelectorAll('.modal').forEach(m=>m.style.display='none'); }
function overlayClick(e){ if (e.target===document.getElementById('overlay')) closeModal(); }

// ── Démarrage ─────────────────────────────────────────────────
init();
