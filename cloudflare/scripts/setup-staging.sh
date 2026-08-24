#!/usr/bin/env bash
#
# Un assistant qui guide une personne pas à pas dans une procédure manuelle.
# Généré par le skill /wizard.
#
# Tout ce qui précède le marqueur « ÉTAPES » constitue la bibliothèque de
# l’assistant : ne modifiez pas cette partie à la main. Définissez les étapes
# individuelles sous le marqueur.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Bibliothèque de l’assistant : une expérience agréable et cohérente, identique
# dans chaque assistant.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

# L’auteur définit cette valeur au début de la section des étapes.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # CLÉS écrites dans ENV_FILE pendant cette exécution
WRITTEN_SECRET=() # NOMS des secrets définis pendant cette exécution
SKIPPED=()        # opérations impossibles (par exemple si gh est absent)

# _clear — efface le terminal afin de n’afficher que l’étape en cours. Ne fait
# rien si la sortie n’est pas un terminal, pour que les journaux redirigés
# restent lisibles.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "Titre" — écran d’accueil décrivant le rôle de l’assistant.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s étapes%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  Vous pilotez le navigateur ; cet assistant vous indique précisément quoi faire\n' "$DIM"
  printf '  et recueille les valeurs que vous lui transmettez. Vous pouvez l’arrêter à tout moment\n'
  printf '  avec Ctrl-C et le relancer plus tard : il mémorise les valeurs déjà enregistrées.%s\n' "$RESET"
  pause "Prêt à commencer ?"
}

# stage "Nom" — efface l’écran, annonce une étape et affiche la progression.
# L’effacement permet de ne conserver que l’étape en cours à l’écran.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Étape %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." — une ligne d’instruction simple.
say()  { printf '  %s\n' "$1"; }
# step "..." — une action à effectuer dans le navigateur.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL — ouvre l’URL dans le navigateur de l’utilisateur, sur toutes les
# plateformes, y compris WSL.
open_url() {
  local url="$1"
  printf '  %s↗ ouverture%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "impossible d’ouvrir un navigateur — ouvrez manuellement : $url"; fi
  } >/dev/null 2>&1 || warn "impossible d’ouvrir un navigateur — ouvrez manuellement : $url"
}

# pause "message" — attend que l’utilisateur confirme avoir terminé la partie manuelle.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Appuyez sur Entrée pour continuer}" "$RESET"
  read -r _ || true
}

# confirm "question" — validation o/N ; renvoie un succès en cas de réponse positive.
confirm() {
  local reply=""
  printf '  %s? %s [o/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[OoYy] ]]
}

# _existing CLÉ — valeur actuelle de la CLÉ dans ENV_FILE, si elle existe.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# ask CLÉ "Invite" — lit une valeur dans $CLÉ. Lors des exécutions suivantes,
# propose la valeur .env existante par défaut (Entrée la conserve). La saisie
# reste visible, car elle n’est pas secrète.
ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Entrée conserve la valeur actuelle]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret CLÉ "Invite" — identique à ask, mais masque la saisie.
ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Entrée conserve la valeur actuelle]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env CLÉ VALEUR — insère ou actualise CLÉ=VALEUR dans ENV_FILE (crée le
# fichier et remplace toute ligne existante). Cette opération est idempotente.
write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ valeur écrite%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NOM VALEUR — définit un secret du dépôt GitHub Actions au moyen de
# gh. Affiche et mémorise un avertissement si gh est indisponible ou non authentifié.
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ secret GitHub défini%s %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("secret GitHub $name (à définir manuellement : gh secret set $name)")
  warn "secret GitHub $name ignoré — gh n’est pas prêt ; définissez-le plus tard"
}

# set_var NOM VALEUR — définit une variable non secrète du dépôt GitHub Actions.
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ variable GitHub définie%s %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("variable GitHub $name")
  warn "variable GitHub $name ignorée — gh n’est pas prêt ; définissez-la plus tard"
}

# finish — efface l’écran, puis récapitule toute la configuration effectuée.
finish() {
  _clear
  printf '\n%s%s  ✓ Configuration terminée%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "${#WRITTEN_ENV[@]} valeur(s) écrite(s) dans $ENV_FILE : ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "${#WRITTEN_SECRET[@]} secret(s) GitHub défini(s) : ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "opérations manuelles restantes :"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# ÉTAPES — rédigez cette section. Prévoyez un appel stage() par étape effectuée
# par l’utilisateur. Remplacez l’exemple ci-dessous et adaptez TOTAL_STAGES au
# nombre d’étapes rédigées.
# ──────────────────────────────────────────────────────────────────────────

TOTAL_STAGES=8

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO_ROOT"
ENV_FILE="${PUNKS_STAGING_ENV_FILE:-cloudflare/.dev.vars.staging}"
mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

banner "Préparer et déployer Punks staging"

stage "Cloudflare — plan Workers et R2"
say "Le compte Cloudflare Punks est authentifié, les D1 et les Queues existent déjà, mais R2 n’est pas encore activé."
open_url "https://dash.cloudflare.com/"
step "Sélectionnez le compte Punks."
step "Confirmez que le plan Workers Paid est actif."
step "Ouvrez R2 Object Storage, activez R2 et acceptez la configuration de facturation demandée par Cloudflare."
if ! confirm "Workers Paid et R2 sont-ils maintenant actifs sur le compte Punks ?"; then
  warn "Arrêt sûr : aucun Worker ne sera déployé tant que R2 est indisponible."
  exit 1
fi
say "Création idempotente des buckets staging manquants et vérification des Queues."
pnpm cloudflare:staging:provision

stage "Google — application OAuth staging"
say "Cette application sert uniquement à l’identité staging."
open_url "https://console.cloud.google.com/apis/credentials"
step "Créez ou ouvrez un client OAuth 2.0 de type Application Web dédié à Punks staging."
step "Ajoutez exactement l’URI de redirection autorisée : https://staging.punks.bot/api/auth/v1/oauth/google/callback"
step "Copiez l’identifiant client puis le secret client."
ask GOOGLE_OAUTH_CLIENT_ID "Identifiant client Google :"
ask_secret GOOGLE_OAUTH_CLIENT_SECRET "Secret client Google :"
write_env GOOGLE_OAUTH_CLIENT_ID "$GOOGLE_OAUTH_CLIENT_ID"
write_env GOOGLE_OAUTH_CLIENT_SECRET "$GOOGLE_OAUTH_CLIENT_SECRET"

stage "GitHub — application OAuth staging"
say "Créez une OAuth App identité-only, sans permission Repository et distincte de toute future GitHub App."
open_url "https://github.com/settings/developers"
step "Dans OAuth Apps, créez une New OAuth App avec Homepage URL https://staging.punks.bot."
step "Utilisez exactement Authorization callback URL : https://staging.punks.bot/api/auth/v1/oauth/github/callback"
step "Copiez le Client ID, générez un nouveau Client Secret, puis copiez-le."
ask GITHUB_OAUTH_CLIENT_ID "Client ID GitHub :"
ask_secret GITHUB_OAUTH_CLIENT_SECRET "Client Secret GitHub :"
write_env GITHUB_OAUTH_CLIENT_ID "$GITHUB_OAUTH_CLIENT_ID"
write_env GITHUB_OAUTH_CLIENT_SECRET "$GITHUB_OAUTH_CLIENT_SECRET"

stage "Secrets machine staging"
say "Les clés d’attestation, d’invocation, d’opérateur et de curseurs seront générées localement avec 256 bits aléatoires."
say "Le fichier est ignoré par Git, chmod 0600, et aucune valeur n’est affichée."
pnpm cloudflare:staging:material "$ENV_FILE"

stage "Gates et bundles staging"
say "Cette étape ne déploie rien et ne lance aucune inférence distante."
SOURCE_SHA="$(git rev-parse --verify HEAD)"
pnpm cloudflare:check
pnpm cloudflare:staging:dry-run --source-sha "$SOURCE_SHA"

stage "Cloudflare — secrets des Workers"
say "Les secrets sont envoyés par sous-ensemble minimal : Auth, Attestation, API et Projector."
say "Le secret d’émission Bot reste uniquement dans Auth ; la clé privée d’attestation reste uniquement dans Attestation."
if ! confirm "Charger maintenant les secrets dans les Workers staging (versions brouillon si nécessaire) ?"; then
  warn "Arrêt avant mutation des secrets distants."
  exit 1
fi
pnpm cloudflare:staging:secrets "$ENV_FILE"

stage "Déploiement staging ordonné"
say "Ordre : Auth → Attestation → Erasure → Projector → Search → API → Bot Runtime."
say "Le dernier déploiement crée le Workflow et connecte le consumer Queue ; aucune inférence n’est déclenchée par le déploiement."
if ! confirm "Déployer maintenant les sept Workers sur staging.punks.bot ?"; then
  warn "Secrets chargés, mais Workers non déployés. Relancez l’assistant pour reprendre."
  exit 1
fi
pnpm cloudflare:staging:deploy --source-sha "$SOURCE_SHA"

stage "Smoke staging sans Workers AI"
pnpm cloudflare:smoke:staging
pnpm cloudflare:staging:status
open_url "https://staging.punks.bot/api/health"
step "Vérifiez que la réponse indique service=punks-api, environment=staging et status=ok."
step "Avec des identités staging jetables, testez Google puis GitHub : connexion, liaison explicite et déconnexion."
step "Ne déclenchez aucun Bot Wake : la première inférence Workers AI staging exige une autorisation séparée."
pause "Appuyez sur Entrée lorsque les smoke tests OAuth sont terminés."

finish
