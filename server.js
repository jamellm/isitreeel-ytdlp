const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe Price IDs
const STRIPE_PRICES = {
  light: 'price_1TRYmzDhFdEbgvvOSIcb4rWP',
  founding: 'price_1TRYo5DhFdEbgvvOgnUPzgM4',
  pro: 'price_1TRYp4DhFdEbgvvO8u5awui6',
};

const RAILWAY_URL = 'https://isitreeel-ytdlp-production.up.railway.app';

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// ── RAILWAY URL EXTRACTION ──────────────────────────────────────────────────
app.post('/api/extract-url', function(req, res) {
  var url = req.body.url;
  if (!url) return res.status(400).json({ error: 'URL required' });

  var body = JSON.stringify({ url: url });

  var options = {
    hostname: 'isitreeel-ytdlp-production.up.railway.app',
    port: 443,
    path: '/extract',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  var https = require('https');
  var proxyReq = https.request(options, function(proxyRes) {
    var data = '';
    proxyRes.on('data', function(chunk) { data += chunk; });
    proxyRes.on('end', function() {
      try { res.status(proxyRes.statusCode).json(JSON.parse(data)); }
      catch(e) { res.status(500).json({ error: 'Failed to parse response' }); }
    });
  });
  proxyReq.on('error', function(err) {
    res.status(500).json({ error: 'Video download failed: ' + err.message });
  });
  proxyReq.write(body);
  proxyReq.end();
});

// ── ANTHROPIC PROXY ──────────────────────────────────────────────────────────
app.post('/api/analyze', function(req, res) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  var body = JSON.stringify(req.body);
  var options = {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  var proxyReq = https.request(options, function(proxyRes) {
    var data = '';
    proxyRes.on('data', function(chunk) { data += chunk; });
    proxyRes.on('end', function() {
      try { res.status(proxyRes.statusCode).json(JSON.parse(data)); }
      catch(e) { res.status(proxyRes.statusCode).send(data); }
    });
  });
  proxyReq.on('error', function(err) { res.status(500).json({ error: err.message }); });
  proxyReq.write(body);
  proxyReq.end();
});

// ── STRIPE CHECKOUT ──────────────────────────────────────────────────────────
app.post('/api/checkout', function(req, res) {
  var stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

  var tier = req.body.tier;
  var priceId = STRIPE_PRICES[tier];
  if (!priceId) return res.status(400).json({ error: 'Invalid tier' });

  var origin = req.headers.origin || 'https://isitreelapp.com';
  var checkoutData = JSON.stringify({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: origin + '?upgraded=true&tier=' + tier,
    cancel_url: origin + '?cancelled=true',
    allow_promotion_codes: true,
  });

  var options = {
    hostname: 'api.stripe.com',
    port: 443,
    path: '/v1/checkout/sessions',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + stripeKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };

  // Build form-encoded body for Stripe
  var formBody = 'mode=subscription'
    + '&line_items[0][price]=' + priceId
    + '&line_items[0][quantity]=1'
    + '&success_url=' + encodeURIComponent(origin + '?upgraded=true&tier=' + tier)
    + '&cancel_url=' + encodeURIComponent(origin + '?cancelled=true')
    + '&allow_promotion_codes=true';

  options.headers['Content-Length'] = Buffer.byteLength(formBody);

  var stripeReq = https.request(options, function(stripeRes) {
    var data = '';
    stripeRes.on('data', function(chunk) { data += chunk; });
    stripeRes.on('end', function() {
      try {
        var parsed = JSON.parse(data);
        res.json({ url: parsed.url, error: parsed.error });
      } catch(e) {
        res.status(500).json({ error: 'Stripe response error' });
      }
    });
  });
  stripeReq.on('error', function(err) { res.status(500).json({ error: err.message }); });
  stripeReq.write(formBody);
  stripeReq.end();
});

// ── STRIPE WEBHOOK (verify subscription) ────────────────────────────────────
app.post('/api/verify-session', function(req, res) {
  var stripeKey = process.env.STRIPE_SECRET_KEY;
  var sessionId = req.body.sessionId;
  if (!stripeKey || !sessionId) return res.status(400).json({ error: 'Missing params' });

  var options = {
    hostname: 'api.stripe.com',
    port: 443,
    path: '/v1/checkout/sessions/' + sessionId,
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + stripeKey },
  };

  var stripeReq = https.request(options, function(stripeRes) {
    var data = '';
    stripeRes.on('data', function(chunk) { data += chunk; });
    stripeRes.on('end', function() {
      try {
        var session = JSON.parse(data);
        var tier = 'free';
        var priceId = session.line_items && session.line_items.data && session.line_items.data[0] && session.line_items.data[0].price && session.line_items.data[0].price.id;
        if (priceId === STRIPE_PRICES.pro) tier = 'pro';
        else if (priceId === STRIPE_PRICES.founding) tier = 'founding';
        else if (priceId === STRIPE_PRICES.light) tier = 'light';
        res.json({ tier, email: session.customer_details && session.customer_details.email });
      } catch(e) {
        res.status(500).json({ error: 'Parse error' });
      }
    });
  });
  stripeReq.on('error', function(err) { res.status(500).json({ error: err.message }); });
  stripeReq.end();
});

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', function(req, res) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  var stripeKey = process.env.STRIPE_SECRET_KEY;
  res.json({
    status: 'ok',
    hasAnthropicKey: !!apiKey,
    hasStripeKey: !!stripeKey,
    keyPrefix: apiKey ? apiKey.substring(0, 15) + '...' : 'MISSING'
  });
});

// ── CLIENT ROUTING ───────────────────────────────────────────────────────────
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, function() {
  console.log('IsItReel running on port ' + PORT);
});

