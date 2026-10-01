require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const mcpHub = require('./mcpHub');
const { obterSystemInstruction } = require('./src/config/personality');
const { tentarRolarDado } = require('./src/utils/rpg');
const { adicionarAMemoria, obterMemoria } = require('./src/utils/memory');
const { processarResposta } = require('./src/services/ai');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('clientReady', async () => {
  console.log('🌸 Mimi conectando aos servidores MCP...');
  try {
    await mcpHub.adicionarServidor('files', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', './']);
    if (process.env.BRAVE_API_KEY) {
      await mcpHub.adicionarServidor('web', 'npx', ['-y', '@modelcontextprotocol/server-brave-search'], {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY
      });
    }
    console.log(`🌸 Mimi online e pronta! (${mcpHub.ferramentas.length} ferramentas MCP)`);
  } catch (err) {
    console.error('⚠️ Erro ao carregar MCPs:', err.message);
  }
});

// --- FUNÇÃO AUXILIAR PARA PROCESSAR O PROMPT UNIFICADO ---
async function processarPromptGeral({ channel, author, prompt, mentionedChannel, attachment, channelId: directChannelId }) {
  const isImage = attachment && attachment.contentType && attachment.contentType.startsWith('image/');
  let promptComContexto = prompt || 'oii!';

  // Fallback seguro do ID do canal (trata DMs e interações sem objeto channel)
  const channelId = directChannelId || channel?.id || author.id;

  // 1. Leitura de canal opcional (apenas se o bot for membro e tiver permissão no canal)
  if (mentionedChannel && typeof mentionedChannel.permissionsFor === 'function' && client.user) {
    try {
      const temPermissao = mentionedChannel.permissionsFor(client.user)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory
      ]);

      if (temPermissao && mentionedChannel.messages) {
        const history = await mentionedChannel.messages.fetch({ limit: 15 });
        const formattedMessages = history
          .map(m => `${m.author.username}: ${m.content} ${m.attachments.size > 0 ? '[mídia]' : ''}`)
          .reverse()
          .join('\n');

        if (formattedMessages) {
          promptComContexto = `${prompt}\n\n[HISTÓRICO LIDO DO CANAL #${mentionedChannel.name}]:\n${formattedMessages}\n\nResponda ao usuário com base no histórico acima.`;
        }
      }
    } catch (errChannel) {
      console.warn(`[Canal] Ignorando leitura de #${mentionedChannel.name}:`, errChannel.message);
    }
  }

  // 2. Rolagem de dados de RPG
  const resultadoDado = tentarRolarDado(prompt);
  if (resultadoDado) {
    promptComContexto += `\n\n[SISTEMA DE RPG]: Pedido: ${resultadoDado.qtd}d${resultadoDado.lados}. Resultados: [${resultadoDado.resultados.join(', ')}]. Total: ${resultadoDado.total}.`;
  }

  // 3. Gestão de Memória de curto prazo por canal/DM
  adicionarAMemoria(channelId, 'user', `${author.username}: ${promptComContexto}`);

  const systemPrompt = obterSystemInstruction(author.id);
  const payloadMensagens = [
    { role: 'system', content: systemPrompt },
    ...obterMemoria(channelId)
  ];

  // 4. Execução da IA e MCPs
  const respostaFinal = await processarResposta(payloadMensagens, isImage, isImage ? attachment.url : null);
  adicionarAMemoria(channelId, 'assistant', respostaFinal);

  return respostaFinal;
}

// --- FLUXO 1: MENSAGENS NORMAIS NO CHAT ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // Comandos administrativos (!limpar e !cargo)
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

  // REGEX: Detecta se a mensagem COMEÇA com a menção (@Mimi) ou com a palavra "Mimi"
  const regexInicioMimi = /^(<@!?\d+>|mimi)\b/i;

  if (regexInicioMimi.test(content)) {
    let prompt = content
      .replace(regexInicioMimi, '')
      .replace(/^[,.:;! ]+/, '')
      .trim();

    try {
      await message.channel.sendTyping();

      const respostaFinal = await processarPromptGeral({
        channel: message.channel,
        channelId: message.channel.id,
        author: message.author,
        prompt: prompt || 'oii!',
        mentionedChannel: message.mentions.channels.first(),
        attachment: message.attachments.first()
      });

      if (respostaFinal.length > 2000) {
        const chunks = respostaFinal.match(/[\s\S]{1,1900}/g);
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
      } else {
        await message.reply(respostaFinal);
      }
    } catch (err) {
      console.error('Erro na Mimi (Texto):', err);
      message.reply('eita, deu um probleminha aqui kkkk tenta de novo? 🥺💖');
    }
  }
});

// --- FLUXO 2: SLASH COMMANDS (/mimi) ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'mimi') {
    const prompt = interaction.options.getString('mensagem');
    const mentionedChannel = interaction.options.getChannel('canal');

    try {
      await interaction.deferReply();

      const respostaFinal = await processarPromptGeral({
        channel: interaction.channel,
        channelId: interaction.channelId,
        author: interaction.user,
        prompt: prompt,
        mentionedChannel: mentionedChannel,
        attachment: null
      });

      if (respostaFinal.length > 2000) {
        const chunks = respostaFinal.match(/[\s\S]{1,1900}/g);
        await interaction.editReply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]);
        }
      } else {
        await interaction.editReply(respostaFinal);
      }
    } catch (err) {
      console.error('Erro no Slash Command da Mimi:', err);
      if (interaction.deferred) {
        await interaction.editReply('eita, deu um probleminha aqui kkkk tenta de novo? 🥺💖');
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);