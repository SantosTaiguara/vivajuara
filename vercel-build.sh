#!/bin/sh
# Build da Vercel: copia o painel compilado (dash/) para public/ na pasta de onde a Vercel rodou o build
# (Root Directory vazio, codigo/ ou codigo/backend). A apresentação vai junto em /apresentacao/.
# Chamado pelo buildCommand de vercel.json (gerado por codigo/scripts/vercel.js; a Vercel aceita no máximo 256 caracteres ali).
set -e
R=$(cd "$(dirname "$0")" && pwd)
if [ ! -f "$R/dash/index.html" ]; then echo "pasta dash nao encontrada em $R"; exit 1; fi
rm -rf public && mkdir public
cp -R "$R/dash/." public/
rm -f public/_headers public/index_v1.html
if [ -d "$R/apresentacao" ]; then cp -R "$R/apresentacao" public/apresentacao; fi
echo "painel copiado de $R/dash"
