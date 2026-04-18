# Codespace setup (recommended)

Development is done in **GitHub Codespaces** — the local CPU on this project's primary workstation doesn't support the instruction set bun requires. Codespaces sidesteps that entirely and gives us a reproducible Linux environment.

## One-time setup

1. **Create the `ANTHROPIC_API_KEY` Codespace secret.**
   - Go to https://github.com/settings/codespaces
   - Under "Codespaces secrets", click **New secret**.
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from https://console.anthropic.com/settings/keys
   - Repository access: grant to `yasumorishima/baseball-scorebook-ocr`

2. **Launch a Codespace**
   - On the repo page, click the green **Code** button → **Codespaces** → **Create codespace on main**.
   - First launch takes ~2 minutes while the devcontainer installs bun and dependencies.

## Working in the Codespace

Your API key is available as `$ANTHROPIC_API_KEY` automatically.

Upload scorebook images to `data/samples/` by dragging them into the VS Code file explorer. These stay inside the Codespace and are gitignored — they never reach the public repo.

Run the OCR probe:
```bash
bun run ocr:test -- data/samples/your-photo.jpg
# outputs to experiments/ocr-baseline/output/
```

## Why not run locally?

This project's primary workstation is a Celeron N4500 (no AVX2) — bun throws `Illegal instruction` on startup there. Node's `npm install` would work locally, but we also want to eventually run a Next.js dev server which is painfully slow on 4GB RAM. Codespaces gives us a decent Linux VM for free (120 core-hours/month).
