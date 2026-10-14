#!/usr/bin/env bash
# TeleLab install / update script for the VPS.
#   bash scripts/install.sh
# First run: asks for the web password, creates .env, starts everything.
# Later runs: rebuilds and restarts with the existing .env.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN_DEFAULT="telelab.balintelekes.hu"
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mHiba: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "a docker nincs telepítve"
docker compose version >/dev/null 2>&1 || die "a docker compose plugin hiányzik: apt install -y docker-compose-plugin"

say "Régi TeleLab konténerek leállítása"
docker compose down --remove-orphans >/dev/null 2>&1 || true

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
  read -rp "Felhasználónév a webes belépéshez [telelab]: " user
  user=${user:-telelab}
  while true; do
    read -rsp "Jelszó a webes belépéshez: " pw1; echo
    read -rsp "Jelszó még egyszer: " pw2; echo
    [ -n "$pw1" ] && [ "$pw1" = "$pw2" ] && break
    echo "A két jelszó nem egyezik vagy üres, próbáld újra."
  done
  echo "Jelszó titkosítása..."
  hash=$(docker run --rm caddy:2 caddy hash-password --plaintext "$pw1")
  unset pw1 pw2
  dbpw=$(openssl rand -hex 24)
  umask 077
  cat > .env <<EOF
DOMAIN=$domain
PUBLIC_IP=$ip
POSTGRES_PASSWORD=$dbpw
BASIC_AUTH_USER=$user
BASIC_AUTH_HASH='$hash'
RECORD_DAYS=7
EOF
  echo ".env kész (webcím: $domain, szerver IP: $ip)."
else
  say "Meglévő .env használata"
fi

mkdir -p data/recordings
chown 10001:10001 data/recordings

say "Építés és indítás (az első alkalommal pár perc)"
docker compose up -d --build --remove-orphans

say "Várakozás a szerver indulására"
for _ in $(seq 1 90); do
  if docker compose logs app 2>/dev/null | grep -q "http listening"; then
    domain=$(grep '^DOMAIN=' .env | cut -d= -f2)
    docker compose ps
    say "Kész! Nyisd meg: https://$domain"
    echo "Belépés: a megadott felhasználónév és jelszó."
    echo "Élő napló: docker compose logs -f app"
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 50 app
die "a szerver 3 percen belül nem indult el, a napló fent látható"
