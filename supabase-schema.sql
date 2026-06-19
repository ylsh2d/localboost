-- ================================================================
-- LOCALBOOST — SCHEMA SQL COMPLET
-- A executer dans : Supabase > SQL Editor > New query > Run
-- Peut etre relance plusieurs fois sans danger
-- ================================================================

-- TABLE 1 : clients (cree EN PREMIER car referencee ensuite)
create table if not exists clients (
  id           uuid primary key default gen_random_uuid(),
  google_sub   text unique,
  email        text,
  full_name    text,
  avatar_url   text,
  created_at   timestamptz default now()
);
alter table clients enable row level security;
drop policy if exists "clients_select" on clients;
create policy "clients_select" on clients for select using (true);

-- TABLE 2 : merchants
create table if not exists merchants (
  id                    uuid primary key default gen_random_uuid(),
  email                 text,
  google_sub            text unique,
  business_name         text,
  business_type         text,
  city                  text,
  address               text,
  phone                 text,
  description           text,
  slug                  text unique,
  public_visible        boolean default true,
  offers_delivery       boolean default false,
  stripe_customer_id    text,
  subscription_status   text default 'none',
  current_period_end    timestamptz,
  google_access_token   text,
  google_refresh_token  text,
  google_token_expiry   timestamptz,
  google_connected      boolean default false,
  google_account_id     text,
  google_location_id    text,
  google_location_name  text,
  meta_connected        boolean default false,
  meta_access_token     text,
  meta_page_id          text,
  meta_page_name        text,
  meta_ig_account_id    text,
  created_at            timestamptz default now()
);
alter table merchants enable row level security;
drop policy if exists "merchants_select" on merchants;
create policy "merchants_select" on merchants for select using (true);

-- TABLE 3 : google_reviews
create table if not exists google_reviews (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid references merchants(id) on delete cascade,
  google_review_id  text unique,
  reviewer_name     text,
  rating            int,
  comment           text,
  review_created_at timestamptz,
  reply_text        text,
  reply_status      text default 'none',
  synced_at         timestamptz default now()
);
alter table google_reviews enable row level security;
drop policy if exists "google_reviews_select" on google_reviews;
create policy "google_reviews_select" on google_reviews for select using (true);

-- TABLE 4 : messages (reference clients ET merchants)
create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid references merchants(id) on delete cascade,
  client_id    uuid references clients(id) on delete set null,
  client_name  text,
  client_email text,
  message      text not null,
  is_read      boolean default false,
  reply_text   text,
  replied_at   timestamptz,
  created_at   timestamptz default now()
);
alter table messages enable row level security;
drop policy if exists "messages_select" on messages;
create policy "messages_select" on messages for select using (true);

-- TABLE 5 : appointments
create table if not exists appointments (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid references merchants(id) on delete cascade,
  client_id        uuid references clients(id) on delete set null,
  client_name      text not null,
  client_email     text,
  client_phone     text,
  service          text,
  request_type     text default 'rdv',
  appointment_date date not null,
  appointment_time time not null,
  delivery_address text,
  notes            text,
  status           text default 'pending',
  source           text default 'client',
  created_at       timestamptz default now()
);
alter table appointments enable row level security;
drop policy if exists "appointments_select" on appointments;
create policy "appointments_select" on appointments for select using (true);

-- TABLE 6 : reviews (avis LocalBoost)
create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  client_id   uuid references clients(id) on delete set null,
  client_name text,
  rating      int not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz default now()
);
alter table reviews enable row level security;
drop policy if exists "reviews_select" on reviews;
create policy "reviews_select" on reviews for select using (true);
