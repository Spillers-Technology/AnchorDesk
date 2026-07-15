# anchordesk — k8s dev workflow
#
# Prerequisites:
#   - kubectl configured pointing at the cluster
#   - docker login ghcr.io -u <github-username> --password-stdin <<< $GITHUB_TOKEN
#   - cp k8s/dev/secrets.example.env k8s/dev/secrets.env  (and fill in values)
#
# Quickstart:
#   make secrets   # create k8s Secret from secrets.env
#   make build     # build docker images
#   make push      # push to registry
#   make deploy    # apply all manifests
#   make status    # watch pods come up
#
# Iterate:
#   make redeploy  # build + push + rollout restart (images auto-pulled)

REGISTRY   ?= ghcr.io/spillers-technology
TAG        ?= latest
NS         ?= anchordesk
BACKEND_IMG = $(REGISTRY)/anchordesk-backend:$(TAG)
WEB_IMG     = $(REGISTRY)/anchordesk-web-client:$(TAG)

.PHONY: all build push deploy redeploy secrets status logs logs-web logs-db \
        shell-backend shell-db db-push restart clean help

all: build push deploy ## Build, push, and deploy everything

# ─── Image builds ─────────────────────────────────────────────────────────────

build: ## Build both Docker images
	docker build -t $(BACKEND_IMG) ./backend
	docker build -t $(WEB_IMG) ./web-client

push: ## Push images to registry (docker login ghcr.io first)
	docker push $(BACKEND_IMG)
	docker push $(WEB_IMG)

# ─── k8s deployment ───────────────────────────────────────────────────────────

secrets: ## Create plaintext deployment secret + SOPS-managed integration secret
	@test -f k8s/dev/secrets.env || (echo "ERROR: k8s/dev/secrets.env not found. Copy secrets.example.env and fill in values." && exit 1)
	@test -f k8s/dev/integrations.sops.env || (echo "ERROR: k8s/dev/integrations.sops.env not found." && exit 1)
	kubectl create namespace $(NS) --dry-run=client -o yaml | kubectl apply -f -
	kubectl create secret generic anchordesk-secrets \
	  --from-env-file=k8s/dev/secrets.env \
	  --namespace=$(NS) \
	  --dry-run=client -o yaml | kubectl apply -f -
	sops exec-file k8s/dev/integrations.sops.env \
	  'kubectl create secret generic anchordesk-integration-secrets --from-env-file={} --namespace=$(NS) --dry-run=client -o yaml | kubectl apply -f -'
	@echo "Secrets applied."

deploy: ## Apply all k8s manifests (namespace + dev/)
	kubectl apply -f k8s/namespace.yaml
	kubectl apply -f k8s/dev/postgres/configmap-initdb.yaml
	kubectl apply -f k8s/dev/postgres/service.yaml
	kubectl apply -f k8s/dev/postgres/statefulset.yaml
	kubectl apply -f k8s/dev/backend/service.yaml
	kubectl apply -f k8s/dev/backend/deployment.yaml
	kubectl apply -f k8s/dev/web-client/service.yaml
	kubectl apply -f k8s/dev/web-client/deployment.yaml
	kubectl apply -f k8s/dev/ingress.yaml
	@echo ""
	@echo "Deployed. Watching pods (Ctrl-C to exit):"
	kubectl get pods -n $(NS) -w

restart: ## Rollout restart backend + web-client (no rebuild)
	kubectl rollout restart deployment/backend deployment/web-client -n $(NS)
	kubectl rollout status deployment/backend -n $(NS)
	kubectl rollout status deployment/web-client -n $(NS)

redeploy: build push restart ## Rebuild images, push, and restart pods

# ─── Observability ────────────────────────────────────────────────────────────

status: ## Show all resources in the anchordesk namespace
	kubectl get all -n $(NS)
	@echo ""
	kubectl get ingress -n $(NS)

logs: ## Tail backend logs
	kubectl logs -n $(NS) -l app=backend -f --tail=80

logs-web: ## Tail web-client logs
	kubectl logs -n $(NS) -l app=web-client -f --tail=80

logs-db: ## Tail Postgres logs
	kubectl logs -n $(NS) -l app=db -f --tail=80

# ─── Exec shortcuts ───────────────────────────────────────────────────────────

shell-backend: ## Open a shell in the running backend pod
	kubectl exec -it -n $(NS) deploy/backend -- /bin/bash

shell-db: ## Open a psql shell
	kubectl exec -it -n $(NS) db-0 -- \
	  sh -c 'psql -U $$POSTGRES_USER -d anchordesk'

db-push: ## Run prisma db push inside the backend pod (apply schema changes)
	kubectl exec -n $(NS) deploy/backend -- npx prisma db push

db-studio: ## Forward Prisma Studio port locally (http://localhost:5555)
	kubectl exec -n $(NS) deploy/backend -- npx prisma studio &
	kubectl port-forward -n $(NS) deploy/backend 5555:5555

# ─── Teardown ─────────────────────────────────────────────────────────────────

clean: ## Delete all anchordesk resources (keeps PVC/data)
	kubectl delete namespace $(NS) --ignore-not-found

clean-all: ## Delete everything including Longhorn PVCs (DATA LOSS)
	kubectl delete namespace $(NS) --ignore-not-found
	kubectl delete pvc -n $(NS) --all --ignore-not-found

# ─── Help ─────────────────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
