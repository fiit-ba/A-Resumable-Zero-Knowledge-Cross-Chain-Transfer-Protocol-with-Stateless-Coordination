# =============================================================================
# smart-contracts/Makefile
#
# Deploys all contracts required by the web frontend and stateless-client relay.
#
# QUICK START (two local chains — three-stage setup):
#   1.  anvil --port 8545 --chain-id 31337   # source chain
#   2.  anvil --port 8546 --chain-id 31338   # destination chain
#   3.  make deploy-all                       # Stage 1: deploy tokens + connectors
#   4.  make addresses                        # print deployed addresses
#   5.  # Copy SOURCE_CONNECTOR, DEST_CONNECTOR, SOURCE_TOKEN,
#       # DEST_WRAPPED_TOKEN_FACTORY, DEST_WRAPPED_TOKEN into .env
#   6.  make bootstrap                        # Stage 2: register wrapped-token route
#   7.  make seed-test-data                   # Stage 3: mint tokens to test wallet (optional)
#
# Or run all three stages in one shot (local only):
#   make setup              # deploy-all + bootstrap
#   make setup-test-data    # deploy-all + bootstrap + seed
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

# ─── Bootstrap configuration ──────────────────────────────────────────────────
# Chain IDs used by the bootstrap scripts to compute the route key.
SOURCE_CHAIN_ID ?= 31337
DEST_CHAIN_ID   ?= 31338

# Addresses populated after deploy-all (copy from `make addresses` output).
SOURCE_CONNECTOR           ?=
DEST_CONNECTOR             ?=
SOURCE_TOKEN               ?=
DEST_WRAPPED_TOKEN_FACTORY ?=
DEST_WRAPPED_TOKEN         ?=

# ─── Seed / test-data configuration ──────────────────────────────────────────
# Optional recipient for seed-test-data; defaults to the PRIVATE_KEY address.
SEED_RECIPIENT ?=
# Amount minted to SEED_RECIPIENT (18 decimals → 1 000 tokens).
SEED_AMOUNT    ?= 1000000000000000000000

# Seconds to advance Anvil's clock for the WrappedTokenFactory 48-hour timelock (48h + 1s).
TIMELOCK_SECONDS := 172801

# Advance Anvil's clock on local nodes; print a warning on prod networks.
define warp-timelock
if echo "$(RPC_URL_DEST)" | grep -qE "127\.0\.0\.1|localhost"; then \
	echo ">>> Warping Anvil time by 48h+1s to clear WrappedTokenFactory timelock..."; \
	cast rpc --rpc-url $(RPC_URL_DEST) evm_increaseTime $(TIMELOCK_SECONDS); \
	cast rpc --rpc-url $(RPC_URL_DEST) evm_mine; \
else \
	echo ""; \
	echo "  NOTE: Production network — 48-hour timelock must elapse naturally."; \
	echo "  Run 'make apply-routes' again after the timelock expires."; \
fi
endef

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
# Fuzzing  (Echidna + Medusa)
# =============================================================================

ECHIDNA  ?= echidna
MEDUSA   ?= medusa

## Run Echidna fuzzer against the Fuzz harness (assertion + property mode)
.PHONY: echidna
echidna: ## Run Echidna fuzzer (FOUNDRY_PROFILE=echidna)
	FOUNDRY_PROFILE=echidna $(ECHIDNA) test/fuzzing/Fuzz.sol \
		--contract Fuzz \
		--config echidna-config.yaml

## Run Echidna with a reduced testLimit for quick smoke testing
.PHONY: echidna-quick
echidna-quick: ## Run Echidna fuzzer with 10K limit for a quick smoke test
	FOUNDRY_PROFILE=echidna $(ECHIDNA) test/fuzzing/Fuzz.sol \
		--contract Fuzz \
		--config echidna-config.yaml \
		--test-limit 10000

## Run Medusa fuzzer against the Fuzz harness
.PHONY: medusa
medusa: ## Run Medusa fuzzer
	$(MEDUSA) fuzz --config medusa.json

## Remove fuzzer corpus directories
.PHONY: clean-corpus
clean-corpus: ## Delete Echidna and Medusa corpus directories
	rm -rf echidna-corpus medusa-corpus

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
# Bootstrap  (Stage 2 — register wrapped-token route on dest WrappedTokenFactory)
# =============================================================================
# Set SOURCE_CONNECTOR, DEST_CONNECTOR, SOURCE_TOKEN, DEST_WRAPPED_TOKEN_FACTORY,
# DEST_WRAPPED_TOKEN in .env (or on the command line) before running these targets.

define require-bootstrap-vars
	@test -n "$(SOURCE_CONNECTOR)"           || (echo "ERROR: SOURCE_CONNECTOR not set."           && exit 1)
	@test -n "$(DEST_CONNECTOR)"             || (echo "ERROR: DEST_CONNECTOR not set."             && exit 1)
	@test -n "$(SOURCE_TOKEN)"               || (echo "ERROR: SOURCE_TOKEN not set."               && exit 1)
	@test -n "$(DEST_WRAPPED_TOKEN_FACTORY)" || (echo "ERROR: DEST_WRAPPED_TOKEN_FACTORY not set." && exit 1)
endef

## Propose a wrapped-token route on the dest chain WrappedTokenFactory. (48-hour timelock starts now.)
.PHONY: propose-routes
propose-routes: require-private-key
	$(require-bootstrap-vars)
	@test -n "$(DEST_WRAPPED_TOKEN)" || \
		(echo "ERROR: DEST_WRAPPED_TOKEN not set." && exit 1)
	@echo ""
	@echo ">>> [DEST] Proposing wrapped-token route (timelock: 48 h)"
	@echo "    Factory: $(DEST_WRAPPED_TOKEN_FACTORY)"
	@SOURCE_CHAIN_ID="$(SOURCE_CHAIN_ID)" \
	SOURCE_CONNECTOR="$(SOURCE_CONNECTOR)" \
	SOURCE_TOKEN="$(SOURCE_TOKEN)" \
	DEST_CHAIN_ID="$(DEST_CHAIN_ID)" \
	DEST_CONNECTOR="$(DEST_CONNECTOR)" \
	DEST_WRAPPED_TOKEN_FACTORY="$(DEST_WRAPPED_TOKEN_FACTORY)" \
	DEST_WRAPPED_TOKEN="$(DEST_WRAPPED_TOKEN)" \
	$(call forge-script,script/bootstrap/ProposeRoutes.s.sol:ProposeRoutes,$(RPC_URL_DEST))

## Apply a previously proposed route (after 48-h timelock). On local Anvil use `make bootstrap`.
.PHONY: apply-routes
apply-routes: require-private-key
	$(require-bootstrap-vars)
	@echo ""
	@echo ">>> [DEST] Applying wrapped-token route"
	@echo "    Factory: $(DEST_WRAPPED_TOKEN_FACTORY)"
	@SOURCE_CHAIN_ID="$(SOURCE_CHAIN_ID)" \
	SOURCE_CONNECTOR="$(SOURCE_CONNECTOR)" \
	SOURCE_TOKEN="$(SOURCE_TOKEN)" \
	DEST_CHAIN_ID="$(DEST_CHAIN_ID)" \
	DEST_CONNECTOR="$(DEST_CONNECTOR)" \
	DEST_WRAPPED_TOKEN_FACTORY="$(DEST_WRAPPED_TOKEN_FACTORY)" \
	$(call forge-script,script/bootstrap/ApplyRoutes.s.sol:ApplyRoutes,$(RPC_URL_DEST))

## Full local bootstrap: propose → warp Anvil 48 h → apply. On prod, use propose-routes + apply-routes.
.PHONY: bootstrap
bootstrap: propose-routes ## Register wrapped-token route (local: auto time-warp; prod: propose only)
	@$(call warp-timelock)
	$(MAKE) apply-routes

# =============================================================================
# Seed test data  (Stage 3 — mint tokens to a test wallet)
# =============================================================================

## Mint SEED_AMOUNT source tokens to SEED_RECIPIENT (defaults to PRIVATE_KEY address).
.PHONY: seed-test-data
seed-test-data: require-private-key ## Mint source tokens to a test wallet for local testing
	@test -n "$(SOURCE_TOKEN)" || \
		(echo "ERROR: SOURCE_TOKEN not set." && exit 1)
	@test -n "$(SOURCE_CONNECTOR)" || \
		(echo "ERROR: SOURCE_CONNECTOR not set." && exit 1)
	@seed_to="$(SEED_RECIPIENT)"; \
	if [ -z "$$seed_to" ]; then \
		seed_to=$$($(CAST) wallet address --private-key $(PRIVATE_KEY)); \
	fi; \
	echo ""; \
	echo ">>> [SOURCE] Minting $(SEED_AMOUNT) tokens to $$seed_to"; \
	SOURCE_TOKEN="$(SOURCE_TOKEN)" \
	SOURCE_CONNECTOR="$(SOURCE_CONNECTOR)" \
	SEED_RECIPIENT="$$seed_to" \
	SEED_AMOUNT="$(SEED_AMOUNT)" \
	$(call forge-script,script/test-data/SeedTestData.s.sol:SeedTestData,$(RPC_URL_SOURCE))

## Approve SOURCE_CONNECTOR to spend SOURCE_TOKEN on behalf of the PRIVATE_KEY address.
.PHONY: approve-connector
approve-connector: require-private-key ## Approve SOURCE_CONNECTOR to spend SOURCE_TOKEN
	@test -n "$(SOURCE_TOKEN)" || \
		(echo "ERROR: SOURCE_TOKEN not set." && exit 1)
	@test -n "$(SOURCE_CONNECTOR)" || \
		(echo "ERROR: SOURCE_CONNECTOR not set." && exit 1)
	$(CAST) send "$(SOURCE_TOKEN)" \
		"approve(address,uint256)" "$(SOURCE_CONNECTOR)" "$(SEED_AMOUNT)" \
		--rpc-url "$(RPC_URL_SOURCE)" \
		--private-key "$(PRIVATE_KEY)"

# =============================================================================
# Composed targets  (deploy + bootstrap + optional seed)
# =============================================================================

## Full two-chain deploy + bootstrap (no seed data). Local only — warps Anvil clock.
.PHONY: setup
setup: deploy-all bootstrap ## deploy-all then bootstrap (local two-chain)
	@echo ""
	@echo "================================================================"
	@echo "  Setup complete. Run 'make seed-test-data' to mint test tokens."
	@echo "================================================================"

## Full two-chain deploy + bootstrap + mint test tokens to SEED_RECIPIENT.
.PHONY: setup-test-data
setup-test-data: setup seed-test-data ## deploy-all + bootstrap + seed test data
	@echo ""
	@echo "================================================================"
	@echo "  Full setup complete."
	@echo "  Run 'make approve-connector' to approve the connector."
	@echo "================================================================"

## Bootstrap + seed on already-deployed contracts (no re-deploy).
.PHONY: mock-data
mock-data: bootstrap seed-test-data ## Bootstrap + seed without re-deploying

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
	@echo ""
	@echo "Bootstrap (Stage 2) — fill in after deploy-all:"
	@echo "  SOURCE_CHAIN_ID            (default: 31337)"
	@echo "  DEST_CHAIN_ID              (default: 31338)"
	@echo "  SOURCE_CONNECTOR           Connector address on source chain"
	@echo "  DEST_CONNECTOR             Connector address on dest chain"
	@echo "  SOURCE_TOKEN               ERC-20 token address on source chain"
	@echo "  DEST_WRAPPED_TOKEN_FACTORY WrappedTokenFactory address on dest chain"
	@echo "  DEST_WRAPPED_TOKEN         Wrapped-token address on dest chain"
	@echo ""
	@echo "Seed (Stage 3):"
	@echo "  SEED_RECIPIENT   address to receive test tokens (defaults to PRIVATE_KEY address)"
	@echo "  SEED_AMOUNT      wei to mint (default: 1 000 × 10^18)"
	@echo ""
	@echo "Production deployment:"
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
