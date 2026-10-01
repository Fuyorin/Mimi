const canalMemoria = new Map();

function adicionarAMemoria(channelId, role, content) {
  if (!canalMemoria.has(channelId)) {
    canalMemoria.set(channelId, []);
  }
  const historico = canalMemoria.get(channelId);
  historico.push({ role, content });
  if (historico.length > 8) historico.shift();
}

function obterMemoria(channelId) {
  return canalMemoria.get(channelId) || [];
}

module.exports = { adicionarAMemoria, obterMemoria };