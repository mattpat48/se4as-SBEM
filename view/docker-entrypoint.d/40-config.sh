#!/bin/sh
# Writes the browser runtime configuration from the VIEW_MQTT_* variables.
set -eu

url="${VIEW_MQTT_URL:-ws://localhost:9001}"
user="${VIEW_MQTT_USERNAME:-view}"
password="${VIEW_MQTT_PASSWORD:-}"

for value in "$url" "$user" "$password"; do
  case "$value" in
    *\"*|*\\*)
      echo '40-config.sh: VIEW_MQTT_* non può contenere " o \' >&2
      exit 1
      ;;
  esac
done

printf 'window.__VIEW_CONFIG__ = {"mqttUrl": "%s", "username": "%s", "password": "%s"};\n' \
  "$url" "$user" "$password" > /usr/share/nginx/html/config.js
