#!/usr/bin/env bash
# TeleLab install / update script for the VPS.
#   bash scripts/install.sh
# First run: creates .env, asks for the Discord login settings, starts everything.
# Later runs: rebuilds and restarts with the existing .env.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN_DEFAULT="telelab.balintelekes.hu"
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mHiba: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "a docker nincs telepítve"
docker compose version >/dev/null 2>&1 || die "a docker compose plugin hiányzik: apt install -y docker-compose-plugin"

say "Régi TeleLab konténerek leállítása"
# By name, so this works even while .env is still incomplete.
for c in telelab-caddy telelab-app telelab-ingest; do
  docker rm -f "$c" >/dev/null 2>&1 || true
done

say "80-as és 443-as port ellenőrzése"
busy=$(ss -tlnpH '( sport = :80 or sport = :443 )' 2>/dev/null || true)
if [ -n "$busy" ]; then
  echo "$busy"
  die "a 80-as vagy 443-as portot már használja egy másik program (lásd fent). Ezt előbb le kell állítani."
fi
echo "Szabadok."

if [ ! -f .env ]; then
  say "Beállítások létrehozása (.env)"
  read -rp "Webcím [$DOMAIN_DEFAULT]: " domain
  domain=${domain:-$DOMAIN_DEFAULT}
  ip=$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  (
    umask 077
    {
      echo "DOMAIN=$domain"
      echo "PUBLIC_IP=$ip"
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
      echo "RECORD_DAYS=7"
    } > .env
  )
  echo ".env kész (webcím: $domain, szerver IP: $ip)."
else
  say "Meglévő .env használata"
fi

# setvar NAME VALUE: replace or append a line in .env
setvar() {
  local tmp
  tmp=$(mktemp)
  grep -v "^$1=" .env > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}
getvar() { grep "^$1=" .env | head -1 | cut -d= -f2- || true; }

# Discord login settings: asked once (also when upgrading an older .env).
if [ -z "$(getvar DISCORD_CLIENT_ID)" ] || [ -z "$(getvar DISCORD_CLIENT_SECRET)" ]; then
  domain=$(getvar DOMAIN)
  say "Discord-belépés beállítása"
  echo "A Discord Developer Portalon (OAuth2) ezt a Redirect címet kell megadni:"
  echo "  https://$domain/auth/discord/callback"
  read -rp "Discord Client ID: " cid
  read -rsp "Discord Client Secret (gépelés közben nem látszik): " csec; echo
  read -rp "Csapat Discord-szerverének azonosítója (Server ID): " gid
  [ -n "$cid" ] && [ -n "$csec" ] || die "a Client ID és a Client Secret kötelező"
  setvar DISCORD_CLIENT_ID "$cid"
  setvar DISCORD_CLIENT_SECRET "$csec"
  setvar DISCORD_GUILD_ID "$gid"
  unset csec
  # the temporary shared web password is no longer used
  grep -v '^BASIC_AUTH_' .env > .env.tmp || true
  cat .env.tmp > .env && rm -f .env.tmp
  echo "Discord-beállítások elmentve."
fi
chmod 600 .env

mkdir -p data/recordings
chown 10001:10001 data/recordings

say "Építés és indítás (az első alkalommal pár perc)"
docker compose up -d --build --remove-orphans

say "Várakozás a szerver indulására"
for _ in $(seq 1 90); do
  if docker compose logs app 2>/dev/null | grep -q "http listening"; then
    domain=$(getvar DOMAIN)
    docker compose ps
    say "Kész! Nyisd meg: https://$domain"
    echo "Belépés Discorddal. Aki elsőként lép be, az lesz a csapattulajdonos."
    echo "Élő napló: docker compose logs -f app"
    exit 0
  fi
  if [ "$(docker inspect -f '{{.State.Status}}' telelab-app 2>/dev/null)" = "restarting" ]; then
    docker compose logs --tail 30 app
    die "a szerver újraindul, valami hiányzik a beállításokból (lásd fent)"
  fi
  sleep 2
done
docker compose logs --tail 50 app
die "a szerver 3 percen belül nem indult el, a napló fent látható"
