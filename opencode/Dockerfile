# OPENCODE_VERSION=2.2.7; docker build . --build-arg OPENCODE_VERSION=$OPENCODE_VERSION --secret id=ROOT_PASSWORD,src=.root-password -t zeio.ru/heartness:opencode-$OPENCODE_VERSION

arg CUDA_VERSION="13.0.0"
arg UBUNTU_VERSION="24.04"

from nvcr.io/nvidia/cuda:$CUDA_VERSION-cudnn-devel-ubuntu$UBUNTU_VERSION

# Install system dependencies

run apt-get update && \
    apt-get install -y software-properties-common && \
    add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && \
    apt-get install -y python3 python3-pip python3-venv git curl ca-certificates vim \
    nodejs npm \
    ffmpeg unzip git-lfs \
    python3.11 python3.11-venv && \
    rm -rf /var/lib/apt/lists/*

# Set root password

run --mount=type=secret,id=ROOT_PASSWORD,required=true \
    export ROOT_PASSWORD="$(cat /run/secrets/ROOT_PASSWORD)" && \
    echo "root:${ROOT_PASSWORD}" | chpasswd

# run curl -fsSL \
#     https://github.com/huggingface/xet-core/releases/download/git-xet-v0.2.1/git-xet-linux-x86_64.zip \
#     -o /tmp/git-xet.zip && \
#     mkdir /tmp/git-xet && \
#     unzip /tmp/git-xet.zip -d /tmp/git-xet && \
#     install -m 0755 /tmp/git-xet/git-xet /usr/local/bin/git-xet && \
#     rm -rf /tmp/git-xet /tmp/git-xet.zip
copy git-xet.zip /tmp/git-xet.zip
run mkdir /tmp/git-xet && \
    unzip /tmp/git-xet.zip -d /tmp/git-xet && \
    install -m 0755 /tmp/git-xet/git-xet /usr/local/bin/git-xet && \
    rm -rf /tmp/git-xet /tmp/git-xet.zip

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

# Configure file permissions

run mkdir -p /home/${USER_NAME}/.config/opencode && chown -R ${USER_NAME}:${USER_NAME} /home/${USER_NAME}/.config
run mkdir -p /home/${USER_NAME}/.cache/huggingface && chown -R ${USER_NAME}:${USER_NAME} /home/${USER_NAME}/.cache
run mkdir -p /home/${USER_NAME}/.local && chown -R ${USER_NAME}:${USER_NAME} /home/${USER_NAME}/.local
run mkdir -p /tmp/opencode && chown -R ${USER_NAME}:${USER_NAME} /tmp/opencode

user ${USER_NAME}

# Install user dependencies

arg OPENCODE_VERSION="2.2.7"

run curl -fsSL https://opencode.ai/v2/install | bash -s -- -v $OPENCODE_VERSION
env PATH="/home/${USER_NAME}/.opencode/bin:$PATH"

# Configure dependencies

arg GIT_USER_NAME="Zeio Nara"
arg GIT_USER_EMAIL="zeionara@gmail.com"

run git config --global user.email "$GIT_USER_EMAIL"
run git config --global user.name "$GIT_USER_NAME"

run git xet install

# Set startup options

workdir /home/${USER_NAME}
entrypoint ["opencode"]
