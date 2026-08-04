// Generation 3: fixes personal bootstrap and exposes /root/.local/bin on PATH.
// Generation 4: drops the baked-in WORKDIR; the project bootstrap takes the
// resolved workdir as an argument and mounts the project at its host path.
export const STOCK_IMAGE_GENERATION = 4;

export const STOCK_IMAGE_TAG = `mise-msb-base:v${STOCK_IMAGE_GENERATION}`;

export const STOCK_IMAGE_DIR = new URL(".", import.meta.url).pathname;

export const CONTAINERFILE_PATH = new URL("./Containerfile", import.meta.url).pathname;

export const DOCKER_UP_HELPER = "docker-up";

export const BOOTSTRAP_HELPER = "mise-msb-bootstrap";

export const STOCK_MISE_MOUNT_TARGET = "/mise";

export const STOCK_DOCKER_MOUNT_TARGET = "/var/lib/docker";

export const PERSONAL_MOUNT_TARGET = "/etc/mise-msb/personal";

export const PERSONAL_GLOBAL_CONFIG_ENV = "MISE_GLOBAL_CONFIG_FILE";

export const PERSONAL_BOOTSTRAP_MARKER = "/var/lib/mise-msb/personal-bootstrap-hash";

export const MISE_ENV_PATHS = {
  MISE_DATA_DIR: "/mise/data",
  MISE_CACHE_DIR: "/mise/cache",
  MISE_CONFIG_DIR: "/mise/config",
  MISE_STATE_DIR: "/mise/state",
  MISE_SHIMS_DIR: "/mise/shims",
} as const;

export const STOCK_BOOTSTRAP_DIR = "/tmp/mise-msb-personal-bootstrap";
