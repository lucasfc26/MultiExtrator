# Origem dos extratores

Copiados de `Status Energy/2via/` no commit `f4ef145` (28/10/2026). São os
mesmos scripts que o multiextrator (Extractor-JS) roda em produção:

| Fluxo       | Script                  | Captcha                     |
|-------------|-------------------------|-----------------------------|
| Site ENEL   | `site_enel_camoufox.py` | reCAPTCHA → CapSolver       |
| 2 VIA ENEL  | `extraction_trawl.py`   | hCaptcha → NoneCap (Chrome) |
| Corporativo | `agencia_api.py`        | —                           |

Apoio: `trawl_browser.py`, `chrome_cdp_browser.py`, `hcaptcha_solver.py`,
`hcaptcha_chrome.py`, `hcaptcha_nonecap.py`, `hcaptcha_2captcha.py`.

## Única alteração

`trawl_browser.py`: classe `_ChromePlaywright` e o desvio no começo de
`open_camoufox()` — com `NAVEGADOR=chrome` no ambiente, o Site ENEL e o
Corporativo abrem o Google Chrome pelo Playwright em vez do Camoufox (mesma
API de página, então o resto do script não muda).

Todo o resto está idêntico. O worker roda os scripts com `--batch payload.json`
sem `ENEL_INTERNAL_TOKEN`, então as chamadas ao backend do Status Energy
(logextracao, faturasextraidas, /ucs/...) são puladas, e a 2 VIA roda com
`OTP_MANUAL=true` (código pelo stdin em vez do Outlook).

## Atualizar

Ao corrigir algo nos scripts do Status Energy, copie de novo os arquivos acima
e reaplique a alteração do `trawl_browser.py`:

    diff -r "../Status Energy/2via" worker/extratores
