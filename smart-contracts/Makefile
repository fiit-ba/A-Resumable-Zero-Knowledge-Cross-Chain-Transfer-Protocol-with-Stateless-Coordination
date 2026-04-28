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
ORIGIN_MINT_IMAGE_ID        ?= 0xff75eff548880c268cc66ea63b7cd4872cab28c7852e682bc0d8bfc542980309
ORIGIN_BURN_IMAGE_ID        ?= 0xc1e95709b036343286d70ae5a6f72713900cf47ccb3b3d0ecc531ebca6d75264
DEST_LOCK_IMAGE_ID          ?= 0x119e554ae1d65c0190fdf548f3ee5e068089cb5f8f817cada47334993d4199c7
DEST_ACK_IMAGE_ID           ?= 0x284e25a5d75c3ea0e80d02b3d5bab756ab0356726106a0c1e432c2bc9f1fd8e2
DEST_REFUND_CLAIM_IMAGE_ID  ?= 0x98359dabb236c6ad721ebb6efeb518f188a74a91d7728800d29d8df89b66fda7
ORIGIN_NON_ACCEPT_IMAGE_ID 		?= 0x7b607ff01e6bcee8e429186596090ab4aa83954b883f9e14e8efdfbf6fea3742

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

# Non-accept event image ID (optional; zero disables the route on each chain).
ORIGIN_NON_ACCEPT_IMAGE_ID        ?= $(BYTES32_ZERO)
ORIGIN_NON_ACCEPT_IMAGE_ID_SOURCE ?= $(ORIGIN_NON_ACCEPT_IMAGE_ID)
ORIGIN_NON_ACCEPT_IMAGE_ID_DEST   ?= $(ORIGIN_NON_ACCEPT_IMAGE_ID)

# Optional: reuse an existing Groth16Verifier instead of deploying a fresh one.
RISC0_VERIFIER ?=

# Name / symbol for the BridgeWrappedToken deployed by deploy-prod-full on the dest chain.
WRAPPED_TOKEN_NAME   ?= Wrapped $(TOKEN_NAME_SRC)
WRAPPED_TOKEN_SYMBOL ?= w$(TOKEN_SYMBOL_SRC)

# When 1, deploy-prod-full auto-detects the ack window from on-chain block times
# instead of using ACK_WINDOW_SECONDS_SOURCE / _DEST. Default 0 keeps the configured
# one-hour ACK window unless explicitly overridden.
AUTO_DETECT_FINALITY ?= 0

# Route-registration timelock (seconds) for a freshly deployed WrappedTokenFactory.
# Default 0 = instant registration, safe for initial deployment when no users exist yet.
# Set to 172800 (48 h) once the bridge is live and you need to protect existing users.
REGISTRATION_TIMELOCK ?= 0

# ─── Bootstrap configuration ──────────────────────────────────────────────────
# Chain IDs used by the bootstrap scripts to compute the route key.
SOURCE_CHAIN_ID ?= 31337
DEST_CHAIN_ID   ?= 31338

# Addresses populated after deploy-all (copy from `make addresses` output).
SOURCE_CONNECTOR           ?=
DEST_CONNECTOR             ?=
SOURCE_TOKEN               ?=
SOURCE_WRAPPED_TOKEN_FACTORY ?= $(WRAPPED_TOKEN_FACTORY_SOURCE)
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

# Extra flags appended to every `forge script` invocation.
FORGE_SCRIPT_EXTRA_FLAGS ?=

# Extra flags appended to production `forge script` invocations.
# Chiado public RPC can report a latest block before serving it; skipping
# Foundry's pre-broadcast fork simulation avoids that flaky RPC path.
PROD_FORGE_SCRIPT_EXTRA_FLAGS ?= --skip-simulation

# Extra flags for route registration scripts. Defaults to the production flags
# because public destination RPCs often lag at the latest block during simulation.
ROUTE_FORGE_SCRIPT_EXTRA_FLAGS ?= $(PROD_FORGE_SCRIPT_EXTRA_FLAGS)

# Convenience alias: forge script with broadcast + given private key
define forge-script
	$(FORGE) script $(1) \
		--rpc-url $(2) \
		--private-key $(PRIVATE_KEY) \
		--broadcast \
		--slow \
		$(FORGE_SCRIPT_EXTRA_FLAGS) \
		$(3) \
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

define require-source-route-vars
	@test -n "$(SOURCE_CONNECTOR)"               || (echo "ERROR: SOURCE_CONNECTOR not set."               && exit 1)
	@test -n "$(DEST_CONNECTOR)"                 || (echo "ERROR: DEST_CONNECTOR not set."                 && exit 1)
	@test -n "$(SOURCE_TOKEN)"                   || (echo "ERROR: SOURCE_TOKEN not set."                   && exit 1)
	@test -n "$(SOURCE_WRAPPED_TOKEN_FACTORY)"   || (echo "ERROR: SOURCE_WRAPPED_TOKEN_FACTORY not set."   && exit 1)
	@test -n "$(DEST_WRAPPED_TOKEN)"             || (echo "ERROR: DEST_WRAPPED_TOKEN not set."             && exit 1)
endef

## Propose the same wrapped-token route in the source-chain factory used by depositAndLock.
.PHONY: propose-source-route
propose-source-route: require-private-key
	$(require-source-route-vars)
	@echo ""
	@echo ">>> [SOURCE] Proposing wrapped-token route used by depositAndLock"
	@echo "    Factory: $(SOURCE_WRAPPED_TOKEN_FACTORY)"
	@SOURCE_CHAIN_ID="$(SOURCE_CHAIN_ID)" \
	SOURCE_CONNECTOR="$(SOURCE_CONNECTOR)" \
	SOURCE_TOKEN="$(SOURCE_TOKEN)" \
	DEST_CHAIN_ID="$(DEST_CHAIN_ID)" \
	DEST_CONNECTOR="$(DEST_CONNECTOR)" \
	DEST_WRAPPED_TOKEN_FACTORY="$(SOURCE_WRAPPED_TOKEN_FACTORY)" \
	DEST_WRAPPED_TOKEN="$(DEST_WRAPPED_TOKEN)" \
	$(call forge-script,script/bootstrap/ProposeRoutes.s.sol:ProposeRoutes,$(RPC_URL_SOURCE),$(ROUTE_FORGE_SCRIPT_EXTRA_FLAGS))

## Apply the source-chain wrapped-token route after the source factory timelock.
.PHONY: apply-source-route
apply-source-route: require-private-key
	$(require-source-route-vars)
	@echo ""
	@echo ">>> [SOURCE] Applying wrapped-token route used by depositAndLock"
	@echo "    Factory: $(SOURCE_WRAPPED_TOKEN_FACTORY)"
	@SOURCE_CHAIN_ID="$(SOURCE_CHAIN_ID)" \
	SOURCE_CONNECTOR="$(SOURCE_CONNECTOR)" \
	SOURCE_TOKEN="$(SOURCE_TOKEN)" \
	DEST_CHAIN_ID="$(DEST_CHAIN_ID)" \
	DEST_CONNECTOR="$(DEST_CONNECTOR)" \
	DEST_WRAPPED_TOKEN_FACTORY="$(SOURCE_WRAPPED_TOKEN_FACTORY)" \
	$(call forge-script,script/bootstrap/ApplyRoutes.s.sol:ApplyRoutes,$(RPC_URL_SOURCE),$(ROUTE_FORGE_SCRIPT_EXTRA_FLAGS))

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
	$(call forge-script,script/bootstrap/ProposeRoutes.s.sol:ProposeRoutes,$(RPC_URL_DEST),$(ROUTE_FORGE_SCRIPT_EXTRA_FLAGS))

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
	$(call forge-script,script/bootstrap/ApplyRoutes.s.sol:ApplyRoutes,$(RPC_URL_DEST),$(ROUTE_FORGE_SCRIPT_EXTRA_FLAGS))

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
	REGISTRATION_TIMELOCK="$(REGISTRATION_TIMELOCK)" \
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
	REGISTRATION_TIMELOCK="$(REGISTRATION_TIMELOCK)" \
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
# Production — individual per-chain RiscZeroAdapter targets
# =============================================================================

## Deploy RiscZeroAdapter with source-role image IDs on the SOURCE chain.
## Useful when you only need to (re-)deploy the adapter independently.
.PHONY: deploy-risc0-adapter-source-prod
deploy-risc0-adapter-source-prod: require-private-key ## Deploy RiscZeroAdapter on source chain with source image IDs
	@echo ""
	@echo ">>> [$(SOURCE_NETWORK)] Deploying RiscZeroAdapter"
	@echo "    RPC: $(RPC_URL_SOURCE)"
	@RISC0_VERIFIER="$(RISC0_VERIFIER)" \
	ORIGIN_MINT_IMAGE_ID="$(ORIGIN_MINT_IMAGE_ID_SOURCE)" \
	ORIGIN_BURN_IMAGE_ID="$(ORIGIN_BURN_IMAGE_ID_SOURCE)" \
	DEST_LOCK_IMAGE_ID="$(DEST_LOCK_IMAGE_ID_SOURCE)" \
	DEST_ACK_IMAGE_ID="$(DEST_ACK_IMAGE_ID_SOURCE)" \
	DEST_REFUND_CLAIM_IMAGE_ID="$(DEST_REFUND_CLAIM_IMAGE_ID_SOURCE)" \
	ORIGIN_NON_ACCEPT_IMAGE_ID="$(ORIGIN_NON_ACCEPT_IMAGE_ID_SOURCE)" \
	$(call forge-script,script/DeployRiscZeroAdapter.s.sol:DeployRiscZeroAdapter,$(RPC_URL_SOURCE))

## Deploy RiscZeroAdapter with dest-role image IDs on the DEST chain.
.PHONY: deploy-risc0-adapter-dest-prod
deploy-risc0-adapter-dest-prod: require-private-key ## Deploy RiscZeroAdapter on dest chain with dest image IDs
	@echo ""
	@echo ">>> [$(DEST_NETWORK)] Deploying RiscZeroAdapter"
	@echo "    RPC: $(RPC_URL_DEST)"
	@RISC0_VERIFIER="$(RISC0_VERIFIER)" \
	ORIGIN_MINT_IMAGE_ID="$(ORIGIN_MINT_IMAGE_ID_DEST)" \
	ORIGIN_BURN_IMAGE_ID="$(ORIGIN_BURN_IMAGE_ID_DEST)" \
	DEST_LOCK_IMAGE_ID="$(DEST_LOCK_IMAGE_ID_DEST)" \
	DEST_ACK_IMAGE_ID="$(DEST_ACK_IMAGE_ID_DEST)" \
	DEST_REFUND_CLAIM_IMAGE_ID="$(DEST_REFUND_CLAIM_IMAGE_ID_DEST)" \
	ORIGIN_NON_ACCEPT_IMAGE_ID="$(ORIGIN_NON_ACCEPT_IMAGE_ID_DEST)" \
	$(call forge-script,script/DeployRiscZeroAdapter.s.sol:DeployRiscZeroAdapter,$(RPC_URL_DEST))

# =============================================================================
# Full production deployment  (deploy-prod-full)
# =============================================================================
# Deploys the complete on-chain stack for two production chains in one command:
#
#   1. RiscZeroAdapter (source) — Groth16Verifier auto-deployed unless RISC0_VERIFIER is set
#   2. RiscZeroAdapter (dest)   — same
#   3. Source ERC-20 token      — skipped when SOURCE_TOKEN is already set in .env
#   4. Source Connector         — WrappedTokenFactory auto-deployed unless WRAPPED_TOKEN_FACTORY_SOURCE is set
#   5. Destination Connector    — WrappedTokenFactory auto-deployed unless WRAPPED_TOKEN_FACTORY_DEST is set
#   6. BridgeWrappedToken (dest)— bound exclusively to the dest Connector
#   7. Route registration       — proposeRoute; on local Anvil auto-warps and applies immediately
#
# Required in smart-contracts/.env (or as make VAR=value overrides):
#   PRIVATE_KEY
#   SNARK_ADAPTER_SOURCE   pre-deployed SnarkAdapter address on the source chain
#   SNARK_ADAPTER_DEST     pre-deployed SnarkAdapter address on the dest chain
#   SOURCE_CHAIN_ID / DEST_CHAIN_ID
#   RPC_URL_SOURCE / RPC_URL_DEST
#
# Optional:
#   SOURCE_TOKEN                    skip source token deploy; bridge an existing ERC-20
#   RISC0_VERIFIER                  reuse an existing Groth16Verifier (skip its deploy)
#   WRAPPED_TOKEN_FACTORY_SOURCE    reuse existing factory on source chain
#   WRAPPED_TOKEN_FACTORY_DEST      reuse existing factory on dest chain
#   WRAPPED_TOKEN_NAME / _SYMBOL    name/symbol for the BridgeWrappedToken (default: Wrapped SRC / wSYM)
#   ACK_WINDOW_SECONDS_SOURCE / _DEST
#   All *_IMAGE_ID_SOURCE / *_IMAGE_ID_DEST variables

.PHONY: deploy-prod-full
deploy-prod-full: require-private-key ## Full prod: adapters → tokens → connectors → wrapped-token → bootstrap (two chains)
	@set -e; \
	echo ""; \
	echo "================================================================"; \
	echo "  PRODUCTION FULL DEPLOYMENT"; \
	echo "  Source : $(SOURCE_NETWORK) — $(RPC_URL_SOURCE)"; \
	echo "  Dest   : $(DEST_NETWORK) — $(RPC_URL_DEST)"; \
	echo "================================================================"; \
	\
	src_chain_id=$$($(CAST) chain-id --rpc-url "$(RPC_URL_SOURCE)"); \
	dst_chain_id=$$($(CAST) chain-id --rpc-url "$(RPC_URL_DEST)"); \
	\
	addr_from_log() { \
		_log="$$1"; _contract="$$2"; \
		if command -v jq >/dev/null 2>&1; then \
			jq -r --arg c "$$_contract" \
				'[.transactions[] | select(.transactionType=="CREATE" and .contractName==$$c)] | last | .contractAddress' \
				"$$_log"; \
		elif command -v python3 >/dev/null 2>&1; then \
			python3 -c "import json,sys; d=json.load(open(sys.argv[1])); txs=[t for t in d.get('transactions',[]) if t.get('transactionType')=='CREATE' and t.get('contractName')==sys.argv[2]]; print(txs[-1]['contractAddress'] if txs else '')" \
				"$$_log" "$$_contract"; \
		fi; \
	}; \
	\
	finality_seconds_for() { \
		_rpc="$$1"; _cid="$$2"; \
		case "$$_cid" in \
			1)        echo 14400 ;; \
			11155111) echo 14400 ;; \
			100)      echo 14400 ;; \
			10200)    echo 14400 ;; \
			137)      echo 14400 ;; \
			80001)    echo 14400 ;; \
			42161)    echo 14400 ;; \
			10)       echo 14400 ;; \
			8453)     echo 14400 ;; \
			*) \
				_latest=$$($(CAST) block-number --rpc-url "$$_rpc" 2>/dev/null || echo 0); \
				if [ "$$_latest" -gt 20 ] 2>/dev/null; then \
					_old=$$(( $$_latest - 20 )); \
					_t_new=$$($(CAST) block latest  --field timestamp --rpc-url "$$_rpc" 2>/dev/null || echo 0); \
					_t_old=$$($(CAST) block "$$_old" --field timestamp --rpc-url "$$_rpc" 2>/dev/null || echo 0); \
					_avg=$$(( ($$_t_new - $$_t_old) / 20 )); \
					_window=$$(( $$_avg * 64 )); \
					if [ "$$_window" -lt 60 ]   2>/dev/null; then _window=60;   fi; \
					if [ "$$_window" -gt 7200 ] 2>/dev/null; then _window=7200; fi; \
					echo "$$_window"; \
				else \
					echo 3600; \
				fi ;; \
		esac; \
	}; \
	retry_script() { \
		_attempt=0; \
		while [ "$$_attempt" -lt 3 ]; do \
			_attempt=$$(( $$_attempt + 1 )); \
			"$$@" && return 0; \
			[ "$$_attempt" -lt 3 ] && { echo "  [attempt $$_attempt/3 failed — retrying in 15s...]"; sleep 15; }; \
		done; \
		return 1; \
	}; \
	\
	echo ""; \
	if [ -z "$(RISC0_ADAPTER_SOURCE)" ]; then \
		echo ">>> [$(SOURCE_NETWORK)] Step 1/9: Deploying RiscZeroAdapter"; \
		retry_script env \
			RISC0_VERIFIER="$(RISC0_VERIFIER)" \
			ORIGIN_MINT_IMAGE_ID="$(ORIGIN_MINT_IMAGE_ID_SOURCE)" \
			ORIGIN_BURN_IMAGE_ID="$(ORIGIN_BURN_IMAGE_ID_SOURCE)" \
			DEST_LOCK_IMAGE_ID="$(DEST_LOCK_IMAGE_ID_SOURCE)" \
			DEST_ACK_IMAGE_ID="$(DEST_ACK_IMAGE_ID_SOURCE)" \
			DEST_REFUND_CLAIM_IMAGE_ID="$(DEST_REFUND_CLAIM_IMAGE_ID_SOURCE)" \
			ORIGIN_NON_ACCEPT_IMAGE_ID="$(ORIGIN_NON_ACCEPT_IMAGE_ID_SOURCE)" \
			$(FORGE) script script/DeployRiscZeroAdapter.s.sol:DeployRiscZeroAdapter \
				--rpc-url "$(RPC_URL_SOURCE)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
		risc0_src=$$(addr_from_log \
			"broadcast/DeployRiscZeroAdapter.s.sol/$$src_chain_id/run-latest.json" "RiscZeroAdapter"); \
		{ test -n "$$risc0_src" && test "$$risc0_src" != "null"; } || \
			{ echo "ERROR: Could not extract RISC0_ADAPTER_SOURCE from broadcast log." && exit 1; }; \
		echo "  -> RISC0_ADAPTER_SOURCE=$$risc0_src"; \
	else \
		risc0_src="$(RISC0_ADAPTER_SOURCE)"; \
		echo ">>> [$(SOURCE_NETWORK)] Step 1/9: Using existing RISC0_ADAPTER_SOURCE=$$risc0_src"; \
	fi; \
	\
	echo ""; \
	if [ -z "$(RISC0_ADAPTER_DEST)" ]; then \
		echo ">>> [$(DEST_NETWORK)] Step 2/9: Deploying RiscZeroAdapter"; \
		retry_script env \
			RISC0_VERIFIER="$(RISC0_VERIFIER)" \
			ORIGIN_MINT_IMAGE_ID="$(ORIGIN_MINT_IMAGE_ID_DEST)" \
			ORIGIN_BURN_IMAGE_ID="$(ORIGIN_BURN_IMAGE_ID_DEST)" \
			DEST_LOCK_IMAGE_ID="$(DEST_LOCK_IMAGE_ID_DEST)" \
			DEST_ACK_IMAGE_ID="$(DEST_ACK_IMAGE_ID_DEST)" \
			DEST_REFUND_CLAIM_IMAGE_ID="$(DEST_REFUND_CLAIM_IMAGE_ID_DEST)" \
			ORIGIN_NON_ACCEPT_IMAGE_ID="$(ORIGIN_NON_ACCEPT_IMAGE_ID_DEST)" \
			$(FORGE) script script/DeployRiscZeroAdapter.s.sol:DeployRiscZeroAdapter \
				--rpc-url "$(RPC_URL_DEST)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
		risc0_dst=$$(addr_from_log \
			"broadcast/DeployRiscZeroAdapter.s.sol/$$dst_chain_id/run-latest.json" "RiscZeroAdapter"); \
		{ test -n "$$risc0_dst" && test "$$risc0_dst" != "null"; } || \
			{ echo "ERROR: Could not extract RISC0_ADAPTER_DEST from broadcast log." && exit 1; }; \
		echo "  -> RISC0_ADAPTER_DEST=$$risc0_dst"; \
	else \
		risc0_dst="$(RISC0_ADAPTER_DEST)"; \
		echo ">>> [$(DEST_NETWORK)] Step 2/9: Using existing RISC0_ADAPTER_DEST=$$risc0_dst"; \
	fi; \
	\
	echo ""; \
	if [ -z "$(SNARK_ADAPTER_SOURCE)" ]; then \
		echo ">>> [$(SOURCE_NETWORK)] Step 3/9: Auto-deploying SnarkAdapter (SNARK_ADAPTER_SOURCE not set)"; \
		retry_script $(FORGE) script script/DeploySnarkAdapter.s.sol:DeploySnarkAdapter \
			--rpc-url "$(RPC_URL_SOURCE)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
		snark_src=$$(addr_from_log \
			"broadcast/DeploySnarkAdapter.s.sol/$$src_chain_id/run-latest.json" "SnarkAdapter"); \
		{ test -n "$$snark_src" && test "$$snark_src" != "null"; } || \
			{ echo "ERROR: Could not extract SNARK_ADAPTER_SOURCE from broadcast log." && exit 1; }; \
		echo "  -> SNARK_ADAPTER_SOURCE=$$snark_src"; \
	else \
		snark_src="$(SNARK_ADAPTER_SOURCE)"; \
		echo ">>> [$(SOURCE_NETWORK)] Step 3/9: Using existing SNARK_ADAPTER_SOURCE=$$snark_src"; \
	fi; \
	\
	echo ""; \
	if [ -z "$(SNARK_ADAPTER_DEST)" ]; then \
		echo ">>> [$(DEST_NETWORK)] Step 4/9: Auto-deploying SnarkAdapter (SNARK_ADAPTER_DEST not set)"; \
		retry_script $(FORGE) script script/DeploySnarkAdapter.s.sol:DeploySnarkAdapter \
			--rpc-url "$(RPC_URL_DEST)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
		snark_dst=$$(addr_from_log \
			"broadcast/DeploySnarkAdapter.s.sol/$$dst_chain_id/run-latest.json" "SnarkAdapter"); \
		{ test -n "$$snark_dst" && test "$$snark_dst" != "null"; } || \
			{ echo "ERROR: Could not extract SNARK_ADAPTER_DEST from broadcast log." && exit 1; }; \
		echo "  -> SNARK_ADAPTER_DEST=$$snark_dst"; \
	else \
		snark_dst="$(SNARK_ADAPTER_DEST)"; \
		echo ">>> [$(DEST_NETWORK)] Step 4/9: Using existing SNARK_ADAPTER_DEST=$$snark_dst"; \
	fi; \
	\
	echo ""; \
	src_token="$(SOURCE_TOKEN)"; \
	if [ -z "$$src_token" ]; then \
		echo ">>> [$(SOURCE_NETWORK)] Step 5/9: Deploying source token ($(TOKEN_NAME_SRC) / $(TOKEN_SYMBOL_SRC))"; \
		tok_out=$$($(FORGE) create script/MockERC20.s.sol:MockERC20 \
			--rpc-url "$(RPC_URL_SOURCE)" --private-key "$(PRIVATE_KEY)" --broadcast \
			--constructor-args "$(TOKEN_NAME_SRC)" "$(TOKEN_SYMBOL_SRC)" 2>&1); \
		echo "$$tok_out"; \
		src_token=$$(echo "$$tok_out" | grep -E "^Deployed to:" | awk '{print $$NF}'); \
		test -n "$$src_token" || \
			{ echo "ERROR: Could not extract source token address from forge output." && exit 1; }; \
	else \
		echo ">>> Step 5/9: Using existing source token: $$src_token"; \
	fi; \
	echo "  -> SOURCE_TOKEN=$$src_token"; \
	\
	echo ""; \
	if [ "$(AUTO_DETECT_FINALITY)" = "1" ]; then \
		echo ">>> Auto-detecting block finality window from on-chain data..."; \
		ack_window_src=$$(finality_seconds_for "$(RPC_URL_SOURCE)" "$$src_chain_id"); \
		ack_window_dst=$$(finality_seconds_for "$(RPC_URL_DEST)"   "$$dst_chain_id"); \
		echo "  -> ACK_WINDOW_SECONDS_SOURCE=$$ack_window_src (chain $$src_chain_id)"; \
		echo "  -> ACK_WINDOW_SECONDS_DEST=$$ack_window_dst   (chain $$dst_chain_id)"; \
	else \
		ack_window_src="$(ACK_WINDOW_SECONDS_SOURCE)"; \
		ack_window_dst="$(ACK_WINDOW_SECONDS_DEST)"; \
		echo ">>> Using configured ACK_WINDOW_SECONDS_SOURCE=$$ack_window_src, DEST=$$ack_window_dst"; \
	fi; \
	\
	echo ""; \
	if [ -z "$(SOURCE_CONNECTOR)" ]; then \
		echo ">>> [$(SOURCE_NETWORK)] Step 6/9: Deploying source Connector"; \
		retry_script env \
			RISC0_ADAPTER="$$risc0_src" \
			SNARK_ADAPTER="$$snark_src" \
			ACK_WINDOW_SECONDS="$$ack_window_src" \
			WRAPPED_TOKEN_FACTORY="$(WRAPPED_TOKEN_FACTORY_SOURCE)" \
			REGISTRATION_TIMELOCK="$(REGISTRATION_TIMELOCK)" \
			ORIGIN_MINT_IMAGE_ID="$(ORIGIN_MINT_IMAGE_ID_SOURCE)" \
			ORIGIN_BURN_IMAGE_ID="$(ORIGIN_BURN_IMAGE_ID_SOURCE)" \
			DEST_LOCK_IMAGE_ID="$(DEST_LOCK_IMAGE_ID_SOURCE)" \
			DEST_ACK_IMAGE_ID="$(DEST_ACK_IMAGE_ID_SOURCE)" \
			DEST_REFUND_CLAIM_IMAGE_ID="$(DEST_REFUND_CLAIM_IMAGE_ID_SOURCE)" \
			ORIGIN_NON_ACCEPT_IMAGE_ID="$(ORIGIN_NON_ACCEPT_IMAGE_ID_SOURCE)" \
			$(FORGE) script script/DeployConnectorWithAdapters.s.sol:DeployConnectorWithAdapters \
				--rpc-url "$(RPC_URL_SOURCE)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
		src_connector=$$(addr_from_log \
			"broadcast/DeployConnectorWithAdapters.s.sol/$$src_chain_id/run-latest.json" "Connector"); \
		{ test -n "$$src_connector" && test "$$src_connector" != "null"; } || \
			{ echo "ERROR: Could not extract SOURCE_CONNECTOR from broadcast log." && exit 1; }; \
		src_factory="$(WRAPPED_TOKEN_FACTORY_SOURCE)"; \
		if [ -z "$$src_factory" ]; then \
			src_factory=$$(addr_from_log \
				"broadcast/DeployConnectorWithAdapters.s.sol/$$src_chain_id/run-latest.json" "WrappedTokenFactory"); \
		fi; \
		{ test -n "$$src_factory" && test "$$src_factory" != "null"; } || \
			{ echo "ERROR: Could not extract SOURCE_WRAPPED_TOKEN_FACTORY from broadcast log." && exit 1; }; \
		echo "  -> SOURCE_CONNECTOR=$$src_connector"; \
		echo "  -> SOURCE_WRAPPED_TOKEN_FACTORY=$$src_factory"; \
	else \
		src_connector="$(SOURCE_CONNECTOR)"; \
		src_factory="$(WRAPPED_TOKEN_FACTORY_SOURCE)"; \
		if [ -z "$$src_factory" ]; then src_factory="$(SOURCE_WRAPPED_TOKEN_FACTORY)"; fi; \
		if [ -z "$$src_factory" ]; then \
			src_factory=$$($(CAST) call "$$src_connector" "wrappedTokenFactory()(address)" --rpc-url "$(RPC_URL_SOURCE)" 2>/dev/null || true); \
		fi; \
		if [ -z "$$src_factory" ]; then \
			src_factory=$$(addr_from_log \
				"broadcast/DeployConnectorWithAdapters.s.sol/$$src_chain_id/run-latest.json" "WrappedTokenFactory"); \
		fi; \
		{ test -n "$$src_factory" && test "$$src_factory" != "null"; } || \
			{ echo "ERROR: SOURCE_CONNECTOR is set but SOURCE_WRAPPED_TOKEN_FACTORY / WRAPPED_TOKEN_FACTORY_SOURCE is unset and wrappedTokenFactory() could not be read." && exit 1; }; \
		echo ">>> [$(SOURCE_NETWORK)] Step 6/9: Using existing SOURCE_CONNECTOR=$$src_connector"; \
		echo "  -> SOURCE_WRAPPED_TOKEN_FACTORY=$$src_factory"; \
	fi; \
	\
	echo ""; \
	if [ -z "$(DEST_CONNECTOR)" ]; then \
		echo ">>> [$(DEST_NETWORK)] Step 7/9: Deploying dest Connector"; \
		retry_script env \
			RISC0_ADAPTER="$$risc0_dst" \
			SNARK_ADAPTER="$$snark_dst" \
			ACK_WINDOW_SECONDS="$$ack_window_dst" \
			WRAPPED_TOKEN_FACTORY="$(if $(WRAPPED_TOKEN_FACTORY_DEST),$(WRAPPED_TOKEN_FACTORY_DEST),$(DEST_WRAPPED_TOKEN_FACTORY))" \
			REGISTRATION_TIMELOCK="$(REGISTRATION_TIMELOCK)" \
			ORIGIN_MINT_IMAGE_ID="$(ORIGIN_MINT_IMAGE_ID_DEST)" \
			ORIGIN_BURN_IMAGE_ID="$(ORIGIN_BURN_IMAGE_ID_DEST)" \
			DEST_LOCK_IMAGE_ID="$(DEST_LOCK_IMAGE_ID_DEST)" \
			DEST_ACK_IMAGE_ID="$(DEST_ACK_IMAGE_ID_DEST)" \
			DEST_REFUND_CLAIM_IMAGE_ID="$(DEST_REFUND_CLAIM_IMAGE_ID_DEST)" \
			ORIGIN_NON_ACCEPT_IMAGE_ID="$(ORIGIN_NON_ACCEPT_IMAGE_ID_DEST)" \
			$(FORGE) script script/DeployConnectorWithAdapters.s.sol:DeployConnectorWithAdapters \
				--rpc-url "$(RPC_URL_DEST)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
		dst_connector=$$(addr_from_log \
			"broadcast/DeployConnectorWithAdapters.s.sol/$$dst_chain_id/run-latest.json" "Connector"); \
		{ test -n "$$dst_connector" && test "$$dst_connector" != "null"; } || \
			{ echo "ERROR: Could not extract DEST_CONNECTOR from broadcast log." && exit 1; }; \
		dst_factory="$(WRAPPED_TOKEN_FACTORY_DEST)"; \
		if [ -z "$$dst_factory" ]; then dst_factory="$(DEST_WRAPPED_TOKEN_FACTORY)"; fi; \
		if [ -z "$$dst_factory" ]; then \
			dst_factory=$$(addr_from_log \
				"broadcast/DeployConnectorWithAdapters.s.sol/$$dst_chain_id/run-latest.json" "WrappedTokenFactory"); \
		fi; \
		{ test -n "$$dst_factory" && test "$$dst_factory" != "null"; } || \
			{ echo "ERROR: Could not extract DEST_WRAPPED_TOKEN_FACTORY from broadcast log." && exit 1; }; \
		echo "  -> DEST_CONNECTOR=$$dst_connector"; \
		echo "  -> DEST_WRAPPED_TOKEN_FACTORY=$$dst_factory"; \
	else \
		dst_connector="$(DEST_CONNECTOR)"; \
		dst_factory="$(WRAPPED_TOKEN_FACTORY_DEST)"; \
		if [ -z "$$dst_factory" ]; then dst_factory="$(DEST_WRAPPED_TOKEN_FACTORY)"; fi; \
		{ test -n "$$dst_factory"; } || \
			{ echo "ERROR: DEST_CONNECTOR is set but neither WRAPPED_TOKEN_FACTORY_DEST nor DEST_WRAPPED_TOKEN_FACTORY is set — add one to .env." && exit 1; }; \
		echo ">>> [$(DEST_NETWORK)] Step 7/9: Using existing DEST_CONNECTOR=$$dst_connector"; \
		echo "  -> DEST_WRAPPED_TOKEN_FACTORY=$$dst_factory"; \
	fi; \
	\
	echo ""; \
	dst_wrapped_token="$(DEST_WRAPPED_TOKEN)"; \
	if [ -z "$$dst_wrapped_token" ]; then \
		echo ">>> [$(DEST_NETWORK)] Step 8/9: Deploying BridgeWrappedToken ($(WRAPPED_TOKEN_NAME) / $(WRAPPED_TOKEN_SYMBOL))"; \
		_n=3; while [ "$$_n" -gt 0 ]; do \
			if tok_out=$$($(FORGE) create src/tokens/BridgeWrappedToken.sol:BridgeWrappedToken \
				--rpc-url "$(RPC_URL_DEST)" --private-key "$(PRIVATE_KEY)" --broadcast \
				--constructor-args "$(WRAPPED_TOKEN_NAME)" "$(WRAPPED_TOKEN_SYMBOL)" "$$dst_connector" 2>&1); then \
				echo "$$tok_out"; \
				dst_wrapped_token=$$(echo "$$tok_out" | grep -E "^Deployed to:" | awk '{print $$NF}'); \
				test -n "$$dst_wrapped_token" && break; \
				echo "  [forge create completed but DEST_WRAPPED_TOKEN address could not be parsed]"; \
			else \
				_status=$$?; \
				echo "$$tok_out"; \
				echo "  [forge create failed with exit code $$_status]"; \
			fi; \
			_n=$$(( $$_n - 1 )); \
			[ "$$_n" -gt 0 ] && { echo "  [deploy failed, retrying in 15s...]"; sleep 15; }; \
		done; \
		test -n "$$dst_wrapped_token" || \
			{ echo "ERROR: Could not extract DEST_WRAPPED_TOKEN address after 3 attempts." && exit 1; }; \
	else \
		echo ">>> [$(DEST_NETWORK)] Step 8/9: Using existing DEST_WRAPPED_TOKEN=$$dst_wrapped_token"; \
		wrapped_connector=$$($(CAST) call "$$dst_wrapped_token" "CONNECTOR()(address)" --rpc-url "$(RPC_URL_DEST)" 2>/dev/null || true); \
		{ test -n "$$wrapped_connector" && test "$$wrapped_connector" != "null"; } || \
			{ echo "ERROR: Could not read CONNECTOR() from DEST_WRAPPED_TOKEN=$$dst_wrapped_token." && exit 1; }; \
		if [ "$$(printf '%s' "$$wrapped_connector" | tr '[:upper:]' '[:lower:]')" != "$$(printf '%s' "$$dst_connector" | tr '[:upper:]' '[:lower:]')" ]; then \
			echo "ERROR: DEST_WRAPPED_TOKEN is bound to CONNECTOR=$$wrapped_connector, but DEST_CONNECTOR=$$dst_connector."; \
			echo "       Deploy a fresh BridgeWrappedToken for this destination connector and register it in a fresh route/factory."; \
			exit 1; \
		fi; \
	fi; \
	echo "  -> DEST_WRAPPED_TOKEN=$$dst_wrapped_token"; \
	\
	echo ""; \
	echo ">>> Step 9/9: Registering wrapped-token route"; \
	retry_script env \
		SOURCE_CHAIN_ID="$$src_chain_id" \
		SOURCE_CONNECTOR="$$src_connector" \
		SOURCE_TOKEN="$$src_token" \
		DEST_CHAIN_ID="$$dst_chain_id" \
		DEST_CONNECTOR="$$dst_connector" \
		DEST_WRAPPED_TOKEN_FACTORY="$$dst_factory" \
		DEST_WRAPPED_TOKEN="$$dst_wrapped_token" \
		$(FORGE) script script/bootstrap/ProposeRoutes.s.sol:ProposeRoutes \
			--rpc-url "$(RPC_URL_DEST)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
	_timelock="$(REGISTRATION_TIMELOCK)"; \
	if [ "$${_timelock:-0}" = "0" ]; then \
		echo ">>> Timelock is zero — applying route immediately..."; \
		retry_script env \
			SOURCE_CHAIN_ID="$$src_chain_id" \
			SOURCE_CONNECTOR="$$src_connector" \
			SOURCE_TOKEN="$$src_token" \
			DEST_CHAIN_ID="$$dst_chain_id" \
			DEST_CONNECTOR="$$dst_connector" \
			DEST_WRAPPED_TOKEN_FACTORY="$$dst_factory" \
			$(FORGE) script script/bootstrap/ApplyRoutes.s.sol:ApplyRoutes \
				--rpc-url "$(RPC_URL_DEST)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
		echo ">>> Route is live."; \
	elif echo "$(RPC_URL_DEST)" | grep -qE "127\.0\.0\.1|localhost"; then \
		echo ">>> [LOCAL] Warping Anvil time $${_timelock}s and applying route..."; \
		$(CAST) rpc --rpc-url "$(RPC_URL_DEST)" evm_increaseTime "$${_timelock}"; \
		$(CAST) rpc --rpc-url "$(RPC_URL_DEST)" evm_mine; \
		retry_script env \
			SOURCE_CHAIN_ID="$$src_chain_id" \
			SOURCE_CONNECTOR="$$src_connector" \
			SOURCE_TOKEN="$$src_token" \
			DEST_CHAIN_ID="$$dst_chain_id" \
			DEST_CONNECTOR="$$dst_connector" \
			DEST_WRAPPED_TOKEN_FACTORY="$$dst_factory" \
			$(FORGE) script script/bootstrap/ApplyRoutes.s.sol:ApplyRoutes \
				--rpc-url "$(RPC_URL_DEST)" --private-key "$(PRIVATE_KEY)" --broadcast --slow $(PROD_FORGE_SCRIPT_EXTRA_FLAGS) -vvv; \
		echo ">>> Route is live."; \
	else \
		echo ""; \
		echo "  NOTE: $${_timelock}s timelock started on $(DEST_NETWORK)."; \
		echo "  After the timelock elapses, finalize with:"; \
		echo "    SOURCE_CHAIN_ID=$$src_chain_id SOURCE_CONNECTOR=$$src_connector \\"; \
		echo "    SOURCE_TOKEN=$$src_token DEST_CHAIN_ID=$$dst_chain_id \\"; \
		echo "    DEST_CONNECTOR=$$dst_connector DEST_WRAPPED_TOKEN_FACTORY=$$dst_factory \\"; \
		echo "    make apply-routes"; \
	fi; \
	\
	echo ""; \
	echo "================================================================"; \
	echo "  DEPLOYMENT COMPLETE — add these to smart-contracts/.env"; \
	echo "================================================================"; \
	echo "  RISC0_ADAPTER_SOURCE=$$risc0_src"; \
	echo "  RISC0_ADAPTER_DEST=$$risc0_dst"; \
	echo "  SNARK_ADAPTER_SOURCE=$$snark_src"; \
	echo "  SNARK_ADAPTER_DEST=$$snark_dst"; \
	echo "  SOURCE_CONNECTOR=$$src_connector"; \
	echo "  DEST_CONNECTOR=$$dst_connector"; \
	echo "  SOURCE_TOKEN=$$src_token"; \
	echo "  SOURCE_WRAPPED_TOKEN_FACTORY=$$src_factory"; \
	echo "  WRAPPED_TOKEN_FACTORY_SOURCE=$$src_factory"; \
	echo "  DEST_WRAPPED_TOKEN_FACTORY=$$dst_factory"; \
	echo "  DEST_WRAPPED_TOKEN=$$dst_wrapped_token"; \
	echo "  ACK_WINDOW_SECONDS_SOURCE=$$ack_window_src"; \
	echo "  ACK_WINDOW_SECONDS_DEST=$$ack_window_dst"; \
	echo ""

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
	@echo "Production deployment (deploy-prod-full / deploy-connectors-prod):"
	@echo "  SNARK_ADAPTER_SOURCE / SNARK_ADAPTER_DEST   pre-deployed SnarkAdapters (required)"
	@echo "  RISC0_ADAPTER_SOURCE / RISC0_ADAPTER_DEST   pre-deployed RiscZeroAdapters (auto-deployed by deploy-prod-full)"
	@echo "  RISC0_VERIFIER       existing Groth16Verifier to reuse (optional; auto-deployed if empty)"
	@echo "  ACK_WINDOW_SECONDS_SOURCE / ACK_WINDOW_SECONDS_DEST"
	@echo "  WRAPPED_TOKEN_FACTORY_SOURCE / WRAPPED_TOKEN_FACTORY_DEST  (optional; auto-deployed if empty)"
	@echo "  REGISTRATION_TIMELOCK  timelock for route registration (default 0 = instant;"
	@echo "                         set to 172800 once bridge has live users to protect)"
	@echo "  SOURCE_TOKEN         existing source ERC-20 to bridge (optional; MockERC20 deployed if empty)"
	@echo "  WRAPPED_TOKEN_NAME / WRAPPED_TOKEN_SYMBOL  BridgeWrappedToken name/symbol (default: Wrapped SRC / wSYM)"
	@echo "  TOKEN_NAME_SRC / TOKEN_SYMBOL_SRC"
	@echo "  MINT_AMOUNT      tokens to mint (wei, default 10 000 × 10^18)"
	@echo "  FUND_AMOUNT      ETH sent by fund-deployer (default: 10ether)"
	@echo "  AUTO_DETECT_FINALITY  0 (default) = use ACK_WINDOW_SECONDS_SOURCE / _DEST from .env"
	@echo "                        1 = measure avg block time × 64 blocks for ack window"
	@echo "  Known chains (auto lookup, no RPC sampling): 1 Ethereum, 11155111 Sepolia,"
	@echo "    100 Gnosis, 10200 Chiado, 137 Polygon, 42161 Arbitrum, 10 Optimism, 8453 Base"
	@echo ""
	@echo "Full prod quick-start (two chains, e.g. Sepolia → Chiado):"
	@echo "  1. Set PRIVATE_KEY, RPC_URL_SOURCE, RPC_URL_DEST, SOURCE_CHAIN_ID, DEST_CHAIN_ID in .env"
	@echo "  2. Pre-deploy SnarkAdapters and set SNARK_ADAPTER_SOURCE / SNARK_ADAPTER_DEST"
	@echo "  3. make deploy-prod-full"
	@echo "  4. make apply-routes   # after 48-hour timelock (prod only; local auto-applies)"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'
	@echo ""

.DEFAULT_GOAL := help
