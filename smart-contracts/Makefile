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
SOURCE_NETWORK ?= source
DEST_NETWORK   ?= destination

# Deployer key is loaded from smart-contracts/.env (required for deploy/mint/fund targets).
# Format accepted by Foundry: with or without 0x prefix.
PRIVATE_KEY ?=

# ─── Production deployment configuration ──────────────────────────────────────
# Single value fallback for both chains:
ACK_WINDOW_SECONDS ?= 3600

# Chain-specific overrides:
ACK_WINDOW_SECONDS_SOURCE ?= $(ACK_WINDOW_SECONDS)
ACK_WINDOW_SECONDS_DEST   ?= $(ACK_WINDOW_SECONDS)

# Chain-specific adapter addresses used by deploy-*-connector-prod targets.
RISC0_ADAPTER_SOURCE ?=
SNARK_ADAPTER_SOURCE ?=
RISC0_ADAPTER_DEST   ?=
SNARK_ADAPTER_DEST   ?=

# Optional: pre-deployed WrappedTokenFactory address per chain.
# If left empty, deploy-*-connector-prod will deploy a fresh factory automatically.
WRAPPED_TOKEN_FACTORY_SOURCE ?=
WRAPPED_TOKEN_FACTORY_DEST   ?=

# Default guest image IDs from current repo builds.
BYTES32_ZERO                ?= 0x0000000000000000000000000000000000000000000000000000000000000000
ORIGIN_MINT_IMAGE_ID        ?= 0x5ab55c3e99a94be256acd6f786e7b9ff19b7b3665233a2adf086a6ae7daad736
ORIGIN_BURN_IMAGE_ID        ?= 0xa9decb43bf304fe0d047baf4aa6c613f566c9d5f89e82aa1b156d51fadfcc390
DEST_LOCK_IMAGE_ID          ?= 0x20a6b70fd94b1eef9415e6acf26d61732d54fc94d43cb99290ad5b1174fb3545
DEST_ACK_IMAGE_ID           ?= 0xca03b49170b4091a352759887eb483ae4624a5b780223f85b8742249e3b814fb
DEST_REFUND_CLAIM_IMAGE_ID  ?= 0x3e1fb2ad43fb2f08627576c6ddeb107a228751a682355da65e05b3fcadd4f0f5

# By default source connector enables origin routes; destination connector enables dest routes.
ORIGIN_MINT_IMAGE_ID_SOURCE       ?= $(ORIGIN_MINT_IMAGE_ID)
ORIGIN_BURN_IMAGE_ID_SOURCE       ?= $(ORIGIN_BURN_IMAGE_ID)
DEST_LOCK_IMAGE_ID_SOURCE         ?= $(BYTES32_ZERO)
DEST_ACK_IMAGE_ID_SOURCE          ?= $(BYTES32_ZERO)
DEST_REFUND_CLAIM_IMAGE_ID_SOURCE ?= $(BYTES32_ZERO)

ORIGIN_MINT_IMAGE_ID_DEST       ?= $(BYTES32_ZERO)
ORIGIN_BURN_IMAGE_ID_DEST       ?= $(BYTES32_ZERO)
DEST_LOCK_IMAGE_ID_DEST         ?= $(DEST_LOCK_IMAGE_ID)
DEST_ACK_IMAGE_ID_DEST          ?= $(DEST_ACK_IMAGE_ID)
DEST_REFUND_CLAIM_IMAGE_ID_DEST ?= $(DEST_REFUND_CLAIM_IMAGE_ID)

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
SLITHER ?= slither

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

.PHONY: lint-sol
lint-sol: ## Run Solhint for Solidity sources
	npm run lint

.PHONY: slither
slither: ## Run Slither static analysis (non-blocking exit code)
	$(SLITHER) . --config-file slither.config.json --fail-none

.PHONY: slither-strict
slither-strict: ## Run Slither static analysis and fail on high severity findings
	$(SLITHER) . --config-file slither.config.json --fail-high

.PHONY: require-private-key
require-private-key:
	@test -n "$(PRIVATE_KEY)" || \
		(echo "ERROR: PRIVATE_KEY is not set. Define it in smart-contracts/.env." && exit 1)

.PHONY: test
test: ## Run the full test suite
	$(FORGE) test -vv

.PHONY: test-verbose
test-verbose: ## Run tests with full traces
	$(FORGE) test -vvvv

.PHONY: coverage
coverage: ## Run test coverage (--ir-minimum bypasses stack-too-deep on functions with many params)
	$(FORGE) coverage --ir-minimum

.PHONY: coverage-lcov
coverage-lcov: ## Run test coverage and write lcov.info (for genhtml / IDE plugins)
	$(FORGE) coverage --ir-minimum --report lcov

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
deploy-source-token: require-private-key
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
deploy-dest-token: require-private-key
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
deploy-source-connector: require-private-key
	@echo ""
	@echo ">>> [SOURCE] Deploying Connector (mock ZK verifiers)"
	$(call forge-script,script/Connector.s.sol:DeployConnector,$(RPC_URL_SOURCE))

## Deploy connector on DEST chain.
.PHONY: deploy-dest-connector
deploy-dest-connector: require-private-key
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
deploy-local: require-private-key
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
mint-source: require-private-key
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
mint-dest: require-private-key
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
fund-deployer: require-private-key
	$(CAST) send \
		$$($(CAST) wallet address --private-key $(PRIVATE_KEY)) \
		--value $(FUND_AMOUNT) \
		--rpc-url $(RPC_URL_SOURCE) \
		--private-key $(ANVIL_FUNDED_KEY)

# =============================================================================
# Production deployment  (real RiscZero / Snark verifiers)
# =============================================================================

## Deploy a production RiscZeroAdapter.
## Optional: RISC0_VERIFIER in .env. If unset, DeployRiscZeroAdapter deploys a verifier first.
## Optionally accepts *_IMAGE_ID vars.
.PHONY: deploy-risc0-adapter
deploy-risc0-adapter: require-private-key
	$(call forge-script,script/DeployRiscZeroAdapter.s.sol:DeployRiscZeroAdapter,$(RPC_URL))

## Deploy Connector with pre-deployed adapters.
## Requires: RISC0_ADAPTER, SNARK_ADAPTER, ACK_WINDOW_SECONDS in .env.
.PHONY: deploy-connector-prod
deploy-connector-prod: require-private-key
	$(call forge-script,script/DeployConnectorWithAdapters.s.sol:DeployConnectorWithAdapters,$(RPC_URL))

## Deploy production Connector on SOURCE chain with source-specific adapter/image-id config.
.PHONY: deploy-source-connector-prod
deploy-source-connector-prod: require-private-key ## Deploy production connector on source chain
	@test -n "$(RISC0_ADAPTER_SOURCE)" || \
		(echo "ERROR: RISC0_ADAPTER_SOURCE not set." && exit 1)
	@test -n "$(SNARK_ADAPTER_SOURCE)" || \
		(echo "ERROR: SNARK_ADAPTER_SOURCE not set." && exit 1)
	@echo ""
	@echo ">>> [$(SOURCE_NETWORK)] Deploying production Connector"
	@echo "    RPC: $(RPC_URL_SOURCE)"
	@RISC0_ADAPTER="$(RISC0_ADAPTER_SOURCE)" \
	SNARK_ADAPTER="$(SNARK_ADAPTER_SOURCE)" \
	ACK_WINDOW_SECONDS="$(ACK_WINDOW_SECONDS_SOURCE)" \
	WRAPPED_TOKEN_FACTORY="$(WRAPPED_TOKEN_FACTORY_SOURCE)" \
	ORIGIN_MINT_IMAGE_ID="$(ORIGIN_MINT_IMAGE_ID_SOURCE)" \
	ORIGIN_BURN_IMAGE_ID="$(ORIGIN_BURN_IMAGE_ID_SOURCE)" \
	DEST_LOCK_IMAGE_ID="$(DEST_LOCK_IMAGE_ID_SOURCE)" \
	DEST_ACK_IMAGE_ID="$(DEST_ACK_IMAGE_ID_SOURCE)" \
	DEST_REFUND_CLAIM_IMAGE_ID="$(DEST_REFUND_CLAIM_IMAGE_ID_SOURCE)" \
	$(call forge-script,script/DeployConnectorWithAdapters.s.sol:DeployConnectorWithAdapters,$(RPC_URL_SOURCE))

## Deploy production Connector on DEST chain with destination-specific adapter/image-id config.
.PHONY: deploy-dest-connector-prod
deploy-dest-connector-prod: require-private-key ## Deploy production connector on destination chain
	@test -n "$(RISC0_ADAPTER_DEST)" || \
		(echo "ERROR: RISC0_ADAPTER_DEST not set." && exit 1)
	@test -n "$(SNARK_ADAPTER_DEST)" || \
		(echo "ERROR: SNARK_ADAPTER_DEST not set." && exit 1)
	@echo ""
	@echo ">>> [$(DEST_NETWORK)] Deploying production Connector"
	@echo "    RPC: $(RPC_URL_DEST)"
	@RISC0_ADAPTER="$(RISC0_ADAPTER_DEST)" \
	SNARK_ADAPTER="$(SNARK_ADAPTER_DEST)" \
	ACK_WINDOW_SECONDS="$(ACK_WINDOW_SECONDS_DEST)" \
	WRAPPED_TOKEN_FACTORY="$(WRAPPED_TOKEN_FACTORY_DEST)" \
	ORIGIN_MINT_IMAGE_ID="$(ORIGIN_MINT_IMAGE_ID_DEST)" \
	ORIGIN_BURN_IMAGE_ID="$(ORIGIN_BURN_IMAGE_ID_DEST)" \
	DEST_LOCK_IMAGE_ID="$(DEST_LOCK_IMAGE_ID_DEST)" \
	DEST_ACK_IMAGE_ID="$(DEST_ACK_IMAGE_ID_DEST)" \
	DEST_REFUND_CLAIM_IMAGE_ID="$(DEST_REFUND_CLAIM_IMAGE_ID_DEST)" \
	$(call forge-script,script/DeployConnectorWithAdapters.s.sol:DeployConnectorWithAdapters,$(RPC_URL_DEST))

## Deploy production connectors on BOTH chains in one command (e.g. Sepolia -> Chiado).
.PHONY: deploy-connectors-prod
deploy-connectors-prod: deploy-source-connector-prod deploy-dest-connector-prod ## Deploy production connectors on both chains
	@echo ""
	@echo "================================================================"
	@echo "  Production connectors deployed on $(SOURCE_NETWORK) and $(DEST_NETWORK)."
	@echo "  Run 'make addresses' for a summary."
	@echo "================================================================"

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
	@echo "Key variables (set in smart-contracts/.env):"
	@echo "  SOURCE_NETWORK / DEST_NETWORK labels for logs (e.g. sepolia / chiado)"
	@echo "  RPC_URL_SOURCE   source-chain RPC  (default: http://127.0.0.1:8545)"
	@echo "  RPC_URL_DEST     dest-chain RPC    (default: http://127.0.0.1:8546)"
	@echo "  PRIVATE_KEY      deployer key (required)"
	@echo "  RISC0_ADAPTER_SOURCE / SNARK_ADAPTER_SOURCE"
	@echo "  RISC0_ADAPTER_DEST   / SNARK_ADAPTER_DEST"
	@echo "  ACK_WINDOW_SECONDS_SOURCE / ACK_WINDOW_SECONDS_DEST"
	@echo "  WRAPPED_TOKEN_FACTORY_SOURCE / WRAPPED_TOKEN_FACTORY_DEST  (optional; auto-deployed if empty)"
	@echo "  TOKEN_NAME_SRC / TOKEN_SYMBOL_SRC"
	@echo "  TOKEN_NAME_DEST / TOKEN_SYMBOL_DEST"
	@echo "  MINT_AMOUNT      tokens to mint (wei, default 10 000 × 10^18)"
	@echo "  FUND_AMOUNT      ETH sent by fund-deployer (default: 10ether)"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'
	@echo ""

.DEFAULT_GOAL := help
