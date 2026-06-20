require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const Stripe = require('stripe');
const { supabaseAdmin } = require('./lib/supabase');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PORT = process.env.PORT || 3000;
const SITE = process.env.SITE_URL || `http://localhost:${PORT}`;
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev-secret-change-me';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// ── Webhook Stripe (body brut, AVANT express.json) ──────────────
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send('Webhook signature invalide');
  }
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.metadata?.merchant_id) {
          await supabaseAdmin.from('merchants').update({
            stripe_customer_id: s.customer,
            subscription_status: 'active',
          }).eq('id', s.metadata.merchant_id);
        }
        break;
      }
      case 'invoice.paid': {
        const inv = event.data.object;
        const end = inv.lines?.data?.[0]?.period?.end;
        await supabaseAdmin.from('merchants').update({
          subscription_status: 'active',
          ...(end ? { current_period_end: new Date(end * 1000).toISOString() } : {}),
        }).eq('stripe_customer_id', inv.customer);
        break;
      }
      case 'invoice.payment_failed': {
        await supabaseAdmin.from('merchants').update({ subscription_status: 'past_due' }).eq('stripe_customer_id', event.data.object.customer);
        break;
      }
      case 'customer.subscription.deleted': {
        await supabaseAdmin.from('merchants').update({ subscription_status: 'canceled' }).eq('stripe_customer_id', event.data.object.customer);
        break;
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.use(express.json());
app.use(cookieParser());

// ── Sessions signées ─────────────────────────────────────────────
function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', COOKIE_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifySession(token) {
  if (!token) return null;
  const [data, sig] = (token || '').split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { return null; }
}
function setCookie(res, name, payload) {
  res.cookie(name, signSession(payload), COOKIE_OPTS);
}

// ── Middlewares auth ─────────────────────────────────────────────
function authMerchant(req, res, next) {
  const s = verifySession(req.cookies.lb_merchant);
  if (!s) return res.status(401).json({ error: 'Non connecté' });
  req.merchantId = s.id;
  next();
}
function authMerchantPage(req, res, next) {
  const s = verifySession(req.cookies.lb_merchant);
  if (!s) return res.redirect('/connexion-commercant.html');
  req.merchantId = s.id;
  next();
}
async function requireActive(req, res, next) {
  const { data: m } = await supabaseAdmin.from('merchants').select('*').eq('id', req.merchantId).single();
  if (!m || m.subscription_status !== 'active') return res.redirect('/abonnement.html');
  req.merchant = m;
  next();
}
async function requireActiveAPI(req, res, next) {
  const { data: m } = await supabaseAdmin.from('merchants').select('*').eq('id', req.merchantId).single();
  if (!m || m.subscription_status !== 'active') return res.status(402).json({ error: 'Abonnement requis' });
  req.merchant = m;
  next();
}
function getClientSession(req) { return verifySession(req.cookies.lb_client); }
function authClient(req, res, next) {
  const s = getClientSession(req);
  if (!s) return res.status(401).json({ error: 'Connexion requise' });
  req.clientId = s.id;
  req.clientName = s.name;
  req.clientEmail = s.email;
  next();
}

// ── Helpers ──────────────────────────────────────────────────────
function slugify(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}
async function uniqueSlug(name, excludeId) {
  const base = slugify(name) || 'commerce';
  let slug = base, i = 1;
  while (true) {
    const { data } = await supabaseAdmin.from('merchants').select('id').eq('slug', slug);
    if (!(data || []).find(m => m.id !== excludeId)) return slug;
    slug = `${base}-${++i}`;
  }
}

// ── Google OAuth helpers ─────────────────────────────────────────
function googleAuthUrl({ scopes, redirectUri, state }) {
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
async function exchangeCode(code, redirectUri) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  return r.json();
}
async function getGoogleProfile(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  return r.json();
}
async function refreshGoogleToken(merchant) {
  const expiry = merchant.google_token_expiry ? new Date(merchant.google_token_expiry) : null;
  if (expiry && expiry.getTime() > Date.now() + 60000) return merchant.google_access_token;
  if (!merchant.google_refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: merchant.google_refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }),
  });
  const t = await r.json();
  if (!t.access_token) return null;
  await supabaseAdmin.from('merchants').update({ google_access_token: t.access_token, google_token_expiry: new Date(Date.now() + t.expires_in * 1000).toISOString() }).eq('id', merchant.id);
  return t.access_token;
}

// ════════════════════════════════════════════════════════════════
// AUTH CLIENT (connexion Google simple)
// ════════════════════════════════════════════════════════════════
app.get('/api/auth/client/start', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google non configuré — ajoutez GOOGLE_CLIENT_ID dans vos variables d\'environnement' });
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('lb_oauth_state', state, { ...COOKIE_OPTS, maxAge: 600000 });
  res.json({ url: googleAuthUrl({ scopes: 'openid email profile', redirectUri: `${SITE}/api/auth/client/callback`, state }) });
});

app.get('/api/auth/client/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || state !== req.cookies.lb_oauth_state) return res.redirect('/?auth=error');
  try {
    const tokens = await exchangeCode(code, `${SITE}/api/auth/client/callback`);
    if (!tokens.access_token) return res.redirect('/?auth=error');
    const profile = await getGoogleProfile(tokens.access_token);
    const { data: existing } = await supabaseAdmin.from('clients').select('id').eq('google_sub', profile.sub).maybeSingle();
    let clientId;
    if (existing) {
      clientId = existing.id;
      await supabaseAdmin.from('clients').update({ email: profile.email, full_name: profile.name, avatar_url: profile.picture }).eq('id', clientId);
    } else {
      const newId = crypto.randomUUID();
      await supabaseAdmin.from('clients').insert({ id: newId, google_sub: profile.sub, email: profile.email, full_name: profile.name, avatar_url: profile.picture });
      clientId = newId;
    }
    setCookie(res, 'lb_client', { id: clientId, name: profile.name, email: profile.email, picture: profile.picture });
    res.clearCookie('lb_oauth_state');
    const back = req.cookies.lb_back || '/annuaire.html';
    res.clearCookie('lb_back');
    res.redirect(back);
  } catch (e) {
    console.error('Client Google callback error:', e);
    res.redirect('/?auth=error');
  }
});

app.get('/api/auth/client/me', (req, res) => {
  const s = getClientSession(req);
  if (!s) return res.json({ connected: false });
  res.json({ connected: true, name: s.name, email: s.email, picture: s.picture });
});

app.post('/api/auth/client/logout', (req, res) => {
  res.clearCookie('lb_client');
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
// AUTH COMMERCANT (Google + Business scope)
// ════════════════════════════════════════════════════════════════
app.get('/api/auth/merchant/start', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google non configuré — ajoutez GOOGLE_CLIENT_ID dans vos variables d\'environnement' });
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('lb_oauth_state', state, { ...COOKIE_OPTS, maxAge: 600000 });
  res.json({ url: googleAuthUrl({ scopes: 'openid email profile https://www.googleapis.com/auth/business.manage', redirectUri: `${SITE}/api/auth/merchant/callback`, state }) });
});

app.get('/api/auth/merchant/callback', async (req, res) => {
  const { code, state, error } = req.query;
  console.log('[MERCHANT CALLBACK] reçu — error:', error, '| code présent:', !!code, '| state match:', state === req.cookies.lb_oauth_state);

  if (error || !code || state !== req.cookies.lb_oauth_state) {
    console.log('[MERCHANT CALLBACK] échec validation state/code — redirection erreur');
    return res.redirect('/connexion-commercant.html?auth=error');
  }

  try {
    console.log('[MERCHANT CALLBACK] échange du code Google...');
    const tokens = await exchangeCode(code, `${SITE}/api/auth/merchant/callback`);
    console.log('[MERCHANT CALLBACK] tokens reçus — access_token présent:', !!tokens.access_token, '| erreur Google:', tokens.error || 'aucune');

    if (!tokens.access_token) {
      console.log('[MERCHANT CALLBACK] pas de access_token — redirection erreur');
      return res.redirect('/connexion-commercant.html?auth=error');
    }

    const profile = await getGoogleProfile(tokens.access_token);
    console.log('[MERCHANT CALLBACK] profil Google — email:', profile.email, '| sub:', profile.sub);

    const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    const { data: existing, error: sbError } = await supabaseAdmin.from('merchants').select('*').eq('google_sub', profile.sub).maybeSingle();
    console.log('[MERCHANT CALLBACK] recherche Supabase — trouvé:', !!existing, '| erreur Supabase:', sbError?.message || 'aucune');

    let merchantId, isNew = false;
    if (existing) {
      merchantId = existing.id;
      const { error: updateErr } = await supabaseAdmin.from('merchants').update({
        email: profile.email,
        google_access_token: tokens.access_token,
        google_refresh_token: tokens.refresh_token || existing.google_refresh_token,
        google_token_expiry: expiry,
        google_connected: true,
      }).eq('id', merchantId);
      console.log('[MERCHANT CALLBACK] update merchant — erreur:', updateErr?.message || 'aucune');
    } else {
      isNew = true;
      merchantId = crypto.randomUUID();
      const { error: insertErr } = await supabaseAdmin.from('merchants').insert({
        id: merchantId, email: profile.email, google_sub: profile.sub,
        google_access_token: tokens.access_token, google_refresh_token: tokens.refresh_token,
        google_token_expiry: expiry, google_connected: true, subscription_status: 'none',
      });
      console.log('[MERCHANT CALLBACK] insert nouveau merchant — id:', merchantId, '| erreur:', insertErr?.message || 'aucune');
    }

    setCookie(res, 'lb_merchant', { id: merchantId });
    res.clearCookie('lb_oauth_state');

    const { data: m } = await supabaseAdmin.from('merchants').select('business_name,subscription_status').eq('id', merchantId).single();
    console.log('[MERCHANT CALLBACK] lecture merchant — business_name:', m?.business_name, '| status:', m?.subscription_status, '| isNew:', isNew);

    if (isNew || !m?.business_name) return res.redirect('/inscription-commerce.html');
    if (m?.subscription_status !== 'active') return res.redirect('/abonnement.html');
    res.redirect('/dashboard');
  } catch (e) {
    console.error('[MERCHANT CALLBACK] ERREUR CRITIQUE:', e.message, e.stack);
    res.redirect('/connexion-commercant.html?auth=error');
  }
});

app.post('/api/auth/merchant/logout', (req, res) => {
  res.clearCookie('lb_merchant');
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
// PROFIL COMMERCANT
// ════════════════════════════════════════════════════════════════
app.post('/api/merchant/complete-profile', authMerchant, async (req, res) => {
  const { businessName, businessType, city, address, phone, description, offersDelivery } = req.body;
  if (!businessName || !businessType || !city) return res.status(400).json({ error: 'Nom, type et ville sont obligatoires' });
  const slug = await uniqueSlug(businessName, req.merchantId);
  await supabaseAdmin.from('merchants').update({
    business_name: businessName, business_type: businessType, city, address: address || '',
    phone: phone || '', description: description || '', slug, offers_delivery: !!offersDelivery,
  }).eq('id', req.merchantId);
  res.json({ ok: true, slug });
});

app.get('/api/merchant/me', authMerchant, async (req, res) => {
  const { data: m } = await supabaseAdmin.from('merchants').select('*').eq('id', req.merchantId).single();
  if (!m) return res.status(404).json({ error: 'Introuvable' });
  const safe = { ...m };
  delete safe.google_access_token; delete safe.google_refresh_token; delete safe.meta_access_token;
  res.json({ merchant: safe });
});

app.put('/api/merchant/profile', authMerchant, async (req, res) => {
  const { businessName, businessType, city, address, phone, description, publicVisible, offersDelivery } = req.body;
  const update = {};
  if (businessName !== undefined) update.business_name = businessName;
  if (businessType !== undefined) update.business_type = businessType;
  if (city !== undefined) update.city = city;
  if (address !== undefined) update.address = address;
  if (phone !== undefined) update.phone = phone;
  if (description !== undefined) update.description = description;
  if (publicVisible !== undefined) update.public_visible = publicVisible;
  if (offersDelivery !== undefined) update.offers_delivery = offersDelivery;
  await supabaseAdmin.from('merchants').update(update).eq('id', req.merchantId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
// STRIPE
// ════════════════════════════════════════════════════════════════
app.post('/api/checkout', authMerchant, async (req, res) => {
  const { plan } = req.body;
  const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_STARTER;
  if (!priceId) return res.status(400).json({ error: 'Plan invalide ou prix non configuré dans les variables d\'environnement' });
  const { data: m } = await supabaseAdmin.from('merchants').select('email').eq('id', req.merchantId).single();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: m?.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE}/paiement-confirme.html`,
      cancel_url: `${SITE}/abonnement.html`,
      metadata: { merchant_id: req.merchantId },
      allow_promotion_codes: true,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur Stripe' });
  }
});

app.post('/api/portal', authMerchant, async (req, res) => {
  const { data: m } = await supabaseAdmin.from('merchants').select('stripe_customer_id').eq('id', req.merchantId).single();
  if (!m?.stripe_customer_id) return res.status(400).json({ error: 'Aucun abonnement trouvé' });
  try {
    const s = await stripe.billingPortal.sessions.create({ customer: m.stripe_customer_id, return_url: `${SITE}/dashboard` });
    res.json({ url: s.url });
  } catch (e) {
    res.status(500).json({ error: 'Erreur portail' });
  }
});

// ════════════════════════════════════════════════════════════════
// GOOGLE BUSINESS PROFILE (avis)
// ════════════════════════════════════════════════════════════════
app.get('/api/google/locations', authMerchant, requireActiveAPI, async (req, res) => {
  const token = await refreshGoogleToken(req.merchant);
  if (!token) return res.status(400).json({ error: 'Google non connecté' });
  try {
    const ar = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: { Authorization: `Bearer ${token}` } });
    const ad = await ar.json();
    const account = ad.accounts?.[0];
    if (!account) return res.json({ locations: [] });
    const lr = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`, { headers: { Authorization: `Bearer ${token}` } });
    const ld = await lr.json();
    res.json({ accountId: account.name, locations: (ld.locations || []).map(l => ({ id: l.name, title: l.title })) });
  } catch (e) {
    res.status(500).json({ error: 'Erreur Google Business' });
  }
});

app.post('/api/google/select-location', authMerchant, requireActiveAPI, async (req, res) => {
  const { accountId, locationId, locationName } = req.body;
  await supabaseAdmin.from('merchants').update({ google_account_id: accountId, google_location_id: locationId, google_location_name: locationName }).eq('id', req.merchantId);
  res.json({ ok: true });
});

app.post('/api/google/sync', authMerchant, requireActiveAPI, async (req, res) => {
  const m = req.merchant;
  if (!m.google_location_id) return res.status(400).json({ error: 'Aucun établissement sélectionné' });
  const token = await refreshGoogleToken(m);
  if (!token) return res.status(400).json({ error: 'Google non connecté' });
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${m.google_location_id}/reviews`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    for (const rv of d.reviews || []) {
      await supabaseAdmin.from('google_reviews').upsert({
        merchant_id: m.id, google_review_id: rv.reviewId, reviewer_name: rv.reviewer?.displayName || 'Client',
        rating: map[rv.starRating] || 5, comment: rv.comment || '', review_created_at: rv.createTime,
        reply_text: rv.reviewReply?.comment || null, reply_status: rv.reviewReply ? 'published' : 'none',
      }, { onConflict: 'google_review_id' });
    }
    res.json({ ok: true, count: (d.reviews || []).length });
  } catch (e) {
    res.status(500).json({ error: 'Erreur synchronisation' });
  }
});

app.get('/api/google/reviews', authMerchant, requireActiveAPI, async (req, res) => {
  const { data } = await supabaseAdmin.from('google_reviews').select('*').eq('merchant_id', req.merchantId).order('review_created_at', { ascending: false });
  res.json({ reviews: data || [] });
});

app.post('/api/google/reviews/:reviewId/reply', authMerchant, requireActiveAPI, async (req, res) => {
  const { reply } = req.body;
  const token = await refreshGoogleToken(req.merchant);
  if (!token) return res.status(400).json({ error: 'Google non connecté' });
  try {
    const r = await fetch(`https://mybusiness.googleapis.com/v4/${req.merchant.google_location_id}/reviews/${req.params.reviewId}/reply`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: reply }),
    });
    if (!r.ok) return res.status(500).json({ error: 'Erreur publication Google' });
    await supabaseAdmin.from('google_reviews').update({ reply_text: reply, reply_status: 'published' }).eq('merchant_id', req.merchantId).eq('google_review_id', req.params.reviewId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ════════════════════════════════════════════════════════════════
// META (Facebook/Instagram)
// ════════════════════════════════════════════════════════════════
app.get('/api/meta/connect', authMerchant, requireActiveAPI, (req, res) => {
  if (!process.env.META_APP_ID) return res.status(500).json({ error: 'Meta non configuré' });
  const p = new URLSearchParams({ client_id: process.env.META_APP_ID, redirect_uri: `${SITE}/api/meta/callback`, state: req.merchantId, scope: 'pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish', response_type: 'code' });
  res.json({ url: `https://www.facebook.com/v19.0/dialog/oauth?${p}` });
});

app.get('/api/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !state) return res.redirect('/dashboard?meta=error');
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.META_APP_ID}&redirect_uri=${encodeURIComponent(`${SITE}/api/meta/callback`)}&client_secret=${process.env.META_APP_SECRET}&code=${code}`);
    const t = await r.json();
    if (!t.access_token) return res.redirect('/dashboard?meta=error');
    const pr = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${t.access_token}`);
    const pd = await pr.json();
    const page = pd.data?.[0];
    let igId = null;
    if (page) {
      const ig = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${t.access_token}`);
      const igd = await ig.json();
      igId = igd.instagram_business_account?.id || null;
    }
    await supabaseAdmin.from('merchants').update({ meta_connected: true, meta_access_token: t.access_token, meta_page_id: page?.id || null, meta_page_name: page?.name || null, meta_ig_account_id: igId }).eq('id', state);
    res.redirect('/dashboard?meta=connected');
  } catch (e) {
    res.redirect('/dashboard?meta=error');
  }
});

app.post('/api/meta/disconnect', authMerchant, async (req, res) => {
  await supabaseAdmin.from('merchants').update({ meta_connected: false, meta_access_token: null, meta_page_id: null, meta_page_name: null, meta_ig_account_id: null }).eq('id', req.merchantId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
// ANNUAIRE PUBLIC
// ════════════════════════════════════════════════════════════════
app.get('/api/public/merchants', async (req, res) => {
  const { type, q } = req.query;
  let query = supabaseAdmin.from('merchants').select('business_name,business_type,city,address,description,slug,offers_delivery').eq('public_visible', true).eq('subscription_status', 'active').not('slug', 'is', null);
  if (type && type !== 'all') query = query.eq('business_type', type);
  if (q) query = query.ilike('business_name', `%${q}%`);
  const { data } = await query.limit(60);
  res.json({ merchants: data || [] });
});

app.get('/api/public/merchants/:slug', async (req, res) => {
  const { data } = await supabaseAdmin.from('merchants').select('business_name,business_type,city,address,phone,description,slug,offers_delivery').eq('slug', req.params.slug).eq('public_visible', true).single();
  if (!data) return res.status(404).json({ error: 'Commerce non trouvé' });
  res.json({ merchant: data });
});

app.get('/api/public/merchants/:slug/reviews', async (req, res) => {
  const { data: m } = await supabaseAdmin.from('merchants').select('id').eq('slug', req.params.slug).single();
  if (!m) return res.status(404).json({ error: 'Commerce non trouvé' });
  const { data } = await supabaseAdmin.from('reviews').select('*').eq('merchant_id', m.id).order('created_at', { ascending: false });
  res.json({ reviews: data || [] });
});

app.get('/api/public/merchants/:slug/google-link', async (req, res) => {
  const { data } = await supabaseAdmin.from('merchants').select('business_name,city').eq('slug', req.params.slug).single();
  if (!data) return res.status(404).json({ error: 'Commerce non trouvé' });
  const q = encodeURIComponent(`${data.business_name} ${data.city}`);
  res.json({ url: `https://search.google.com/local/writereview?q=${q}` });
});

// Message client -> commerce
app.post('/api/public/merchants/:slug/message', authClient, async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message vide' });
  const { data: m } = await supabaseAdmin.from('merchants').select('id').eq('slug', req.params.slug).single();
  if (!m) return res.status(404).json({ error: 'Commerce non trouvé' });
  await supabaseAdmin.from('messages').insert({ merchant_id: m.id, client_id: req.clientId, client_name: req.clientName, client_email: req.clientEmail, message: message.trim() });
  res.json({ ok: true });
});

// Demande RDV / livraison / a emporter
app.post('/api/public/merchants/:slug/appointment', authClient, async (req, res) => {
  const { date, time, service, requestType, deliveryAddress, notes } = req.body;
  if (!date || !time) return res.status(400).json({ error: 'Date et heure obligatoires' });
  const { data: m } = await supabaseAdmin.from('merchants').select('id').eq('slug', req.params.slug).single();
  if (!m) return res.status(404).json({ error: 'Commerce non trouvé' });
  await supabaseAdmin.from('appointments').insert({
    merchant_id: m.id, client_id: req.clientId, client_name: req.clientName, client_email: req.clientEmail,
    service: service || '', request_type: requestType || 'rdv',
    appointment_date: date, appointment_time: time,
    delivery_address: deliveryAddress || '', notes: notes || '',
  });
  res.json({ ok: true });
});

// Avis LocalBoost (interne)
app.post('/api/public/merchants/:slug/review', authClient, async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Note entre 1 et 5 requise' });
  const { data: m } = await supabaseAdmin.from('merchants').select('id').eq('slug', req.params.slug).single();
  if (!m) return res.status(404).json({ error: 'Commerce non trouvé' });
  await supabaseAdmin.from('reviews').insert({ merchant_id: m.id, client_id: req.clientId, client_name: req.clientName, rating, comment: comment || '' });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
// DASHBOARD COMMERCANT (messages, RDV, avis)
// ════════════════════════════════════════════════════════════════
app.get('/api/merchant/messages', authMerchant, requireActiveAPI, async (req, res) => {
  const { data } = await supabaseAdmin.from('messages').select('*').eq('merchant_id', req.merchantId).order('created_at', { ascending: false });
  res.json({ messages: data || [] });
});
app.post('/api/merchant/messages/:id/read', authMerchant, requireActiveAPI, async (req, res) => {
  await supabaseAdmin.from('messages').update({ is_read: true }).eq('id', req.params.id).eq('merchant_id', req.merchantId);
  res.json({ ok: true });
});
app.post('/api/merchant/messages/:id/reply', authMerchant, requireActiveAPI, async (req, res) => {
  await supabaseAdmin.from('messages').update({ reply_text: req.body.reply, replied_at: new Date().toISOString(), is_read: true }).eq('id', req.params.id).eq('merchant_id', req.merchantId);
  res.json({ ok: true });
});

app.get('/api/merchant/appointments', authMerchant, requireActiveAPI, async (req, res) => {
  const { data } = await supabaseAdmin.from('appointments').select('*').eq('merchant_id', req.merchantId).order('appointment_date').order('appointment_time');
  res.json({ appointments: data || [] });
});
app.post('/api/merchant/appointments', authMerchant, requireActiveAPI, async (req, res) => {
  const { clientName, clientPhone, clientEmail, date, time, service, requestType, notes } = req.body;
  if (!clientName || !date || !time) return res.status(400).json({ error: 'Nom, date et heure obligatoires' });
  await supabaseAdmin.from('appointments').insert({ merchant_id: req.merchantId, client_name: clientName, client_phone: clientPhone || '', client_email: clientEmail || '', service: service || '', request_type: requestType || 'rdv', appointment_date: date, appointment_time: time, notes: notes || '', status: 'confirmed', source: 'merchant' });
  res.json({ ok: true });
});
app.put('/api/merchant/appointments/:id', authMerchant, requireActiveAPI, async (req, res) => {
  await supabaseAdmin.from('appointments').update({ status: req.body.status }).eq('id', req.params.id).eq('merchant_id', req.merchantId);
  res.json({ ok: true });
});
app.delete('/api/merchant/appointments/:id', authMerchant, requireActiveAPI, async (req, res) => {
  await supabaseAdmin.from('appointments').delete().eq('id', req.params.id).eq('merchant_id', req.merchantId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
// PAGES PROTEGEES
// ════════════════════════════════════════════════════════════════
app.get('/dashboard', authMerchantPage, requireActive, (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'dashboard.html'));
});
app.get('/dashboard.js', authMerchantPage, requireActive, (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'private', 'dashboard.js'));
});
app.get('/inscription-commerce.html', authMerchantPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inscription-commerce.html'));
});

// ════════════════════════════════════════════════════════════════
// FICHIERS STATIQUES
// ════════════════════════════════════════════════════════════════
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`LocalBoost démarré sur ${SITE}`));
