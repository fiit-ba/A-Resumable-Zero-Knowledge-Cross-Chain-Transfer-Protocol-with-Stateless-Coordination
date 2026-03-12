use std::{collections::HashMap, env, path::PathBuf};

use risc0_build::{DockerOptionsBuilder, GuestOptionsBuilder};

fn env_truthy(name: &str) -> bool {
    match env::var(name) {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn main() {
    if !env_truthy("RISC0_GUEST_USE_DOCKER") {
        risc0_build::embed_methods();
        return;
    }

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .expect("methods crate must be inside workspace root")
        .to_path_buf();

    let docker_options = DockerOptionsBuilder::default()
        .root_dir(workspace_root)
        .build()
        .expect("failed to build DockerOptions");

    let guest_options = GuestOptionsBuilder::default()
        .use_docker(docker_options)
        .build()
        .expect("failed to build GuestOptions");

    let mut opts = HashMap::new();
    opts.insert("mint-proof-guest", guest_options);
    risc0_build::embed_methods_with_options(opts);
}
