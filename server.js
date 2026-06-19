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
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev-secret';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// ─────────────────────────────
// MIDDLEWARE GLOBAL (IMPORTANT ORDER)
// ─────────────────────────────
app.use(cookieParser());
app.use(express.json());

// ─────────────────────────────
// STRIPE WEBHOOK (DOIT ÊTRE AVANT express.json)
// ─────────────────────────────
app.post(
  '/api/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature invalide");
      return res.status(400).send("Invalid signature");
    }

    console.log("🔥 WEBHOOK:", event.type);

    try {

      // ── PAYMENT OK ──
      if (event.type === 'checkout.session.completed') {

        const session = event.data.object;
        const merchantId = session.metadata?.merchant_id;
        const customerId = session.customer;

        console.log("✔ PAYMENT RECEIVED:", { merchantId, customerId });

        if (!merchantId) {
          console.error("❌ merchantId manquant");
          return res.json({ ok: true });
        }

        const { error } = await supabaseAdmin
          .from('merchants')
          .update({
            subscription_status: 'active',
            stripe_customer_id: customerId || null,
          })
          .eq('id', merchantId);

        if (error) {
          console.error("❌ Supabase error:", error);
        }
      }

      // ── FAIL PAYMENT ──
      if (event.type === 'invoice.payment_failed') {
        const inv = event.data.object;

        await supabaseAdmin
          .from('merchants')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', inv.customer);
      }

      // ── CANCEL ──
      if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;

        await supabaseAdmin
          .from('merchants')
          .update({ subscription_status: 'canceled' })
          .eq('stripe_customer_id', sub.customer);
      }

      res.json({ ok: true });

    } catch (err) {
      console.error("❌ Webhook error:", err);
      res.status(500).json({ error: 'Webhook error' });
    }
  }
);

// ─────────────────────────────
// STRIPE CHECKOUT FIXÉ
// ─────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const { plan, merchantId } = req.body;

  const priceId =
    plan === 'pro'
      ? process.env.STRIPE_PRICE_PRO
      : process.env.STRIPE_PRICE_STARTER;

  try {

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id, email, stripe_customer_id')
      .eq('id', merchantId)
      .single();

    if (!merchant) {
      return res.status(404).json({ error: "Merchant introuvable" });
    }

    // ── CREATE CUSTOMER SI BESOIN ──
    let customerId = merchant.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: merchant.email,
        metadata: { merchant_id: merchant.id }
      });

      customerId = customer.id;

      await supabaseAdmin
        .from('merchants')
        .update({ stripe_customer_id: customerId })
        .eq('id', merchant.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE}/dashboard?paiement=ok`,
      cancel_url: `${SITE}/abonnement.html`,
      metadata: {
        merchant_id: merchant.id
      },
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Stripe error" });
  }
});

// ─────────────────────────────
// AUTH DASHBOARD CHECK (important)
// ─────────────────────────────
app.get('/api/merchant/me', async (req, res) => {
  const id = req.query.id;

  const { data } = await supabaseAdmin
    .from('merchants')
    .select('*')
    .eq('id', id)
    .single();

  res.json({ merchant: data });
});

// ─────────────────────────────
// DASHBOARD PROTECTION
// ─────────────────────────────
app.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'dashboard.html'));
});

// ─────────────────────────────
// STATIC FILES
// ─────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────
app.listen(PORT, () =>
  console.log(`🚀 Server running on ${SITE}`)
);
