const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

class MCPHub {
  constructor() {
    this.clientes = [];
    this.ferramentas = [];
  }

  // Registra e conecta a um servidor MCP
  async adicionarServidor(nome, comando, args = [], env = {}) {
    try {
      const transport = new StdioClientTransport({
        command: comando,
        args: args,
        env: { ...process.env, ...env }
      });

      const cliente = new Client(
        { name: `Mimi_${nome}`, version: '1.0.0' },
        { capabilities: {} }
      );

      await cliente.connect(transport);
      this.clientes.push({ nome, cliente });

      // Busca as ferramentas do servidor
      const { tools } = await cliente.listTools();
      
      // Mapeia para o formato padrão do OpenAI/Groq/OpenRouter
      const ferramentasFormatadas = tools.map(tool => ({
        type: 'function',
        function: {
          name: `${nome}__${tool.name}`, // Prefixo para evitar conflito de nomes
          description: `[${nome}] ${tool.description}`,
          parameters: tool.inputSchema,
        }
      }));

      this.ferramentas.push(...ferramentasFormatadas);
      console.log(`🔌 MCP [${nome}] conectado! (${tools.length} ferramentas agregadas)`);
    } catch (err) {
      console.error(`❌ Erro ao conectar no MCP [${nome}]:`, err.message);
    }
  }

  // Executa a ferramenta solicitada pelo modelo
  async executarFerramenta(nomeCompleto, argumentos) {
    const [prefixo, nomeFerramenta] = nomeCompleto.split('__');
    const item = this.clientes.find(c => c.nome === prefixo);

    if (!item) {
      throw new Error(`Servidor MCP [${prefixo}] não encontrado.`);
    }

    const resultado = await item.cliente.callTool({
      name: nomeFerramenta,
      arguments: argumentos,
    });

    return JSON.stringify(resultado.content);
  }
}

module.exports = new MCPHub();