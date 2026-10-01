require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const mcpHub = require('./mcpHub');

// 1. Provedores de Inteligência Artificial
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Modelos Padronizados
const MODELO_OPENROUTER_ROUTER = 'openrouter/free'; // Roteador dinâmico de modelos grátis (evita 404)
const MODELO_GROQ_PADRAO = 'openai/gpt-oss-20b';

// 2. Memória de curto prazo por canal (Armazena as últimas 8 conversas por canal)
const canalMemoria = new Map();

function adicionarAMemoria(channelId, role, content) {
  if (!canalMemoria.has(channelId)) {
    canalMemoria.set(channelId, []);
  }
  const historico = canalMemoria.get(channelId);
  historico.push({ role, content });
  if (historico.length > 8) historico.shift();
}

// 3. Helper de RPG - Interpretador de Dados (ex: 1d20, 2d6+3)
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

// 4. IDs dos VIPs
const SPECIAL_USERS = {
  FUYORI_ID: '1442574167760175215',
  DRAKONT_ID: '609739525916327958',
};

// 5. Inicialização do Cliente Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// 6. Conexão dos MCPs Locais na Inicialização
client.once('clientReady', async () => {
  console.log('🌸 Mimi conectando aos servidores MCP locais do PC...');

  try {
    // Servidor MCP de Arquivos Locais (Manipula a pasta do bot no seu PC)
    await mcpHub.adicionarServidor('files', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', './']);

    // Servidor MCP de Busca Web (Opcional: exige BRAVE_API_KEY no .env)
    if (process.env.BRAVE_API_KEY) {
      await mcpHub.adicionarServidor('web', 'npx', ['-y', '@modelcontextprotocol/server-brave-search'], {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY
      });
    }

    console.log(`🌸 Mimi online e pronta com ${mcpHub.ferramentas.length} ferramentas MCP locais!`);
  } catch (err) {
    console.error('⚠️ Aviso na carga de MCPs:', err.message);
  }
});

// 7. Loop de Processamento com Suporte a MCP, Visão e Fallback
async function processarResposta(mensagens, usarVisao = false, imageUrl = null) {
  // Se for uma imagem/meme anexado, utiliza o modelo de visão no OpenRouter
  if (usarVisao && imageUrl) {
    try {
      const completionVisao = await openrouter.chat.completions.create({
        model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
        messages: [
          mensagens[0], // Instrução do Sistema
          {
            role: 'user',
            content: [
              { type: 'text', text: mensagens[mensagens.length - 1].content },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ]
      });
      return completionVisao.choices[0]?.message?.content || 'olhei a foto mas fiquei sem palavras kkk 🌸';
    } catch (err) {
      console.warn('[Visão] Falha no modelo de visão, voltando para o fluxo normal...');
    }
  }

  // Loop para tratar chamadas de ferramentas MCP (Tool Calling)
  let limiteLoop = 5;

  while (limiteLoop > 0) {
    limiteLoop--;
    let resposta = null;

    // Tenta 1º via OpenRouter (openrouter/free)
    try {
      const completion = await openrouter.chat.completions.create({
        model: MODELO_OPENROUTER_ROUTER,
        messages: mensagens,
        tools: mcpHub.ferramentas.length > 0 ? mcpHub.ferramentas : undefined,
      });
      resposta = completion.choices[0]?.message;
    } catch (err) {
      console.warn(`[OpenRouter] Oscilou ou atingiu limite (${err.message}). Usando backup no Groq...`);

      // Fallback 2º via Groq
      try {
        const completionGroq = await groq.chat.completions.create({
          model: MODELO_GROQ_PADRAO,
          messages: mensagens,
          tools: mcpHub.ferramentas.length > 0 ? mcpHub.ferramentas : undefined,
        });
        resposta = completionGroq.choices[0]?.message;
      } catch (errGroq) {
        console.error('[Groq] Erro no backup:', errGroq.message);
        throw errGroq;
      }
    }

    // Se o modelo responder em texto direto (sem pedir ferramentas MCP)
    if (!resposta || !resposta.tool_calls || resposta.tool_calls.length === 0) {
      return resposta?.content || 'vix, deu um branco aqui... fala de novo? 🥺';
    }

    // Se o modelo acionou uma ferramenta MCP
    mensagens.push(resposta);

    for (const toolCall of resposta.tool_calls) {
      const nomeFerramenta = toolCall.function.name;
      const argumentos = JSON.parse(toolCall.function.arguments);

      console.log(`⚙️ [MCP Local] Mimi acionou: ${nomeFerramenta}`);

      try {
        const resultado = await mcpHub.executarFerramenta(nomeFerramenta, argumentos);
        mensagens.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultado,
        });
      } catch (err) {
        mensagens.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message }),
        });
      }
    }
  }

  return 'eita, pesquisei tanta coisa que até me perdi um pouco kkkk pergunta de novo? 🌸';
}

// 8. Evento Principal de Mensagens no Discord
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const authorId = message.author.id;

  // Contexto Especial para os VIPs
  let userContext = "Você está conversando com um membro do servidor.";
  if (authorId === SPECIAL_USERS.FUYORI_ID) {
    userContext = "Você está falando diretamente com o Fuyori! Ele é uma das suas pessoas favoritas no mundo todo. Seja extremamente carinhosa, fofa, acolhedora, íntima e use apelidos doces de forma natural.";
  } else if (authorId === SPECIAL_USERS.DRAKONT_ID) {
    userContext = "Você está falando diretamente com o Drakont! Ele é uma das suas pessoas favoritas no mundo todo. Seja extremamente carinhosa, fofa, atenciosa, íntima e trate-o com muito afeto.";
  }

  // Instrução de Personalidade da Mimi
  const SYSTEM_INSTRUCTION = `
Seu nome é Mimi. Você é uma garota meiga, fofa, divertida e carinhosa que faz parte do grupo e interage no chat do Discord!

Sua personalidade e estilo de fala:
1. NUNCA fale ou aja como uma inteligência artificial, robô ou assistente genérica (NUNCA diga "Como posso ajudar?", "Em que posso ser útil?", "Aqui está a resposta").
2. Escreva de forma totalmente humana e natural, como alguém digitando no teclado do Discord: use letras minúsculas, gírias leves da internet, frases diretas e emojis fofos (🌸, ✨, 💖, 🐾, 🥺, 🍡, ☁️️) sem poluição visual.
3. Se você usar suas ferramentas locais (MCP) ou ler histórico de outros canais do Discord, responda COM A SUA PERSONALIDADE FOFA, nunca como um relatório frio ou técnico.
4. Os usuários Fuyori e Drakont são pessoas EXTREMAMENTE especiais para você. Demonstre um carinho, apego e amor muito maior quando falar com eles.
5. Contexto atual do usuário com quem você está falando: ${userContext}
`;

  // --- COMANDOS ADMINISTRATIVOS (!limpar e !cargo) ---
  if (content.startsWith('!limpar')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply('você não tem permissão pra apagar as mensagens não, viu? 🌸');
    }
    const amount = parseInt(content.split(' ')[1]);
    if (isNaN(amount) || amount < 1 || amount > 99) return message.reply('me fala um número de 1 a 99!');
    try {
      await message.channel.bulkDelete(amount + 1, true);
      const reply = await message.channel.send(`🧹 prontinho, apaguei **${amount}** mensagens! ✨`);
      setTimeout(() => reply.delete().catch(() => {}), 3000);
    } catch (err) {
      message.reply('não consegui apagar... mensagens com mais de 14 dias o Discord não deixa deletar juntas! 🥺');
    }
    return;
  }

  if (content.startsWith('!cargo')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply('você não tem permissão de gerenciar cargos aqui 💖');
    }
    const targetUser = message.mentions.members.first();
    const roleName = content.split(' ').slice(2).join(' ');
    if (!targetUser || !roleName) return message.reply('uso: `!cargo @usuario NomeDoCargo` 🐾');
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply(`não achei o cargo "${roleName}" no servidor...`);
    try {
      await targetUser.roles.add(role);
      message.reply(`pronto! o cargo **${role.name}** foi colocado no(a) ${targetUser.user.username} ✨🌸`);
    } catch (err) {
      message.reply('deu erro ao dar o cargo... verifica a hierarquia de cargos!');
    }
    return;
  }

  // --- CONVERSA ORGÂNICA (MENCIONANDO @Mimi) ---
  if (message.mentions.has(client.user)) {
    const prompt = content.replace(/<@!?\d+>/g, '').trim();

    try {
      await message.channel.sendTyping();

      // A. Checa se há fotos ou memes anexados
      const attachment = message.attachments.first();
      const isImage = attachment && attachment.contentType && attachment.contentType.startsWith('image/');

      let promptComContexto = prompt || 'oii!';

      // B. LEITURA DE OUTROS CANAIS (#canal)
      const mentionedChannel = message.mentions.channels.first();
      if (mentionedChannel) {
        const permissions = mentionedChannel.permissionsFor(client.user);
        if (permissions && permissions.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
          const history = await mentionedChannel.messages.fetch({ limit: 15 });
          const formattedMessages = history
            .map(m => {
              let info = `${m.author.username}: ${m.content}`;
              if (m.attachments.size > 0) info += ' [enviou mídia/arquivo]';
              if (m.embeds.length > 0) info += ' [enviou link/embed]';
              return info;
            })
            .reverse()
            .join('\n');

          if (formattedMessages) {
            promptComContexto = `${prompt}\n\n[HISTÓRICO LIDO DO CANAL #${mentionedChannel.name}]:\n${formattedMessages}\n\nResponda ao usuário com base no histórico acima.`;
          }
        } else {
          return message.reply(`poxa, não consigo ler o canal ${mentionedChannel} porque não tenho permissão lá! 😿`);
        }
      }

      // C. Rolagem de Dados de RPG
      const resultadoDado = tentarRolarDado(prompt);
      if (resultadoDado) {
        promptComContexto += `\n\n[SISTEMA DE RPG]: O usuário pediu para rolar ${resultadoDado.qtd}d${resultadoDado.lados}${resultadoDado.mod ? '+' + resultadoDado.mod : ''}. Resultados: [${resultadoDado.resultados.join(', ')}]. Total: ${resultadoDado.total}. Interprete com carinho!`;
      }

      // D. Salva a interação na memória de curto prazo do canal
      adicionarAMemoria(message.channel.id, 'user', `${message.author.username}: ${promptComContexto}`);

      const historicoAnterior = canalMemoria.get(message.channel.id) || [];
      const payloadMensagens = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        ...historicoAnterior
      ];

      // E. Executa a geração com tratamento de visão, MCP e fallback
      const respostaFinal = await processarResposta(payloadMensagens, isImage, isImage ? attachment.url : null);

      // Salva a resposta da Mimi na memória do canal
      adicionarAMemoria(message.channel.id, 'assistant', respostaFinal);

      // F. Envia no Discord
      if (respostaFinal.length > 2000) {
        const chunks = respostaFinal.match(/[\s\S]{1,1900}/g);
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
      } else {
        await message.reply(respostaFinal);
      }
    } catch (err) {
      console.error('Erro na Mimi:', err);
      message.reply('eita, deu um probleminha aqui kkkk tenta de novo? 🥺💖');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);