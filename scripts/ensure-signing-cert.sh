#!/usr/bin/env bash
# Creates the self-signed "Nova Dev" code-signing identity in the login
# keychain, once. Stage 1 only (a local build; see docs/install.md): stage 2
# names a Developer ID through NOVA_SIGN_IDENTITY, and this script refuses to
# invent an identity under any other name.
#
# /usr/bin/openssl is LibreSSL, whose PKCS#12 output `security import`
# accepts. Homebrew's OpenSSL 3 writes a format it rejects without -legacy.
set -euo pipefail

NAME="${1:-Nova Dev}"

# Without -v: an untrusted self-signed identity is still listed, and codesign
# can still use it. Captured before grep rather than piped: `grep -q` exits on
# the first match, `security` can then die of SIGPIPE, and pipefail would read
# that as "missing" and import a second "Nova Dev" — after which every
# `codesign --sign "Nova Dev"` fails as ambiguous.
IDENTITIES="$(security find-identity -p codesigning)"
if grep -qF "\"$NAME\"" <<<"$IDENTITIES"; then
  exit 0
fi
if [[ "$NAME" != "Nova Dev" ]]; then
  echo "signing identity \"$NAME\" is not in the keychain" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/cert.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = Nova Dev
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -config "$TMP/cert.cnf" -keyout "$TMP/key.pem" -out "$TMP/cert.pem"

# The PKCS#12 password only protects the file for the one import below.
P12_PASS="nova-dev-import"
/usr/bin/openssl pkcs12 -export -name "Nova Dev" \
  -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -passout "pass:$P12_PASS" -out "$TMP/nova-dev.p12"

# -T lets codesign use the key without a keychain prompt on every build.
security import "$TMP/nova-dev.p12" -k "$HOME/Library/Keychains/login.keychain-db" \
  -P "$P12_PASS" -T /usr/bin/codesign

echo "created signing identity \"Nova Dev\" in the login keychain"
