function tentarRolarDado(texto) {
  const match = texto.match(/(\d+)d(\d+)(?:\+(\d+))?/i);
  if (!match) return null;

  const qtd = Math.min(parseInt(match[1]), 10);
  const lados = parseInt(match[2]);
  const mod = parseInt(match[3] || 0);

  let resultados = [];
  let total = 0;

  for (let i = 0; i < qtd; i++) {
    const rolagem = Math.floor(Math.random() * lados) + 1;
    resultados.push(rolagem);
    total += rolagem;
  }
  total += mod;

  return { qtd, lados, mod, resultados, total };
}

module.exports = { tentarRolarDado };