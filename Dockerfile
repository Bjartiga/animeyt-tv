FROM --platform=linux/amd64 ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TIZEN_HOME=/opt/tizen-studio
ENV PATH="${TIZEN_HOME}/tools:${TIZEN_HOME}/tools/ide/bin:${PATH}"

# Instalar dependencias esenciales y Java
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-11-jre \
    curl \
    ca-certificates \
    zip \
    unzip \
    pciutils \
    libxml2 \
    libglib2.0-0 \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Descargar e instalar Tizen Studio Web-CLI oficial silenciosamente
RUN curl -fSL "http://download.tizen.org/sdk/Installer/tizen-studio_5.5/web-cli_Tizen_Studio_5.5_ubuntu-64.bin" -o /tmp/tizen-cli.bin \
    && chmod +x /tmp/tizen-cli.bin \
    && /tmp/tizen-cli.bin --accept-license ${TIZEN_HOME} \
    && rm -f /tmp/tizen-cli.bin

WORKDIR /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
