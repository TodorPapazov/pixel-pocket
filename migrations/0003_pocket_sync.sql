-- Server-revision sync + content-addressed ROM store.
-- Savestates are opaque blobs (no CRDT). Last accepted write wins;
-- a stale device is rejected and the local pocket is forked instead of dropped.

alter table pockets add column if not exists rev integer not null default 1;
alter table pockets add column if not exists rom_hash text;
alter table pockets add column if not exists device text;

create table if not exists rom_blobs (
  user_id    text not null,
  rom_hash   text not null,
  filename   text not null,
  console_id text not null,
  rom_b64    text not null,
  rom_size   integer not null,
  primary key (user_id, rom_hash)
);
