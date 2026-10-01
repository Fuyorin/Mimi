require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// Configura o comando /mimi com suporte a Servidores, DMs e User Install
const commands = [
  new SlashCommandBuilder()
    .setName('mimi')
    .setDescription('Converse com a Mimi!')
    .setContexts([0, 1, 2]) // 0: Servidor, 1: DM com o Bot, 2: DMs de Grupo / Servidores sem o bot
    .setIntegrationTypes([0, 1]) // 0: Instalação no Servidor, 1: Instalação no Usuário (User Install)
    .addStringOption(option =>
      option
        .setName('mensagem')
        .setDescription('O que você quer falar com a Mimi?')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('canal')
        .setDescription('Escolha um canal para a Mimi ler o histórico recente (opcional)')
        .setRequired(false)
    ),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🌸 Registrando Slash Commands (/mimi) no modo Global + User Install...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log('✨ Slash Command /mimi registrado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao registrar Slash Command:', error);
  }
})();