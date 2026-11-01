# OPENCODE_VERSION=2.2.4; docker build . --secret id=ROOT_PASSWORD,src=.root-password -t zeio.ru/heartness:opencode-$OPENCODE_VERSION

arg CUDA_VERSION="13.0.0"
arg UBUNTU_VERSION="24.04"

from nvcr.io/nvidia/cuda:$CUDA_VERSION-cudnn-devel-ubuntu$UBUNTU_VERSION

# Install system dependencies

run apt-get update && \
    apt-get install -y python3 python3-pip python3-venv git curl ca-certificates sudo && \
    rm -rf /var/lib/apt/lists/*

# Set root password

run --mount=type=secret,id=ROOT_PASSWORD,required=true \
    export ROOT_PASSWORD="$(cat /run/secrets/ROOT_PASSWORD)" && \
    echo "root:${ROOT_PASSWORD}"

# Configure file permissions

run mkdir -p /home/${USER_NAME}/.config/opencode && chown -R ${USER_NAME}:${USER_NAME} /home/${USER_NAME}/.config
run mkdir -p /tmp/opencode && chown -R ${USER_NAME}:${USER_NAME} /tmp/opencode

# Create and switch to a non-root user

arg USER_ID="1001"
arg USER_NAME="zeio"

run addgroup --gid ${USER_ID} ${USER_NAME} && \
  adduser --uid ${USER_ID} \
          --disabled-password \
          --ingroup ${USER_NAME} \
          --shell /bin/bash \
          --gecos "" \
          --home /home/${USER_NAME} \
          ${USER_NAME}
run mkdir -p /home/${USER_NAME}/.config/opencode && chown -R ${USER_NAME}:${USER_NAME} /home/${USER_NAME}/.config

user ${USER_NAME}

# Install user dependencies

arg OPENCODE_VERSION="2.2.4"

run curl -fsSL https://opencode.ai/v2/install | bash -s -- -v $OPENCODE_VERSION

# Configure dependencies

arg GIT_USER_NAME="Zeio Nara"
arg GIT_USER_EMAIL="zeionara@gmail.com"

run git config --global user.email "$GIT_USER_EMAIL"
run git config --global user.name "$GIT_USER_NAME"

# Set startup options

workdir /home/${USER_NAME}
entrypoint ["opencode"]
