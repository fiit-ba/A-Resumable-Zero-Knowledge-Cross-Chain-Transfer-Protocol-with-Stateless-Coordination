use alloy_primitives::B256;
use burn_proof_methods::BURN_PROOF_GUEST_ID;
use risc0_zkvm::Digest;

fn main() {
    let image_id = <[u8; 32]>::from(Digest::from(BURN_PROOF_GUEST_ID));
    let image_id_b256 = B256::from(image_id);
    println!("0x{}", hex::encode(image_id_b256));
}
