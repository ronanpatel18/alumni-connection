#!/usr/bin/env bash
# Sets up the hosted Supabase database:
#   1. applies every migration (supabase db push), then
#   2. copies the directory data from your local database (people, organizations,
#      positions, education, contact details, sources, groups, suppression list,
#      admin reviews). Safe to re-run: existing rows are left as they are.
#
# Not copied: accounts, members, notes, saved contacts, trips, messages,
# introductions or anything else tied to local test accounts.
#
# Needs PROD_DB_URL in .env.production.local (git-ignored): the "Session pooler"
# connection string from Supabase → Connect, with your database password filled in.
#
# Usage: npm run deploy:db
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env.production.local ]]; then
  echo "Create .env.production.local with PROD_DB_URL=... first (see docs/DEPLOYMENT.md)." >&2
  exit 1
fi
PROD_DB_URL=$(grep -E '^PROD_DB_URL=' .env.production.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
if [[ -z "$PROD_DB_URL" || "$PROD_DB_URL" == *"[YOUR-PASSWORD]"* ]]; then
  echo "PROD_DB_URL in .env.production.local is empty or still has [YOUR-PASSWORD]." >&2
  exit 1
fi
if [[ "$PROD_DB_URL" == *"127.0.0.1"* || "$PROD_DB_URL" == *"localhost"* ]]; then
  echo "PROD_DB_URL points at this machine; it should be the hosted database." >&2
  exit 1
fi

export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
LOCAL_DB=supabase_db_alumni-connection

echo "1/2 Applying migrations to the hosted database…"
npx supabase db push --db-url "$PROD_DB_URL" --include-all --yes

echo "2/2 Copying directory data…"
# Parents before children, so foreign keys hold. Reference data (industries,
# places, the institution) comes from the migrations with the same ids.
TABLES=(
  organizations
  groups
  people
  person_external_ids
  positions
  educations
  contact_points
  field_provenance
  group_memberships
  suppression_list
  profile_reviews
)
# Accounts don't exist in the hosted project, so links to local accounts are cleared.
# (A case statement, not an associative array: macOS ships bash 3.2.)
clear_links() {
  case "$1" in
    people) echo "update _stage set claimed_by_user_id = null, claimed_at = null, status = case when status in ('claimed','verified') then 'seeded' else status end" ;;
    profile_reviews) echo "update _stage set reviewed_by = null" ;;
    *) echo "select 1" ;;
  esac
}
for table in "${TABLES[@]}"; do
  rows=$(docker exec "$LOCAL_DB" psql -U postgres -At -c "select count(*) from public.$table")
  printf '  %-20s %s rows\n' "$table" "$rows"
  # Stage rows in a temp table, clear account links, then insert what isn't there yet.
  docker exec "$LOCAL_DB" psql -U postgres -At -c "\copy public.$table to stdout" \
    | docker exec -i "$LOCAL_DB" psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -q \
        -c "create temp table _stage (like public.$table)" \
        -c "\copy _stage from pstdin" \
        -c "$(clear_links "$table")" \
        -c "insert into public.$table select * from _stage on conflict do nothing"
done

echo "Done. Hosted database has $(docker exec -i "$LOCAL_DB" psql "$PROD_DB_URL" -At -c 'select count(*) from public.people') people."
