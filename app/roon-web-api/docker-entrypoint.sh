#!/bin/sh
set -eu

DEFAULT_SSL_DIR="/usr/src/app/config/tls"
DEFAULT_SSL_CERT="${DEFAULT_SSL_DIR}/roon-web-stack.crt"
DEFAULT_SSL_KEY="${DEFAULT_SSL_DIR}/roon-web-stack.key"

SSL_CERT_PATH="${SSL_CERT:-$DEFAULT_SSL_CERT}"
SSL_KEY_PATH="${SSL_KEY:-$DEFAULT_SSL_KEY}"

normalize_cert_path() {
  # If a relative path is provided (common when using .env files on the host),
  # map it to the mounted certs directory inside the container.
  #
  # Example:
  # - "../../certs/roon-web-stack.pem" -> "/usr/src/app/config/certs/roon-web-stack.pem"
  p="$1"
  if [ "${p#/}" = "$p" ]; then
    echo "/usr/src/app/config/certs/$(basename "$p")"
    return
  fi
  echo "$p"
}

SSL_CERT_PATH="$(normalize_cert_path "$SSL_CERT_PATH")"
SSL_KEY_PATH="$(normalize_cert_path "$SSL_KEY_PATH")"

mkdir -p "$DEFAULT_SSL_DIR"
mkdir -p "/usr/src/app/config/certs"

build_san_config() {
  # Values separated by commas. Supports DNS names and IPs.
  #
  # Priority order:
  # - CERT_HOSTS: explicit list (recommended)
  # - NAS_HOST / ROON_CORE_HOST: common envs used in this repo
  # - Always include localhost / 127.0.0.1
  HOSTS="${CERT_HOSTS:-}"
  if [ -z "$HOSTS" ]; then
    if [ "${NAS_HOST:-}" != "" ]; then
      HOSTS="${NAS_HOST}"
    elif [ "${ROON_CORE_HOST:-}" != "" ]; then
      HOSTS="${ROON_CORE_HOST}"
    fi
  fi

  if [ -z "$HOSTS" ]; then
    HOSTS="localhost,127.0.0.1"
  else
    HOSTS="${HOSTS},localhost,127.0.0.1"
  fi

  DNS_INDEX=1
  IP_INDEX=1
  ALT_NAMES=""

  OLD_IFS="$IFS"
  IFS=","
  for host in $HOSTS; do
    IFS="$OLD_IFS"
    trimmed="$(echo "$host" | xargs)"
    if [ -z "$trimmed" ]; then
      IFS=","
      continue
    fi

    case "$trimmed" in
      *[!0-9.]*)
        ALT_NAMES="${ALT_NAMES}\nDNS.${DNS_INDEX} = ${trimmed}"
        DNS_INDEX=$((DNS_INDEX + 1))
        ;;
      *)
        ALT_NAMES="${ALT_NAMES}\nIP.${IP_INDEX} = ${trimmed}"
        IP_INDEX=$((IP_INDEX + 1))
        ;;
    esac
    IFS=","
  done
  IFS="$OLD_IFS"

  printf "%b" "$ALT_NAMES"
}

ensure_tls_files() {
  if [ -f "$SSL_CERT_PATH" ] && [ -f "$SSL_KEY_PATH" ]; then
    echo "Using existing TLS cert/key:"
    echo "- cert: ${SSL_CERT_PATH}"
    echo "- key : ${SSL_KEY_PATH}"
    return
  fi

  SAN_LINES="$(build_san_config)"
  CN="${CERT_CN:-localhost}"

  OPENSSL_CFG="$(mktemp)"
  cat >"$OPENSSL_CFG" <<EOF
[req]
distinguished_name = req_distinguished_name
prompt = no
x509_extensions = v3_req

[req_distinguished_name]
CN = ${CN}

[v3_req]
subjectAltName = @alt_names

[alt_names]
${SAN_LINES}
EOF

  echo "Generating self-signed TLS cert:"
  echo "- cert: ${SSL_CERT_PATH}"
  echo "- key : ${SSL_KEY_PATH}"
  echo "- SANs: ${CERT_HOSTS:-${NAS_HOST:-${ROON_CORE_HOST:-}}} (plus localhost,127.0.0.1)"

  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -keyout "$SSL_KEY_PATH" \
    -out "$SSL_CERT_PATH" \
    -config "$OPENSSL_CFG" >/dev/null 2>&1

  rm -f "$OPENSSL_CFG"
}

ensure_tls_files

export SSL_CERT="$SSL_CERT_PATH"
export SSL_KEY="$SSL_KEY_PATH"
export HTTPS="${HTTPS:-true}"

exec "$@"


