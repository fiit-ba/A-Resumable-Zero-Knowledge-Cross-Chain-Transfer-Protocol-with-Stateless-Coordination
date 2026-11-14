use std::{collections::HashMap, env, path::PathBuf};

use risc0_build::{DockerOptionsBuilder, GuestOptionsBuilder};

// RISC Zero's default builder image has rustc 1.88, the guest dependencies need a newer one.
const GUEST_BUILDER_TAG: &str = "r0.1.97.0";

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

    // The builder image exists only for linux/amd64, so Docker on another host (Apple silicon)
    // has to be told to take that one.
    if env::var_os("DOCKER_DEFAULT_PLATFORM").is_none() {
        env::set_var("DOCKER_DEFAULT_PLATFORM", "linux/amd64");
    }

    let docker_options = DockerOptionsBuilder::default()
        .root_dir(workspace_root)
        .docker_container_tag(GUEST_BUILDER_TAG)
        .build()
        .expect("failed to build DockerOptions");

    let guest_options = GuestOptionsBuilder::default()
        .use_docker(docker_options)
        .build()
        .expect("failed to build GuestOptions");

    let mut opts = HashMap::new();
    opts.insert("ack-proof-guest", guest_options);
    risc0_build::embed_methods_with_options(opts);
}
