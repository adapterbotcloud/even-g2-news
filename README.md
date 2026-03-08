# 📰 BR News — Even G2 Smart Glasses

Leitor de notícias brasileiras para os óculos inteligentes **Even Realities G2**.

## Fontes

- **G1** (Globo)
- **Folha de S.Paulo**
- **Valor Econômico**
- **Estadão**
- **Folha Política**

## Controles no G2

| Gesto | Ação |
|-------|------|
| Toque simples | Próxima notícia |
| Toque duplo | Trocar fonte |
| Toque longo | Atualizar |
| Ring ↑/↓ | Navegar notícias |
| Aceno cabeça ↑/↓ | Navegar notícias |

## Arquitetura

```
[Backend Express :3005] ←fetch→ [RSS Feeds]
         ↑
    /api/news
         ↑
[Vite Frontend :5173] ←BLE→ [G2 Glasses]
```

## Desenvolvimento

```bash
npm install

# Backend
npm run server

# Frontend (em outro terminal)
npm run dev
```

## Com Even Dev Simulator

```bash
cd even-dev
APP_PATH=../even-g2-news ./start-even.sh
```

## Deploy

Backend + Frontend rodam como web app normal. Deploy em qualquer hosting.

---

**Versão:** 1.0.0
