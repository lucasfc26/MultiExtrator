# Worker do MultiExtractor: Python + Camoufox (Site ENEL / Corporativo) +
# Google Chrome (2 VIA com NoneCap, e Site ENEL / Corporativo com NAVEGADOR_*=chrome).
# Mesma base (Debian bookworm) e mesmo Chrome fixo do Extractor-JS do Status Energy.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    # pyautogui (Xvfb do SeleniumBase) exige o tkinter
    python3-tk \
    xvfb \
    # sem o xauth o Xvfb do SeleniumBase falha ("X11 display failed!")
    xauth \
    ca-certificates \
    wget \
    fonts-freefont-ttf \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-core \
    fonts-noto-color-emoji \
    # Firefox/Camoufox
    libgtk-3-0 \
    libdbus-glib-1-2 \
    libxt6 \
    libx11-xcb1 \
    libxcb-shm0 \
    libpangocairo-1.0-0 \
    libasound2 \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Camoufox (~100MB) numa layer antes do código: mudar o worker não baixa de novo.
COPY extratores/requirements.txt /app/extratores/requirements.txt
COPY requirements.txt /app/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r /app/requirements.txt \
  && python3 -m camoufox fetch \
  && python3 -c "from camoufox.pkgman import camoufox_path; print('CAMOUFOX_OK', camoufox_path(download_if_missing=False))"

# Google Chrome oficial em versão fixa: uma versão nova já quebrou o hCaptcha.
# Para atualizar, troque a versão e teste a 2 VIA.
ARG CHROME_VERSION=156.0.8078.73-1
RUN wget -q -O /tmp/google-chrome.deb \
    "https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}_amd64.deb" \
  && apt-get update \
  && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
  && rm -f /tmp/google-chrome.deb \
  && rm -rf /var/lib/apt/lists/*

COPY extratores/ /app/extratores/
COPY app/ /app/app/

ENV EXTRATORES_DIR=/app/extratores \
    JOBS_DIR=/app/jobs \
    PYTHON_BIN=python3 \
    CHROME_BINARY=/usr/bin/google-chrome \
    HEADLESS=true \
    LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1

RUN mkdir -p /app/jobs

EXPOSE 8000

# tini recolhe os processos órfãos dos navegadores.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
