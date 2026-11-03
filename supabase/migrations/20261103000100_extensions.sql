-- Extensions live in the `extensions` schema (Supabase convention).
create schema if not exists extensions;

create extension if not exists postgis with schema extensions;   -- distance / radius search
create extension if not exists vector with schema extensions;    -- profile embeddings
create extension if not exists pg_trgm with schema extensions;   -- fuzzy name matching
