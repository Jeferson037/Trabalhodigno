# Trabalho Digno — Mapa de Conscientização

Site estático sobre trabalho infantil e trabalho análogo à escravidão: mapa de locais denunciados, canais oficiais de denúncia, formulário de relato anônimo (Google Forms) e painel de controle protegido por senha.

## Estrutura

```
index.html          site + janela do formulário + painel de controle
style.css           estilos do site
painel.css          estilos do painel
script.js           mapa, filtros, métricas e formulário
painel.js           senha, cadastro de endereços e publicação
data/denuncias.js   locais exibidos no mapa (gerado pelo painel)
data/acesso.js      criado pelo painel: token do GitHub criptografado com a senha
```

Os dados ficam em arquivos `.js` (e não `.json`) para que o site funcione também quando aberto direto do computador, com dois cliques no `index.html`.

## Publicar no GitHub Pages

1. Crie um repositório e envie todos os arquivos, mantendo a pasta `data/`.
2. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. Em cerca de 1 minuto o site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

## Painel de controle

Abra pelo **"·"** discreto no centro do rodapé ou pelo endereço `…/index.html#painel`, e digite a senha.

A senha não fica escrita no código: só um *hash* PBKDF2 dela. **Não coloque a senha em nenhum arquivo do repositório.**

### Primeira vez: conectar ao GitHub

O botão **Publicar no site** grava as alterações direto no repositório. Para isso, ele precisa de um token do GitHub, informado uma única vez:

1. No GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Repository access*: **Only select repositories** → este repositório.
3. *Permissions → Repository permissions → Contents*: **Read and write**.
4. No painel, abra **Publicação no GitHub**, preencha usuário, repositório e token e clique em **Conectar e salvar**.

O painel criptografa o token com a senha (AES-GCM) e salva em `data/acesso.js`. Depois disso basta a senha, em qualquer computador. Sem a senha, o arquivo não serve para nada.

Para trocar a senha, gere um novo hash (veja `AUTH` no início do `painel.js`) e conecte o GitHub de novo, para recriptografar o token.

### Uso

- **Localizar no mapa** busca o endereço. Você também pode clicar no mapa ou arrastar o marcador.
- Defina **tipo**, **gravidade** (moderada, grave, muito grave) e **situação** (denúncia recebida, em apuração, caso confirmado).
- **Publicar no site** atualiza o mapa na hora no seu navegador. Para os visitantes, leva cerca de 1 minuto.
- Sem conexão com o GitHub: use **Baixar arquivo** e substitua `data/denuncias.js` no repositório.
- Alterações não publicadas ficam salvas como rascunho no navegador.

## Mapa

As imagens do mapa vêm do CARTO (dados © OpenStreetMap), que funciona tanto no GitHub Pages quanto abrindo o arquivo localmente.

## Cuidado ao publicar

Associar uma empresa ou um endereço a crimes pode trazer consequências legais (calúnia e difamação, LGPD). Marque como **Caso confirmado** apenas casos verificados por órgãos oficiais e evite publicar endereços residenciais ou dados que identifiquem vítimas ou denunciantes.

## Canais oficiais

- Disque 100 (Direitos Humanos) — ligação gratuita, 24h; WhatsApp (61) 99611-0100
- 190 — Polícia Militar (emergência)
- Sistema Ipê Trabalho Escravo — https://ipe.sit.trabalho.gov.br
- Sistema Ipê Trabalho Infantil — https://ipetrabalhoinfantil.trabalho.gov.br
- Ministério Público do Trabalho — https://www.mpt.mp.br
