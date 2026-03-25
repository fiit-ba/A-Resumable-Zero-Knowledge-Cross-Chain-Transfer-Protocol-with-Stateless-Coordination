# =============================================================================
# smart-contracts/Makefile
#
# Deploys all contracts required by the web frontend and stateless-client relay.
#
# QUICK START (two local chains):
#   1.  anvil --port 8545 --chain-id 31337   # source chain
#   2.  anvil --port 8546 --chain-id 31338   # destination chain
#   3.  make deploy-all
#   4.  make addresses
#
# QUICK START (single chain, both connectors on one node):
#   1.  anvil --port 8545
#   2.  make deploy-local
#   3.  make addresses
#
# After deployment paste the printed addresses into the web-app transfer form or
# into web-app/.env:
#   VITE_SOURCE_CONNECTOR=0x...
#   VITE_DEST_CONNECTOR=0x...
#   VITE_TOKEN_FROM=0x...
#   VITE_TOKEN_TO=0x...
# =============================================================================

-include .env
export

# ─── Chain configuration ──────────────────────────────────────────────────────
# RPC_URL is the legacy single-chain variable (read from .env).
# Override per-chain via RPC_URL_SOURCE / RPC_URL_DEST on the command line
# or by adding them to .env.

RPC_URL        ?= http://127.0.0.1:8545
RPC_URL_SOURCE ?= $(RPC_URL)
RPC_URL_DEST   ?= http://127.0.0.1:8546

# Deployer key (no 0x prefix or with — both work with foundry).
PRIVATE_KEY ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# ─── Token configuration ──────────────────────────────────────────────────────
TOKEN_NAME_SRC    ?= SourceToken
TOKEN_SYMBOL_SRC  ?= SRC
TOKEN_NAME_DEST   ?= DestToken
TOKEN_SYMBOL_DEST ?= DST

# Amount minted to the deployer wallet by `make mint-*`  (18 decimals → 10 000 tokens)
MINT_AMOUNT ?= 10000000000000000000000
# Optional explicit recipient for mint targets.
# If omitted, defaults to address derived from PRIVATE_KEY.
RECIPIENT ?=

# ─── Tooling ──────────────────────────────────────────────────────────────────
FORGE := forge
CAST  := cast

# Convenience alias: forge script with broadcast + given private key
define forge-script
	$(FORGE) script $(1) \
		--rpc-url $(2) \
		--private-key $(PRIVATE_KEY) \
		--broadcast \
		--slow \
		-vvv
endef

# =============================================================================
# Build / Test / Clean
# =============================================================================

.PHONY: build
build: ## Compile all contracts
	$(FORGE) build

.PHONY: test
test: ## Run the full test suite
	$(FORGE) test -vv

.PHONY: test-verbose
test-verbose: ## Run tests with full traces
	$(FORGE) test -vvvv

.PHONY: clean
clean: ## Remove build artefacts
	$(FORGE) clean

# =============================================================================
# Two-chain local deployment  (primary target for frontend / stateless-client)
# =============================================================================

## Deploy tokens + connectors on BOTH source and destination chains.
.PHONY: deploy-all
deploy-all: deploy-tokens deploy-connectors
	@echo ""
	@echo "================================================================"
	@echo "  All contracts deployed. Run 'make addresses' for a summary."
	@echo "================================================================"

## Deploy MockERC20 tokens on BOTH source and destination chains.
.PHONY: deploy-tokens
deploy-tokens: deploy-source-token deploy-dest-token

## Deploy Connectors on BOTH source and destination chains.
.PHONY: deploy-connectors
deploy-connectors: deploy-source-connector deploy-dest-connector

## Deploy source-chain token on SOURCE chain.
.PHONY: deploy-source-token
deploy-source-token:
	@echo ""
	@echo ">>> [SOURCE] Deploying MockERC20 ($(TOKEN_NAME_SRC) / $(TOKEN_SYMBOL_SRC))"
	@echo "    RPC: $(RPC_URL_SOURCE)"
	$(FORGE) create script/MockERC20.s.sol:MockERC20 \
		--rpc-url $(RPC_URL_SOURCE) \
		--private-key $(PRIVATE_KEY) \
		--broadcast \
		--constructor-args "$(TOKEN_NAME_SRC)" "$(TOKEN_SYMBOL_SRC)"

## Deploy destination-chain token on DEST chain.
.PHONY: deploy-dest-token
deploy-dest-token:
	@echo ""
	@echo ">>> [DEST] Deploying MockERC20 ($(TOKEN_NAME_DEST) / $(TOKEN_SYMBOL_DEST))"
	@echo "    RPC: $(RPC_URL_DEST)"
	$(FORGE) create script/MockERC20.s.sol:MockERC20 \
		--rpc-url $(RPC_URL_DEST) \
		--private-key $(PRIVATE_KEY) \
		--broadcast \
		--constructor-args "$(TOKEN_NAME_DEST)" "$(TOKEN_SYMBOL_DEST)"

## Deploy connector on SOURCE chain.
.PHONY: deploy-source-connector
deploy-source-connector:
	@echo ""
	@echo ">>> [SOURCE] Deploying Connector (mock ZK verifiers)"
	$(call forge-script,script/Connector.s.sol:DeployConnector,$(RPC_URL_SOURCE))

## Deploy connector on DEST chain.
.PHONY: deploy-dest-connector
deploy-dest-connector:
	@echo ""
	@echo ">>> [DEST] Deploying Connector (mock ZK verifiers)"
	$(call forge-script,script/Connector.s.sol:DeployConnector,$(RPC_URL_DEST))

## Backwards-compatible source deployment (token + connector).
.PHONY: deploy-source
deploy-source: deploy-source-token deploy-source-connector

## Backwards-compatible destination deployment (token + connector).
.PHONY: deploy-dest
deploy-dest: deploy-dest-token deploy-dest-connector

# =============================================================================
# Single-chain local deployment  (quick dev — both connectors on one node)
# =============================================================================

## Deploy source token, dest token, and BOTH connectors all on RPC_URL_SOURCE.
## Useful when running a single anvil instance for fast iteration.
.PHONY: deploy-local
deploy-local:
	@echo ""
	@echo ">>> [LOCAL] Deploying source MockERC20 ($(TOKEN_NAME_SRC))"
	$(FORGE) create script/MockERC20.s.sol:MockERC20 \
		--rpc-url $(RPC_URL_SOURCE) \
		--private-key $(PRIVATE_KEY) \
		--broadcast \
		--constructor-args "$(TOKEN_NAME_SRC)" "$(TOKEN_SYMBOL_SRC)"
	@echo ""
	@echo ">>> [LOCAL] Deploying dest MockERC20 ($(TOKEN_NAME_DEST))"
	$(FORGE) create script/MockERC20.s.sol:MockERC20 \
		--rpc-url $(RPC_URL_SOURCE) \
		--private-key $(PRIVATE_KEY) \
		--broadcast \
		--constructor-args "$(TOKEN_NAME_DEST)" "$(TOKEN_SYMBOL_DEST)"
	@echo ""
	@echo ">>> [LOCAL] Deploying SOURCE Connector"
	$(call forge-script,script/Connector.s.sol:DeployConnector,$(RPC_URL_SOURCE))
	@echo ""
	@echo ">>> [LOCAL] Deploying DEST Connector"
	$(call forge-script,script/Connector.s.sol:DeployConnector,$(RPC_URL_SOURCE))
	@echo ""
	@echo "==================================================================="
	@echo "  Local deployment complete. Run 'make addresses' for a summary."
	@echo "==================================================================="

# =============================================================================
# Token minting helpers
# =============================================================================

## Mint MINT_AMOUNT source tokens to the deployer wallet.
## Usage: make mint-source TOKEN_SRC=0x<deployed-token-address>
.PHONY: mint-source
mint-source:
	@test -n "$(TOKEN_SRC)" || \
		(echo "ERROR: TOKEN_SRC not set. Usage: make mint-source TOKEN_SRC=0x..." && exit 1)
	@to="$(RECIPIENT)"; \
	if [ -z "$$to" ]; then \
		to=$$($(CAST) wallet address --private-key $(PRIVATE_KEY)); \
	fi; \
	echo "Minting $(MINT_AMOUNT) source tokens to $$to on $(RPC_URL_SOURCE)"; \
	TOKEN=$(TOKEN_SRC) RECIPIENT=$$to MINT_AMOUNT=$(MINT_AMOUNT) \
	$(call forge-script,script/MintMockERC20.s.sol:MintMockERC20,$(RPC_URL_SOURCE))

## Mint MINT_AMOUNT dest tokens to the deployer wallet.
## Usage: make mint-dest TOKEN_DEST=0x<deployed-token-address>
.PHONY: mint-dest
mint-dest:
	@test -n "$(TOKEN_DEST)" || \
		(echo "ERROR: TOKEN_DEST not set. Usage: make mint-dest TOKEN_DEST=0x..." && exit 1)
	@to="$(RECIPIENT)"; \
	if [ -z "$$to" ]; then \
		to=$$($(CAST) wallet address --private-key $(PRIVATE_KEY)); \
	fi; \
	echo "Minting $(MINT_AMOUNT) dest tokens to $$to on $(RPC_URL_DEST)"; \
	TOKEN=$(TOKEN_DEST) RECIPIENT=$$to MINT_AMOUNT=$(MINT_AMOUNT) \
	$(call forge-script,script/MintMockERC20.s.sol:MintMockERC20,$(RPC_URL_DEST))

# =============================================================================
# Funding helper  (only needed when using a non-default anvil key)
# =============================================================================

# Anvil account #0 always has 10 000 ETH on a fresh local node.
ANVIL_FUNDED_KEY := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
FUND_AMOUNT      ?= 10ether

## Send ETH from anvil account #0 to the PRIVATE_KEY deployer address.
## Only needed if PRIVATE_KEY is not one of the default anvil accounts.
.PHONY: fund-deployer
fund-deployer:
	$(CAST) send \
		$$($(CAST) wallet address --private-key $(PRIVATE_KEY)) \
		--value $(FUND_AMOUNT) \
		--rpc-url $(RPC_URL_SOURCE) \
		--private-key $(ANVIL_FUNDED_KEY)

# =============================================================================
# Production deployment  (real RiscZero / Snark verifiers)
# =============================================================================

## Deploy a production RiscZeroAdapter.
## Requires: RISC0_VERIFIER in .env (+ optionally *_IMAGE_ID vars).
.PHONY: deploy-risc0-adapter
deploy-risc0-adapter:
	$(call forge-script,script/DeployRiscZeroAdapter.s.sol:DeployRiscZeroAdapter,$(RPC_URL))

## Deploy Connector with pre-deployed adapters.
## Requires: RISC0_ADAPTER, SNARK_ADAPTER, ACK_WINDOW_SECONDS in .env.
.PHONY: deploy-connector-prod
deploy-connector-prod:
	$(call forge-script,script/DeployConnectorWithAdapters.s.sol:DeployConnectorWithAdapters,$(RPC_URL))

# =============================================================================
# Inspect deployed addresses from forge broadcast logs
# =============================================================================

## Print every CREATE transaction from all broadcast run-latest.json files.
.PHONY: addresses
addresses:
	@echo ""
	@echo "======================================================"
	@echo "  Deployed contract addresses (from broadcast logs)"
	@echo "======================================================"
	@found=0; \
	for f in $$(find broadcast -name "run-latest.json" 2>/dev/null | sort); do \
		found=1; \
		echo ""; \
		echo "  $$f"; \
		if command -v jq >/dev/null 2>&1; then \
			jq -r '.transactions[]? | select(.transactionType == "CREATE" and .contractAddress != null) | "    \(.contractName // "?") \(.contractAddress)"' "$$f"; \
		elif command -v python3 >/dev/null 2>&1; then \
			python3 -c "import json,sys; d=json.load(open(sys.argv[1])); [print('    %-28s %s' % (t.get('contractName','?'), t.get('contractAddress'))) for t in d.get('transactions', []) if t.get('transactionType') == 'CREATE' and t.get('contractAddress')]" "$$f"; \
		else \
			grep -Eo '"contractAddress"[[:space:]]*:[[:space:]]*"[^"]+"' "$$f" | \
			sed -E 's/.*:[[:space:]]*"([^"]+)".*/    ?                            \1/' | head -10; \
		fi; \
	done; \
	if [ "$$found" = "0" ]; then \
		echo "  No broadcast logs found. Run 'make deploy-all' or 'make deploy-local' first."; \
	fi
	@echo ""

# =============================================================================
# Help
# =============================================================================

.PHONY: help
help: ## Show available targets
	@echo ""
	@echo "Usage: make <target> [VAR=value ...]"
	@echo ""
	@echo "Key variables (override on command line or in .env):"
	@echo "  RPC_URL_SOURCE   source-chain RPC  (default: http://127.0.0.1:8545)"
	@echo "  RPC_URL_DEST     dest-chain RPC    (default: http://127.0.0.1:8546)"
	@echo "  PRIVATE_KEY      deployer key"
	@echo "  TOKEN_NAME_SRC / TOKEN_SYMBOL_SRC"
	@echo "  TOKEN_NAME_DEST / TOKEN_SYMBOL_DEST"
	@echo "  MINT_AMOUNT      tokens to mint (wei, default 10 000 × 10^18)"
	@echo "  FUND_AMOUNT      ETH sent by fund-deployer (default: 10ether)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'
	@echo ""

.DEFAULT_GOAL := help
