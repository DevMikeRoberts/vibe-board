#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NAMESPACE="kanban"

echo "🔨 Building images..."
cd "$PROJECT_DIR"
docker compose build

echo "📦 Importing into k3s..."
docker save kanban-server:latest | k3s ctr images import -
docker save kanban-client:latest | k3s ctr images import -

echo "🚀 Rolling out..."
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl apply -f "$SCRIPT_DIR/"
kubectl rollout restart deployment/server deployment/client -n "$NAMESPACE"
kubectl rollout status deployment/server deployment/client -n "$NAMESPACE" --timeout=60s

echo "✅ Done! Pods:"
kubectl get pods -n "$NAMESPACE"
