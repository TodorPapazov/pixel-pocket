-- Per-player profile and synced game pockets (save states + optional ROM).
create table if not exists profiles (
  user_id      text primary key,
  display_name text not null,
  updated_at   timestamptz not null default now()
);

create table if not exists pockets (
  user_id    text not null,
  game_id    text not null,
  console_id text not null,
  name       text not null,
  filename   text not null,
  state_b64  text not null,
  sram_b64   text,
  rom_b64    text,
  rom_size   integer not null default 0,
  saved_at   timestamptz not null,
  primary key (user_id, game_id)
);

create index if not exists pockets_user_saved_idx on pockets (user_id, saved_at desc);
