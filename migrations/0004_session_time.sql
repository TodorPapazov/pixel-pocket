-- Last-session play time, so Recent sessions can show "Played 14 min".
alter table pockets add column if not exists session_ms integer not null default 0;
alter table pockets add column if not exists played_ms integer not null default 0;
