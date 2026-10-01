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
  console.log('🌸 Mimi conectando aos servidores MCP locais do PC...');
  try {
    await mcpHub.adicionarServidor('files', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', './']);
    if (process.env.BRAVE_API_KEY) {
      await mcpHub.adicionarServidor('web', 'npx', ['-y', '@modelcontextprotocol/server-brave-search'], {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY
      });
    }
    console.log(`🌸 Mimi online e organizada! (${mcpHub.ferramentas.length} ferramentas MCP)`);
  } catch (err) {
    console.error('⚠️ Aviso na carga de MCPs:', err.message);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // Comandos administrativos
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

  // Interação ao mencionar a Mimi
  if (message.mentions.has(client.user)) {
    const prompt = content.replace(/<@!?\d+>/g, '').trim();

    try {
      await message.channel.sendTyping();

      const attachment = message.attachments.first();
      const isImage = attachment && attachment.contentType && attachment.contentType.startsWith('image/');
      let promptComContexto = prompt || 'oii!';

      // Leitura de outros canais
      const mentionedChannel = message.mentions.channels.first();
      if (mentionedChannel) {
        const permissions = mentionedChannel.permissionsFor(client.user);
        if (permissions && permissions.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
          const history = await mentionedChannel.messages.fetch({ limit: 15 });
          const formattedMessages = history
            .map(m => `${m.author.username}: ${m.content} ${m.attachments.size > 0 ? '[mídia]' : ''}`)
            .reverse()
            .join('\n');

          promptComContexto = `${prompt}\n\n[HISTÓRICO LIDO DO CANAL #${mentionedChannel.name}]:\n${formattedMessages}\n\nResponda ao usuário com base no histórico acima.`;
        }
      }

      // Rolagem de dados RPG
      const resultadoDado = tentarRolarDado(prompt);
      if (resultadoDado) {
        promptComContexto += `\n\n[SISTEMA DE RPG]: Pedido: ${resultadoDado.qtd}d${resultadoDado.lados}. Resultados: [${resultadoDado.resultados.join(', ')}]. Total: ${resultadoDado.total}.`;
      }

      adicionarAMemoria(message.channel.id, 'user', `${message.author.username}: ${promptComContexto}`);

      const systemPrompt = obterSystemInstruction(message.author.id);
      const payloadMensagens = [
        { role: 'system', content: systemPrompt },
        ...obterMemoria(message.channel.id)
      ];

      const respostaFinal = await processarResposta(payloadMensagens, isImage, isImage ? attachment.url : null);
      adicionarAMemoria(message.channel.id, 'assistant', respostaFinal);

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